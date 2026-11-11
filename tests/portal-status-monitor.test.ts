import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, telaFila, telaStatus } from "./portal-fixture";

/**
 * O STATUS DO PORTAL É A FONTE DO “SAIU TRABALHO”, DE PONTA A PONTA.
 *
 * De minuto em minuto o cron olha a tela de Status na conta de cada motorista
 * (com a sessão guardada: um pedido só) e avisa a TROCA de situação —
 * ESCALADO, EM DISPENSA, de volta a ATIVO. O quadro público não decide mais a
 * saída; quem não cadastrou o acesso ao portal não recebe aviso de saída.
 *
 * Teste de integração isolado: nunca rode com o banco de produção. Use um
 * PostgreSQL local descartável e VAZIO chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_status \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_status \
 *   ./node_modules/.bin/tsx --test tests/portal-status-monitor.test.ts
 *
 * Nada sai da máquina: os quadros, o portal e o Web Push são de mentira, e o
 * teste falha se algum pedido for para um endereço que ele não conhece.
 * Pessoas, CPFs, placas e escalas são inventados.
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try {
    const u = new URL(uri);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_");
  } catch {
    return false;
  }
})();

function quadro(livro: string, tipo: "TRUCK" | "CARRETA", ultimo: number, numeros: number[]) {
  return `<h2>Livro ${livro} - ${tipo}</h2>Último Escalado: <b>${livro}${String(ultimo).padStart(3, "0")}</b><table>${numeros
    .map((n, i) => `<tr${i === 0 ? " bgcolor='#ff0000'" : ""}><td>${i + 1}</td><td><h3>${livro}${String(n).padStart(3, "0")}</h3></td></tr>`)
    .join("")}</table>`;
}

// CPFs com os dígitos verificadores ERRADOS de propósito (não são de ninguém;
// o app só confere o formato) e senhas inventadas.
const CPF = {
  alfa: "10000000001",
  bravo: "20000000002",
  charlie: "30000000003",
  eco: "50000000005",
  fox: "60000000006",
};
const SENHA = {
  alfa: "senha-alfa-1",
  bravo: "senha-bravo-2",
  charlie: "senha-certa-3",
  eco: "senha-eco-5",
  fox: "senha-fox-6",
};
const SENHA_ERRADA_CHARLIE = "senha-velha-errada";

type Aviso = { title: string; body: string; tag: string; acao: string; endpoint: string };

test("o Status do portal decide a saída: uma olhada por minuto, um aviso por troca", { skip: !local }, async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-este-teste-0123456789";
  process.env.COMPOSIO_API_KEY = "";
  delete process.env.PORTAL_FONTE_SAIDA;
  delete process.env.PORTAL_INTERVALO_MIN;

  const { db, pool } = await import("../src/db");
  const { eventos, motoristas, pontos, portalEventos, portalLeituras, portalMotoristaAcessos, portalSaidasPendentes, portalSituacoes, subscriptions } =
    await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { salvarAcessoPortal } = await import("../src/lib/portal-copadubo");
  const { situacaoFresca, situacoesDoMotorista } = await import("../src/lib/portal-situacao");
  const { cifrarParaColuna, decifrarDeColuna } = await import("../src/lib/admin/segredos");
  const { excluirCadastroMotorista } = await import("../src/lib/motorista-inatividade");
  const { GET } = await import("../src/app/api/cron/route");
  const { asc, eq, sql } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;

  /* ------------------------------------------------ portal de mentira */
  const cartao = (codigo: string, situacao: string, linhas: string[], nome: string) => ({
    codigo,
    situacao,
    linhas,
    nome,
    botao: situacao === "EM DISPENSA" ? "Sair da dispensa" : "Entrar em dispensa",
  });
  const status = (...cartoes: ReturnType<typeof cartao>[]) => telaStatus(cartoes);
  const portal = criarPortalFalso({
    cpf: CPF.alfa,
    senha: SENHA.alfa,
    telas: {
      "moto/status": status(cartao("A032", "ATIVO", ["Desde hoje, 07:00 · há 5 min"], "ALFA TESTE DA SILVA")),
      "moto/fila": telaFila("A", "A102", [{ codigo: "A040", tipo: "CARRETA 6 EIXOS" }]),
    },
    contas: {
      [CPF.bravo]: { senha: SENHA.bravo, telas: { "moto/status": status(cartao("A040", "ATIVO", ["Desde hoje, 07:10"], "BRAVO TESTE DE SOUZA")) } },
      [CPF.charlie]: { senha: SENHA.charlie, telas: { "moto/status": status(cartao("A050", "ESCALADO", ["Navio: NAO DEVE APARECER"], "CHARLIE TESTE")) } },
      [CPF.eco]: {
        senha: SENHA.eco,
        telas: {
          "moto/status": status(
            cartao("A070", "ATIVO", ["Desde hoje, 06:00"], "ECO TESTE"),
            cartao("A071", "ATIVO", ["Desde hoje, 06:05"], "ECO TESTE"),
          ),
        },
      },
      // A conta do Fox mostra OUTRO ponto (A081): o A080 dele nunca aparece.
      [CPF.fox]: { senha: SENHA.fox, telas: { "moto/status": status(cartao("A081", "ESCALADO", ["Navio: DE OUTRO PONTO"], "FOX TESTE")) } },
    },
  });
  const telasDe = (cpf: string) => (cpf === CPF.alfa ? portal.telas : portal.contas[cpf].telas);

  /* ------------------------------------------------ quadros de mentira */
  let quadroA = "";
  const definirQuadro = (ultimo: number, numeros: number[]) => {
    quadroA = quadro("A", "TRUCK", 39, []) + quadro("A", "CARRETA", ultimo, numeros);
  };
  const quadroB = quadro("B", "TRUCK", 102, []) + quadro("B", "CARRETA", 22, []);
  const quadroM = quadro("M", "TRUCK", 28, []) + quadro("M", "CARRETA", 69, []);
  /** Tudo o que alguém pediu fora dos quadros e do portal de mentira. */
  const desconhecidos: string[] = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(`${BASE_FALSA}/`)) return portal.buscar(input, init);
    if (url.endsWith("/ponto/pontoa.php")) return new Response(quadroA, { status: 200 });
    if (url.endsWith("/ponto/pontob.php")) return new Response(quadroB, { status: 200 });
    if (url.endsWith("/ponto/pontom.php")) return new Response(quadroM, { status: 200 });
    if (url.includes("simport.com.br") || url.includes("open-meteo.com")) return Response.json([]);
    // Nada de rede de verdade neste teste (navios e afins ficam sem resposta).
    desconhecidos.push(url);
    return new Response("", { status: 503 });
  }) as typeof fetch;

  /* ------------------------------------------------ Web Push de mentira */
  const enviados: Aviso[] = [];
  const originalSend = webpush.sendNotification;
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (assinatura: { endpoint: string }, corpo: string) => {
      const aviso = JSON.parse(corpo) as Omit<Aviso, "endpoint">;
      if (aviso.acao !== "chat") enviados.push({ ...aviso, endpoint: assinatura.endpoint });
      return { statusCode: 201, body: "" };
    },
  });

  try {
    await garantirTabelas();
    // Impede a semente de produção em um banco vazio de teste.
    await db.insert(eventos).values({ codigo: "TESTE", tipo: "TRUCK", livro: "A", numero: 1, acao: "cadastrou", mensagem: "Inicialização do teste" });

    const criar = async (nome: string, numeros: number[], acesso?: { cpf: string; senha: string }) => {
      const [m] = await db.insert(motoristas).values({ nome }).returning();
      const ids: number[] = [];
      for (const numero of numeros) {
        const [p] = await db.insert(pontos).values({ tipo: "CAVALO", livro: "A", numero, motoristaId: m.id, status: "AGUARDANDO" }).returning();
        ids.push(p.id);
      }
      const endpoint = `https://fcm.googleapis.com/fcm/send/portal-status-${numeros[0]}`;
      await db.insert(subscriptions).values({ endpoint, p256dh: chaves.publicKey, auth: "teste-sem-rede", motoristaId: m.id });
      if (acesso) await salvarAcessoPortal(m.id, acesso);
      return { id: m.id, pontoId: ids[0], pontos: ids, endpoint };
    };
    const alfa = await criar("Alfa Teste", [32], { cpf: CPF.alfa, senha: SENHA.alfa });
    const bravo = await criar("Bravo Teste", [40], { cpf: CPF.bravo, senha: SENHA.bravo });
    const charlie = await criar("Charlie Teste", [50], { cpf: CPF.charlie, senha: SENHA_ERRADA_CHARLIE });
    const delta = await criar("Delta Teste", [60]); // sem CPF/senha do portal
    const eco = await criar("Eco Teste", [70, 71], { cpf: CPF.eco, senha: SENHA.eco });
    const fox = await criar("Fox Teste", [80], { cpf: CPF.fox, senha: SENHA.fox });

    const executar = async () => {
      const res = await GET(new Request("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(res.status, 200);
      const dados = (await res.json()) as { origem?: string; portal?: { motoristas: number; lidos: number; falhas: number; adiados: number; avisos: number; logins: number } };
      assert.equal(dados.origem, "intranet");
      return dados.portal ?? null;
    };
    /** Faz o “minuto passar”: a leitura de todos fica vencida. */
    const adiantar = () => db.execute(sql`update portal_motorista_acessos set proxima_leitura_em = now() - interval '1 second'`);
    /** Faz o tempo passar para o FREIO de logins (que mora na sessão cifrada). */
    const envelhecerLogins = async (minutos: number) => {
      for (const a of await db.select().from(portalMotoristaAcessos)) {
        if (!a.sessaoCifrada) continue;
        const s = JSON.parse(await decifrarDeColuna(a.sessaoCifrada)) as { l?: number[]; f?: number | null };
        s.l = (s.l ?? []).map((t) => t - minutos * 60_000);
        if (typeof s.f === "number") s.f -= minutos * 60_000;
        await db
          .update(portalMotoristaAcessos)
          .set({ sessaoCifrada: await cifrarParaColuna(JSON.stringify(s)) })
          .where(eq(portalMotoristaAcessos.motoristaId, a.motoristaId));
      }
    };
    /** Avisos recebidos desde a última chamada. */
    let lidos = 0;
    const novos = () => {
      const fatia = enviados.slice(lidos);
      lidos = enviados.length;
      return fatia;
    };
    /** Pedidos ao portal desde a última chamada. */
    let vistos = 0;
    const pedidosNovos = () => {
      const fatia = portal.caminhos().slice(vistos);
      vistos = portal.pedidos.length;
      return fatia;
    };
    const de = (lista: Aviso[], m: { endpoint: string }, acao?: string) => lista.filter((a) => a.endpoint === m.endpoint && (!acao || a.acao === acao));
    const statusDe = async (m: { pontoId: number }) => (await db.select({ status: pontos.status }).from(pontos).where(eq(pontos.id, m.pontoId)))[0]?.status;
    const logins = (cpf: string) => portal.loginsPorCpf[cpf] ?? 0;
    const situacoes = async () =>
      (await db.select().from(portalSituacoes).orderBy(asc(portalSituacoes.codigo))).map((s) => `${s.codigo}=${s.turno}`);
    const leiturasDe = (m: { id: number }) => db.select().from(portalLeituras).where(eq(portalLeituras.motoristaId, m.id)).orderBy(asc(portalLeituras.id));
    const acessoDe = async (m: { id: number }) => (await db.select().from(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, m.id)))[0];
    const historico = async (codigo: string, acao: string) =>
      (await db.select().from(eventos).orderBy(asc(eventos.id))).filter((e) => e.acao === acao && e.codigo === codigo);
    const minutosAte = (d: Date | null | undefined) => (d ? (d.getTime() - Date.now()) / 60_000 : null);

    /* 1 — primeira rodada: um login por conta, a situação vira o ponto de partida e NINGUÉM é avisado. */
    definirQuadro(183, [32, 40, 50, 60, 70, 71, 80]);
    let resumo = await executar();
    let rodada = novos();
    assert.equal(await statusDe(alfa), "NA VEZ");
    assert.equal(de(rodada, alfa, "chamada").length, 1, "o quadro continua avisando a vez");
    assert.deepEqual(rodada.filter((a) => a.acao !== "chamada"), [], "a primeira leitura não é novidade");
    assert.deepEqual({ alfa: logins(CPF.alfa), bravo: logins(CPF.bravo), charlie: logins(CPF.charlie), eco: logins(CPF.eco), fox: logins(CPF.fox) }, { alfa: 1, bravo: 1, charlie: 1, eco: 1, fox: 1 });
    assert.equal(portal.logins, 5, "quem não cadastrou o acesso (Delta) não tem conta aberta");
    // Cartão de outro ponto nunca vira a situação deste: o A080 do Fox fica sem situação.
    assert.deepEqual(await situacoes(), ["A032=ATIVO", "A040=ATIVO", "A070=ATIVO", "A071=ATIVO"]);
    assert.equal(resumo?.motoristas, 5);
    assert.equal(resumo?.lidos, 3);
    assert.equal(resumo?.logins, 5);
    pedidosNovos();

    /* 2 — de novo no mesmo minuto: ninguém é relido. */
    await executar();
    assert.deepEqual(pedidosNovos(), [], "a leitura é de minuto em minuto, não a cada chamada");
    assert.deepEqual(novos(), []);

    /* 3 — minuto seguinte: sessão guardada = UM pedido por conta e nenhum login. */
    telasDe(CPF.alfa)["moto/status"] = status(cartao("A032", "ATIVO", ["Desde hoje, 07:00 · há 6 min"], "ALFA TESTE DA SILVA"));
    await adiantar();
    resumo = await executar();
    assert.deepEqual(pedidosNovos().sort(), ["GET moto/status", "GET moto/status", "GET moto/status", "GET moto/status"], "um pedido por motorista com sessão");
    assert.equal(portal.logins, 5, "com a sessão aberta não há login");
    assert.equal(resumo?.logins, 0);
    assert.deepEqual(novos(), []);
    // A mesma tela (só o “há N min” andou) não vira outra linha no histórico.
    const leiturasAlfa = await leiturasDe(alfa);
    assert.equal(leiturasAlfa.length, 1);
    assert.match(JSON.stringify(leiturasAlfa[0].secoes), /há 6 min/);
    // O diagnóstico conta o que houve nesta leitura — e não chama de “primeira
    // leitura” o que acontece todo minuto.
    assert.match(leiturasAlfa[0].diagnostico ?? "", /Sessão guardada reaproveitada/);
    assert.doesNotMatch(leiturasAlfa[0].diagnostico ?? "", /Primeira leitura/);
    // Senha recusada: o freio segura o segundo login (e isso não vira “leitura”).
    assert.equal(logins(CPF.charlie), 1);
    assert.equal((await leiturasDe(charlie)).length, 1);
    assert.ok((minutosAte((await acessoDe(charlie)).proximaLeituraEm) ?? 0) > 5, "o próximo login do Charlie espera o freio");

    /* 4 — o portal passa a mostrar ESCALADO. O QUADRO NÃO MUDOU: o aviso sai assim mesmo. */
    telasDe(CPF.alfa)["moto/status"] = status(
      cartao("A032", "ESCALADO", ["Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"], "ALFA TESTE DA SILVA"),
    );
    await adiantar();
    resumo = await executar();
    rodada = novos();
    assert.equal(await statusDe(alfa), "NA VEZ", "o quadro ainda mostra o número — e não é ele que decide");
    const avisoAlfa = de(rodada, alfa);
    assert.equal(avisoAlfa.length, 1, "um aviso só");
    assert.equal(avisoAlfa[0].acao, "saiu");
    assert.equal(avisoAlfa[0].title, "🚛 Seu ponto foi ESCALADO");
    // As informações do Status, linha por linha — sem o nome dele, o botão ou o rodapé do site.
    assert.equal(
      avisoAlfa[0].body,
      ["Olá, Alfa Teste! Seu ponto A032 foi ESCALADO.", "Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"].join("\n"),
    );
    assert.equal(portal.logins, 5, "a troca foi vista com a sessão guardada");
    assert.equal(resumo?.avisos, 1);
    assert.deepEqual((await situacoes()).filter((s) => s.startsWith("A032")), ["A032=ESCALADO"]);
    const saidasAlfa = await historico("A32", "saiu");
    assert.equal(saidasAlfa.length, 1);
    assert.match(saidasAlfa[0].mensagem, /^A032 foi ESCALADO\. · Desde hoje, 11:32 · há 2 min · Navio: NAVIO DE EXEMPLO/);
    const registrosAlfa = await db.select().from(portalEventos).where(eq(portalEventos.motoristaId, alfa.id));
    assert.equal(registrosAlfa.length, 1);
    assert.deepEqual(
      { modo: registrosAlfa[0].modo, destino: registrosAlfa[0].destino, turno: registrosAlfa[0].turno, codigo: registrosAlfa[0].codigo, tipo: registrosAlfa[0].tipo },
      { modo: "automatico", destino: "motorista", turno: "ESCALADO", codigo: "A032", tipo: "saida" },
    );
    assert.match(registrosAlfa[0].diagnostico ?? "", /ATIVO → ESCALADO/);
    // Terceira leitura seguida sem a situação do A080: o Fox fica sabendo que está sem aviso de saída.
    const alertaFox = de(rodada, fox);
    assert.equal(alertaFox.length, 1);
    assert.equal(alertaFox[0].title, "⚠️ Portal do motorista");
    assert.match(alertaFox[0].body, /aviso de saída fica parado/);
    assert.equal(rodada.length, 2, "ninguém mais é avisado");
    assert.ok((minutosAte((await acessoDe(fox)).proximaLeituraEm) ?? 0) > 3, "depois de 3 falhas a leitura do Fox espera 5 min");
    const ultimaFox = (await leiturasDe(fox)).pop();
    assert.equal(ultimaFox?.ok, 0);
    assert.match(ultimaFox?.diagnostico ?? "", /não mostrou a situação do ponto A080/);
    pedidosNovos();

    /* 5 — continua ESCALADO: nada se repete. */
    await adiantar();
    await executar();
    assert.deepEqual(novos(), []);
    assert.equal((await historico("A32", "saiu")).length, 1);
    pedidosNovos();

    /* 6 — o número sai do QUADRO (A032 escalado; A060 some): o quadro não avisa a saída de ninguém. */
    definirQuadro(32, [40, 50, 70, 71, 80]);
    await executar();
    rodada = novos();
    assert.equal(await statusDe(alfa), "SAIU");
    assert.equal(await statusDe(delta), "SAIU");
    assert.deepEqual(rodada.filter((a) => a.acao === "saiu"), [], "a saída do quadro não gera aviso");
    assert.deepEqual(de(rodada, delta), [], "sem acesso ao portal não há aviso de saída");
    assert.equal(de(rodada, bravo, "chamada").length, 1, "o quadro segue avisando quem chegou à vez");
    assert.deepEqual(await db.select().from(portalSaidasPendentes), [], "nada fica esperando o portal");
    assert.match((await historico("A60", "quadro"))[0]?.mensagem ?? "", /sem aviso de saída: motorista sem acesso ao Portal do Motorista/);
    assert.match((await historico("A32", "quadro"))[0]?.mensagem ?? "", /quem avisa a saída é o Status do Portal do Motorista/);
    assert.deepEqual(pedidosNovos(), [], "sair do quadro não faz ninguém ser relido fora da hora");

    /* 7 — o portal volta a mostrar ATIVO (e o número volta ao quadro): UM aviso de volta, o do portal. */
    telasDe(CPF.alfa)["moto/status"] = status(cartao("A032", "ATIVO", ["Desde hoje, 15:40"], "ALFA TESTE DA SILVA"));
    definirQuadro(33, [40, 50, 70, 71, 80, 32, 60]); // outro número já foi escalado depois dele
    await adiantar();
    await executar();
    rodada = novos();
    const voltaAlfa = de(rodada, alfa);
    assert.equal(voltaAlfa.length, 1);
    assert.equal(voltaAlfa[0].acao, "voltou");
    assert.equal(voltaAlfa[0].title, "🟦 Seu ponto está ATIVO");
    assert.equal(voltaAlfa[0].body, "Olá, Alfa Teste! Seu ponto A032 voltou para a fila: o Status do Portal do Motorista mostra ATIVO (antes: ESCALADO).");
    assert.deepEqual(de(rodada, delta), [], "sem acesso ao portal também não há aviso de volta");
    assert.equal(rodada.length, 1);
    assert.equal(await statusDe(alfa), "AGUARDANDO");

    /* 8 — DISPENSA: o motivo vai no aviso. */
    telasDe(CPF.bravo)["moto/status"] = status(cartao("A040", "EM DISPENSA", ["Desde hoje, 11:32 · há 9 min", "MOTIVO", "001 - OFICINA"], "BRAVO TESTE DE SOUZA"));
    await adiantar();
    await executar();
    rodada = novos();
    const dispensaBravo = de(rodada, bravo);
    assert.equal(dispensaBravo.length, 1);
    assert.equal(dispensaBravo[0].title, "🟥 Seu ponto foi para a DISPENSA");
    assert.equal(
      dispensaBravo[0].body,
      "Olá, Bravo Teste! Seu ponto A040 saiu para a DISPENSA (motivo 001 - OFICINA). Está nessa situação há 9 min. Assim que voltar para a fila, eu aviso.",
    );
    assert.equal(rodada.length, 1);
    const [situacaoBravo] = await situacoesDoMotorista(bravo.id);
    assert.equal(situacaoBravo.turno, "EM DISPENSA");
    assert.equal(situacaoFresca(situacaoBravo), true, "é o que acende o selo DISPENSA no app");

    /* 9 — motorista com dois pontos: só o que mudou é avisado, com as linhas do cartão DELE. */
    telasDe(CPF.eco)["moto/status"] = status(
      cartao("A070", "ATIVO", ["Desde hoje, 06:00"], "ECO TESTE"),
      cartao("A071", "ESCALADO", ["Navio: NAVIO DO ECO"], "ECO TESTE"),
    );
    await adiantar();
    await executar();
    rodada = novos();
    const avisoEco = de(rodada, eco);
    assert.equal(avisoEco.length, 1);
    assert.equal(avisoEco[0].body, ["Olá, Eco Teste! Seu ponto A071 foi ESCALADO.", "Navio: NAVIO DO ECO"].join("\n"));
    assert.equal(rodada.length, 1);
    assert.deepEqual((await situacoes()).filter((s) => /^A07/.test(s)), ["A070=ATIVO", "A071=ESCALADO"]);

    /* 10 — o portal encerra as sessões: a leitura seguinte entra de novo NA HORA (um login por conta) e segue lendo. */
    portal.sessoes.clear();
    pedidosNovos();
    await adiantar();
    resumo = await executar();
    assert.deepEqual(
      { alfa: logins(CPF.alfa), bravo: logins(CPF.bravo), charlie: logins(CPF.charlie), eco: logins(CPF.eco), fox: logins(CPF.fox) },
      { alfa: 2, bravo: 2, charlie: 1, eco: 2, fox: 2 },
      "uma queda da sessão é refeita na hora; a senha recusada do Charlie continua esperando",
    );
    assert.equal(resumo?.logins, 4);
    assert.equal(resumo?.lidos, 3, "a mesma leitura que entrou de novo já trouxe a situação");
    assert.equal(resumo?.adiados, 1, "só o Charlie espera: o último login dele não abriu a conta");
    assert.equal(resumo?.falhas, 1, "a conta do Fox abre, mas mostra outro ponto");
    assert.deepEqual(novos(), [], "entrar de novo não repete aviso de situação");
    assert.ok((minutosAte((await acessoDe(alfa)).proximaLeituraEm) ?? 9) < 2, "a leitura do Alfa continua de minuto em minuto");

    /* 10b — o portal derruba as sessões de novo logo em seguida: agora o freio segura (nada de um login por minuto). */
    portal.sessoes.clear();
    pedidosNovos();
    await adiantar();
    resumo = await executar();
    assert.equal(portal.logins, 9, "dois logins em seguida por conta; o terceiro espera");
    assert.ok(!pedidosNovos().some((p) => p.startsWith("POST")));
    assert.deepEqual(novos(), []);
    assert.equal(resumo?.falhas, 0, "esperar o freio não é uma falha de leitura");
    assert.equal(resumo?.adiados, 5, "as cinco contas esperam o freio — e isso aparece no resumo da rodada");
    assert.equal(resumo?.lidos, 0);
    assert.ok((minutosAte((await acessoDe(alfa)).proximaLeituraEm) ?? 0) > 5);

    /* 11 — passado o freio: um login por conta e a leitura segue. Segunda recusa do Charlie = pausa. */
    await envelhecerLogins(11);
    await adiantar();
    resumo = await executar();
    rodada = novos();
    assert.deepEqual({ alfa: logins(CPF.alfa), bravo: logins(CPF.bravo), charlie: logins(CPF.charlie), eco: logins(CPF.eco), fox: logins(CPF.fox) }, { alfa: 3, bravo: 3, charlie: 2, eco: 3, fox: 3 });
    const pausaCharlie = de(rodada, charlie);
    assert.equal(pausaCharlie.length, 1);
    assert.equal(pausaCharlie[0].title, "🔒 Portal: senha recusada");
    assert.equal(rodada.length, 1, "entrar de novo não repete aviso de situação");
    const acessoCharlie = await acessoDe(charlie);
    assert.equal(acessoCharlie.ativo, 0);
    assert.equal(acessoCharlie.sessaoCifrada, null);
    assert.ok(!(await situacoes()).some((s) => s.startsWith("A050")), "a situação de quem nunca entrou não é inventada");

    /* 12 — acesso pausado não é mais tentado. */
    await envelhecerLogins(11);
    await adiantar();
    await executar();
    assert.equal(logins(CPF.charlie), 2);
    assert.deepEqual(novos(), []);

    /* 13 — portal fora do ar: na terceira falha seguida, UM aviso de leitura parada; a sessão continua guardada. */
    portal.foraDoAr = true;
    for (let i = 0; i < 4; i += 1) {
      await adiantar();
      await executar();
    }
    rodada = novos();
    for (const m of [alfa, bravo, eco]) {
      const parada = de(rodada, m);
      assert.equal(parada.length, 1, "um aviso por sequência de falhas");
      assert.equal(parada[0].title, "⚠️ Portal do motorista");
    }
    assert.equal(rodada.length, 3);
    portal.foraDoAr = false;
    await adiantar();
    resumo = await executar();
    assert.equal(portal.logins, 14, "portal fora do ar não derruba a sessão guardada");
    assert.equal(resumo?.lidos, 3);
    assert.deepEqual(novos(), [], "a situação não mudou enquanto o portal esteve fora");

    /* 14 — duas rodadas ao mesmo tempo: cada conta é olhada uma vez e a troca gera um aviso só. */
    telasDe(CPF.bravo)["moto/status"] = status(cartao("A040", "ATIVO", ["Desde hoje, 16:05"], "BRAVO TESTE DE SOUZA"));
    pedidosNovos();
    await adiantar();
    await Promise.all([executar(), executar()]);
    rodada = novos();
    const voltaBravo = de(rodada, bravo);
    assert.equal(voltaBravo.length, 1, "duas rodadas, um aviso");
    assert.equal(voltaBravo[0].body, "Olá, Bravo Teste! Seu ponto A040 voltou para a fila: o Status do Portal do Motorista mostra ATIVO (antes: EM DISPENSA).");
    assert.equal(rodada.length, 1);
    // Alfa, Eco e Fox: um pedido cada. Bravo: a leitura e, na hora do aviso, as telas do menu.
    const pedidosParalelos = pedidosNovos();
    assert.equal(pedidosParalelos.filter((p) => p === "GET moto/status").length, 5);
    assert.ok(pedidosParalelos.length <= 8, `pedidos demais para duas rodadas: ${pedidosParalelos.join(", ")}`);

    /* 15 — ponto apagado não deixa situação guardada. */
    await db.delete(pontos).where(eq(pontos.id, eco.pontos[1]));
    await adiantar();
    await executar();
    assert.deepEqual((await situacoes()).filter((s) => /^A07/.test(s)), ["A070=ATIVO"]);
    assert.deepEqual(novos(), []);

    /* O histórico de leituras não cresce uma linha por minuto. */
    assert.ok((await leiturasDe(alfa)).length <= 12, `leituras demais guardadas: ${(await leiturasDe(alfa)).length}`);
    /* Cada aviso de situação tem a própria tag. */
    const deSituacao = enviados.filter((a) => a.acao === "saiu" || a.acao === "voltou");
    assert.equal(deSituacao.length, new Set(deSituacao.map((a) => a.tag)).size);
    assert.equal(deSituacao.length, 5);

    /* Segredos: CPF, senha e cookie nunca vão para avisos, histórico ou diagnóstico. */
    const guardado = JSON.stringify([
      enviados,
      await db.select().from(eventos),
      await db.select().from(portalEventos),
      await db.select().from(portalLeituras),
      await db.select().from(portalSituacoes),
      await pool.query("select * from notificacoes").then((r) => r.rows),
    ]);
    for (const segredo of [...Object.values(CPF), ...Object.values(SENHA), SENHA_ERRADA_CHARLIE]) {
      assert.ok(!guardado.includes(segredo), "CPF ou senha apareceu em aviso/histórico/diagnóstico");
    }
    assert.doesNotMatch(guardado, /PHPSESSID|logado\d|visitante\d/);
    // A sessão guardada é cifrada como a senha: nem o cookie aparece no banco.
    const acessos = JSON.stringify(await db.select().from(portalMotoristaAcessos));
    for (const segredo of [...Object.values(CPF), ...Object.values(SENHA), SENHA_ERRADA_CHARLIE]) {
      assert.ok(!acessos.includes(segredo), "CPF ou senha guardado sem cifra");
    }
    assert.doesNotMatch(acessos, /PHPSESSID|logado\d|visitante\d/);
    assert.ok((await acessoDe(alfa)).sessaoCifrada, "a sessão do Alfa está guardada");

    /* O leitor só olhou: nenhum botão de ação e nada fora do portal. */
    assert.deepEqual(portal.acoes, []);
    assert.deepEqual(portal.foraDoSite, []);
    assert.ok(!desconhecidos.some((u) => /copadubo/i.test(u)), `pedido ao site de verdade: ${desconhecidos.join(", ")}`);

    /* Senha cadastrada de novo: sessão e freio antigos não valem para a senha nova. */
    await salvarAcessoPortal(charlie.id, { cpf: CPF.charlie, senha: SENHA.charlie });
    assert.equal((await acessoDe(charlie)).sessaoCifrada, null);
    await executar();
    rodada = novos();
    assert.equal(logins(CPF.charlie), 3, "a senha nova é usada na hora, sem esperar o freio da antiga");
    assert.deepEqual((await situacoes()).filter((s) => s.startsWith("A050")), ["A050=ESCALADO"]);
    assert.deepEqual(de(rodada, charlie), [], "já estava ESCALADO quando o app olhou pela primeira vez: não é novidade");

    /* Cadastro excluído: nada do portal daquele motorista fica no banco. */
    await excluirCadastroMotorista(bravo.id);
    for (const tabela of ["portal_motorista_acessos", "portal_leituras", "portal_eventos", "portal_saidas_pendentes", "portal_situacoes"]) {
      const { rows } = await pool.query(`select count(*)::int as n from ${tabela} where motorista_id = $1`, [bravo.id]);
      assert.equal(rows[0].n, 0, `${tabela} ainda guarda dados do motorista excluído`);
    }
    assert.ok((await situacoes()).length >= 3, "só os dados do motorista excluído saem");
  } finally {
    globalThis.fetch = fetchReal;
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: originalSend });
    await pool.end();
  }
});
