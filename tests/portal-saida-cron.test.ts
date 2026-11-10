import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, telaFila, telaStatus } from "./portal-fixture";

/**
 * SAÍDA DO PONTO, DE PONTA A PONTA: quadro → SAIU → login no Portal do
 * Motorista → situação do ponto (ATIVO / ESCALADO / EM DISPENSA) → UM aviso.
 *
 * Teste de integração isolado: nunca rode com o banco de produção. Use um
 * PostgreSQL local descartável e VAZIO chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_portal \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_portal \
 *   ./node_modules/.bin/tsx --test tests/portal-saida-cron.test.ts
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
  golf: "70000000007",
  hotel: "80000000008",
};
const SENHA = {
  alfa: "senha-alfa-1",
  bravo: "senha-bravo-2",
  charlie: "senha-certa-3",
  eco: "senha-eco-5",
  fox: "senha-fox-6",
  golf: "senha-golf-7",
  hotel: "senha-hotel-8",
};
const SENHA_ERRADA_CHARLIE = "senha-velha-errada";

type Aviso = { title: string; body: string; tag: string; acao: string; endpoint: string };

test("saída do ponto: um login no portal e um aviso só, com o que o portal mostra", { skip: !local }, async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-este-teste-0123456789";
  process.env.COMPOSIO_API_KEY = "";

  const { db, pool } = await import("../src/db");
  const { eventos, motoristas, pontos, portalEventos, portalLeituras, portalMotoristaAcessos, portalSaidasPendentes, subscriptions } =
    await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { salvarAcessoPortal, ultimaLeituraPortal } = await import("../src/lib/portal-copadubo");
  const { pontoEmDispensa } = await import("../src/lib/portal-status-ponto");
  const { excluirCadastroMotorista } = await import("../src/lib/motorista-inatividade");
  const { GET } = await import("../src/app/api/cron/route");
  const { asc, eq, sql } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;

  /* ------------------------------------------------ portal de mentira */
  const cartao = (codigo: string, situacao: string, linhas: string[], nome: string) =>
    telaStatus([{ codigo, situacao, linhas, nome, botao: situacao === "EM DISPENSA" ? "Sair da dispensa" : "Entrar em dispensa" }]);
  const portal = criarPortalFalso({
    cpf: CPF.alfa,
    senha: SENHA.alfa,
    telas: {
      "moto/status": cartao("A032", "ESCALADO", ["Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"], "ALFA TESTE DA SILVA"),
      "moto/fila": telaFila("A", "A032", [{ codigo: "A040", tipo: "CARRETA 6 EIXOS" }]),
    },
    contas: {
      [CPF.bravo]: { senha: SENHA.bravo, telas: { "moto/status": cartao("A040", "ATIVO", ["Desde hoje, 07:10"], "BRAVO TESTE DE SOUZA") } },
      [CPF.charlie]: { senha: SENHA.charlie, telas: { "moto/status": cartao("A050", "ESCALADO", ["Navio: NAO DEVE APARECER"], "CHARLIE TESTE") } },
      [CPF.eco]: { senha: SENHA.eco, telas: { "moto/status": cartao("A070", "ATIVO", ["Desde hoje, 06:00"], "ECO TESTE") } },
      [CPF.fox]: { senha: SENHA.fox, telas: { "moto/status": cartao("A080", "ESCALADO", ["Navio: NAVIO DO FOX", "Terminal: TERMINAL UM"], "FOX TESTE") } },
      [CPF.golf]: { senha: SENHA.golf, telas: { "moto/status": cartao("A090", "ESCALADO", ["Navio: NAVIO DO GOLF", "Terminal: TERMINAL DOIS"], "GOLF TESTE") } },
      [CPF.hotel]: { senha: SENHA.hotel, telas: { "moto/status": cartao("A095", "ESCALADO", ["Navio: NAVIO DO HOTEL"], "HOTEL TESTE") } },
    },
  });

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

    const criar = async (nome: string, numero: number, acesso?: { cpf: string; senha: string }) => {
      const [m] = await db.insert(motoristas).values({ nome }).returning();
      const [p] = await db.insert(pontos).values({ tipo: "CAVALO", livro: "A", numero, motoristaId: m.id, status: "AGUARDANDO" }).returning();
      const endpoint = `https://fcm.googleapis.com/fcm/send/portal-saida-${numero}`;
      await db.insert(subscriptions).values({ endpoint, p256dh: chaves.publicKey, auth: "teste-sem-rede", motoristaId: m.id });
      if (acesso) await salvarAcessoPortal(m.id, acesso);
      return { id: m.id, pontoId: p.id, endpoint, numero };
    };
    const alfa = await criar("Alfa Teste", 32, { cpf: CPF.alfa, senha: SENHA.alfa });
    const bravo = await criar("Bravo Teste", 40, { cpf: CPF.bravo, senha: SENHA.bravo });
    const charlie = await criar("Charlie Teste", 50, { cpf: CPF.charlie, senha: SENHA_ERRADA_CHARLIE });
    const delta = await criar("Delta Teste", 60); // sem CPF/senha do portal
    const eco = await criar("Eco Teste", 70, { cpf: CPF.eco, senha: SENHA.eco });
    const fox = await criar("Fox Teste", 80, { cpf: CPF.fox, senha: SENHA.fox });
    const golf = await criar("Golf Teste", 90, { cpf: CPF.golf, senha: SENHA.golf });
    const hotel = await criar("Hotel Teste", 95, { cpf: CPF.hotel, senha: SENHA.hotel });

    const executar = async () => {
      const res = await GET(new Request("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(res.status, 200);
      const dados = (await res.json()) as { origem?: string };
      assert.equal(dados.origem, "intranet");
    };
    /** Avisos recebidos desde a última chamada. */
    let lidos = 0;
    const novos = () => {
      const fatia = enviados.slice(lidos);
      lidos = enviados.length;
      return fatia;
    };
    const de = (lista: Aviso[], m: { endpoint: string }, acao?: string) => lista.filter((a) => a.endpoint === m.endpoint && (!acao || a.acao === acao));
    const statusDe = async (m: { pontoId: number }) => (await db.select({ status: pontos.status }).from(pontos).where(eq(pontos.id, m.pontoId)))[0]?.status;
    const pendentes = () => db.select().from(portalSaidasPendentes).orderBy(asc(portalSaidasPendentes.id));
    const saidasNoHistorico = async (codigo: string) =>
      (await db.select().from(eventos).orderBy(asc(eventos.id))).filter((e) => e.acao === "saiu" && e.codigo === codigo);
    const logins = (cpf: string) => portal.loginsPorCpf[cpf] ?? 0;
    /** Faz o tempo “passar” para a nova consulta de um ponto em espera. */
    const adiantar = (m: { pontoId: number }) =>
      db.execute(sql`update portal_saidas_pendentes set proxima_em = now() - interval '1 second' where ponto_id = ${m.pontoId}`);

    /* 1 — todos na fila: o app NÃO entra na conta de ninguém. */
    definirQuadro(183, [32, 40, 50, 60, 70, 80, 90, 95]);
    await executar();
    let rodada = novos();
    assert.equal(await statusDe(alfa), "NA VEZ");
    assert.equal(de(rodada, alfa, "chamada").length, 1);
    await executar();
    assert.equal(portal.logins, 0, "com o ponto na fila não há por que entrar no portal");
    assert.equal(portal.pedidos.length, 0);
    assert.equal(novos().length, 0);

    /* 2 — A032 vira o Último Escalado e o portal mostra ESCALADO. */
    definirQuadro(32, [40, 50, 60, 70, 80, 90, 95]);
    await executar();
    rodada = novos();
    assert.equal(await statusDe(alfa), "SAIU");
    const avisoAlfa = de(rodada, alfa);
    assert.equal(avisoAlfa.length, 1, "um aviso só — não o do quadro e depois o do portal");
    assert.equal(avisoAlfa[0].acao, "saiu");
    assert.equal(avisoAlfa[0].title, "🚛 Seu ponto foi ESCALADO");
    // O app guarda “A32”; o portal escreve “A032”: é o mesmo ponto.
    assert.equal(
      avisoAlfa[0].body,
      ["Olá, Alfa Teste! Seu ponto A032 foi ESCALADO.", "Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"].join("\n"),
    );
    assert.match(avisoAlfa[0].tag, /^SAIU_/);
    assert.equal(logins(CPF.alfa), 1, "uma saída = um login");
    assert.equal(portal.logins, 1, "só a conta do dono do ponto foi aberta");
    assert.deepEqual(await pendentes(), []);
    const historicoAlfa = await saidasNoHistorico("A32");
    assert.equal(historicoAlfa.length, 1);
    assert.match(historicoAlfa[0].mensagem, /^A032 foi ESCALADO\. · Desde hoje, 11:32 · há 2 min · Navio: NAVIO DE EXEMPLO/);
    const registrosAlfa = await db.select().from(portalEventos).where(eq(portalEventos.motoristaId, alfa.id));
    assert.equal(registrosAlfa.length, 1);
    assert.deepEqual(
      { modo: registrosAlfa[0].modo, destino: registrosAlfa[0].destino, turno: registrosAlfa[0].turno, codigo: registrosAlfa[0].codigo, tipo: registrosAlfa[0].tipo },
      { modo: "automatico", destino: "motorista", turno: "ESCALADO", codigo: "A032", tipo: "saida" },
    );
    assert.match(registrosAlfa[0].diagnostico ?? "", /Consulta automática nº 1 · Portal: ESCALADO\./);
    assert.match(registrosAlfa[0].diagnostico ?? "", /Login aceito pelo portal\./);
    // A040 passou a ser o primeiro do quadro: o aviso dele não muda.
    assert.equal(de(rodada, bravo, "chamada").length, 1);

    /* 3 — nada mudou: nem aviso repetido, nem login novo. */
    await executar();
    await executar();
    assert.equal(novos().length, 0);
    assert.equal(portal.logins, 1);

    /* 4 — A040 some do quadro (sem ser o Último) e o portal ainda diz ATIVO: espera. */
    definirQuadro(32, [50, 60, 70, 80, 90, 95]);
    await executar();
    rodada = novos();
    assert.equal(await statusDe(bravo), "SAIU");
    assert.equal(de(rodada, bravo, "saiu").length, 0, "portal ATIVO e número só sumiu: ainda não é hora de avisar");
    assert.equal(logins(CPF.bravo), 1);
    let fila = await pendentes();
    assert.equal(fila.length, 1);
    assert.deepEqual(
      { ponto: fila[0].pontoId, tentativas: fila[0].tentativas, ultimoStatus: fila[0].ultimoStatus, reservado: fila[0].emAndamentoAte },
      { ponto: bravo.pontoId, tentativas: 1, ultimoStatus: "ATIVO", reservado: null },
    );
    assert.ok(fila[0].proximaEm.getTime() - Date.now() > 50_000, "a nova consulta fica para daqui a 1 minuto");
    // Antes da hora marcada, nenhum login a mais.
    await executar();
    assert.equal(logins(CPF.bravo), 1, "o portal não é consultado de novo antes da hora marcada");
    assert.equal(de(novos(), bravo, "saiu").length, 0);

    /* 5 — o número volta ao quadro antes do aviso: cancela, sem “saiu” nem “voltou”. */
    definirQuadro(32, [50, 40, 60, 70, 80, 90, 95]);
    await executar();
    rodada = novos();
    assert.equal(await statusDe(bravo), "AGUARDANDO");
    assert.equal(de(rodada, bravo).length, 0, "a saída nunca foi avisada: a volta também não é");
    assert.deepEqual(await pendentes(), []);
    assert.equal((await saidasNoHistorico("A40")).length, 0);
    assert.ok((await db.select().from(eventos)).some((e) => e.acao === "voltou" && /A40 voltou ao quadro antes do aviso de saída/.test(e.mensagem)));
    assert.equal(logins(CPF.bravo), 1);

    /* 6 — A040 some de novo; agora o portal diz EM DISPENSA, com o motivo. */
    portal.contas[CPF.bravo].telas["moto/status"] = cartao("A040", "EM DISPENSA", ["Desde hoje, 11:40 · há 3 min", "MOTIVO", "001 - OFICINA"], "BRAVO TESTE DE SOUZA");
    definirQuadro(32, [50, 60, 70, 80, 90, 95]);
    await executar();
    rodada = novos();
    const avisoBravo = de(rodada, bravo);
    assert.equal(avisoBravo.length, 1);
    assert.equal(avisoBravo[0].title, "🟥 Seu ponto foi para a DISPENSA");
    assert.equal(
      avisoBravo[0].body,
      "Olá, Bravo Teste! Seu ponto A040 saiu para a DISPENSA (motivo 001 - OFICINA). Está nessa situação há 3 min. Assim que voltar para a fila, eu aviso.",
    );
    assert.equal(logins(CPF.bravo), 2);
    assert.deepEqual(portal.acoes, [], "o leitor abriu um botão de ação (dispensa/sair)");
    // A mesma leitura alimenta o selo DISPENSA do ponto no app.
    const leituraBravo = await ultimaLeituraPortal(bravo.id);
    const [pontoBravo] = await db.select().from(pontos).where(eq(pontos.id, bravo.pontoId));
    assert.equal(pontoEmDispensa(leituraBravo, { livro: "A", numero: 40, criadoEm: pontoBravo.criadoEm.toISOString() }), true);

    /* 7 — senha errada: aviso do quadro na hora; na 2ª recusa o acesso é pausado. */
    definirQuadro(32, [60, 70, 80, 90, 95]); // A050 some
    await executar();
    rodada = novos();
    let avisoCharlie = de(rodada, charlie, "saiu");
    assert.equal(avisoCharlie.length, 1, "senha recusada não pode deixar o motorista sem aviso");
    assert.equal(avisoCharlie[0].title, "🚛 Monitor Ponto CopaLinks");
    assert.match(avisoCharlie[0].body, /^Olá, Charlie Teste! Seu número A50 não aparece mais no quadro\. O destino não foi confirmado no Portal do Motorista\./);
    assert.doesNotMatch(avisoCharlie[0].body, /NAO DEVE APARECER/);
    assert.equal(logins(CPF.charlie), 1, "senha recusada não é tentada de novo na mesma saída");
    assert.equal((await db.select().from(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, charlie.id)))[0].ativo, 1);

    definirQuadro(32, [60, 50, 70, 80, 90, 95]); // volta…
    await executar();
    assert.equal(de(novos(), charlie, "voltou").length, 1);
    definirQuadro(32, [60, 70, 80, 90, 95]); // …e sai de novo
    await executar();
    rodada = novos();
    assert.equal(de(rodada, charlie, "saiu").length, 1, "a segunda saída tem o próprio aviso");
    assert.equal(logins(CPF.charlie), 2);
    assert.equal((await db.select().from(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, charlie.id)))[0].ativo, 0, "duas recusas seguidas pausam o acesso");
    const pausa = de(rodada, charlie, "portal");
    assert.equal(pausa.length, 1);
    assert.equal(pausa[0].title, "🔒 Portal: senha recusada");

    definirQuadro(32, [60, 50, 70, 80, 90, 95]);
    await executar();
    definirQuadro(32, [60, 70, 80, 90, 95]);
    await executar();
    rodada = novos();
    avisoCharlie = de(rodada, charlie, "saiu");
    assert.equal(avisoCharlie.length, 1, "com o acesso pausado o aviso do quadro continua saindo");
    assert.equal(logins(CPF.charlie), 2, "acesso pausado: nenhuma tentativa a mais na conta do motorista");
    assert.equal(de(rodada, charlie, "portal").length, 0, "o aviso da pausa é um só");

    /* 8 — motorista sem CPF/senha: aviso do quadro, nenhum login. */
    const loginsAntes = portal.logins;
    definirQuadro(32, [70, 80, 90, 95]); // A060 some
    await executar();
    rodada = novos();
    const avisoDelta = de(rodada, delta, "saiu");
    assert.equal(avisoDelta.length, 1);
    assert.match(avisoDelta[0].body, /Seu número A60 não aparece mais no quadro\. O destino não foi confirmado no Portal do Motorista\./);
    assert.equal(portal.logins, loginsAntes);

    /* 9 — portal continua ATIVO: consulta de novo em +1, +2 e +3 min; depois avisa dizendo isso. */
    definirQuadro(32, [80, 90, 95]); // A070 some
    for (let consulta = 1; consulta <= 3; consulta += 1) {
      await executar();
      assert.equal(logins(CPF.eco), consulta);
      assert.equal(de(novos(), eco, "saiu").length, 0, `consulta ${consulta}: ainda ATIVO, ainda esperando`);
      fila = await pendentes();
      assert.deepEqual(fila.map((s) => [s.pontoId, s.tentativas]), [[eco.pontoId, consulta]]);
      await adiantar(eco);
    }
    await executar();
    rodada = novos();
    const avisoEco = de(rodada, eco, "saiu");
    assert.equal(avisoEco.length, 1, "depois das novas consultas o aviso tem de sair");
    assert.equal(avisoEco[0].title, "🚛 Monitor Ponto CopaLinks");
    assert.match(
      avisoEco[0].body,
      /^Olá, Eco Teste! Seu número A70 não aparece mais no quadro\. No Portal do Motorista o ponto continua ATIVO, sem escala nem dispensa registradas\./,
    );
    assert.equal(logins(CPF.eco), 4);
    assert.deepEqual(await pendentes(), []);
    await executar();
    assert.equal(novos().length, 0);
    assert.equal(logins(CPF.eco), 4, "depois do aviso, ninguém volta a entrar por causa desta saída");

    /* 10 — dois motoristas saem na mesma leitura: uma conta de cada vez, cada um com os seus dados. */
    definirQuadro(90, [95]); // A080 some; A090 vira o Último Escalado
    await executar();
    rodada = novos();
    const avisoFox = de(rodada, fox, "saiu");
    const avisoGolf = de(rodada, golf, "saiu");
    assert.equal(avisoFox.length, 1);
    assert.equal(avisoGolf.length, 1);
    assert.equal(avisoFox[0].body, "Olá, Fox Teste! Seu ponto A080 foi ESCALADO.\nNavio: NAVIO DO FOX\nTerminal: TERMINAL UM");
    assert.equal(avisoGolf[0].body, "Olá, Golf Teste! Seu ponto A090 foi ESCALADO.\nNavio: NAVIO DO GOLF\nTerminal: TERMINAL DOIS");
    assert.equal(logins(CPF.fox), 1);
    assert.equal(logins(CPF.golf), 1);
    assert.equal(portal.maxSimultaneos, 1, "um ciclo abriu duas contas do portal ao mesmo tempo");
    assert.equal((await saidasNoHistorico("A80")).length, 1);
    assert.equal((await saidasNoHistorico("A90")).length, 1);

    /* 11 — dois ciclos ao mesmo tempo (cron + app aberto): um login e um aviso só. */
    definirQuadro(95, []); // A095 vira o Último Escalado
    await Promise.all([executar(), executar()]);
    await executar();
    rodada = novos();
    const avisoHotel = de(rodada, hotel, "saiu");
    assert.equal(avisoHotel.length, 1, "dois ciclos simultâneos não podem repetir o aviso");
    assert.equal(avisoHotel[0].body, "Olá, Hotel Teste! Seu ponto A095 foi ESCALADO.\nNavio: NAVIO DO HOTEL");
    assert.equal(logins(CPF.hotel), 1, "dois ciclos simultâneos não podem fazer dois logins na mesma conta");
    assert.equal((await saidasNoHistorico("A95")).length, 1);

    /* Para todos: uma linha de histórico por saída avisada e nenhuma espera sobrando. */
    assert.deepEqual(await pendentes(), []);
    assert.equal(enviados.filter((a) => a.acao === "saiu").length, new Set(enviados.filter((a) => a.acao === "saiu").map((a) => a.tag)).size);

    /* Segredos: CPF, senha e cookie nunca vão para avisos, histórico ou diagnóstico. */
    const guardado = JSON.stringify([
      enviados,
      await db.select().from(eventos),
      await db.select().from(portalEventos),
      await db.select().from(portalLeituras),
      await pool.query("select * from notificacoes").then((r) => r.rows),
    ]);
    for (const segredo of [...Object.values(CPF), ...Object.values(SENHA), SENHA_ERRADA_CHARLIE]) {
      assert.ok(!guardado.includes(segredo), "CPF ou senha apareceu em aviso/histórico/diagnóstico");
    }
    assert.doesNotMatch(guardado, /PHPSESSID|logado\d|visitante\d/);
    const acessos = JSON.stringify(await db.select().from(portalMotoristaAcessos));
    for (const segredo of [...Object.values(CPF), ...Object.values(SENHA), SENHA_ERRADA_CHARLIE]) {
      assert.ok(!acessos.includes(segredo), "CPF ou senha guardado sem cifra");
    }

    /* O leitor só olhou: nenhum botão de ação e nada fora do portal. */
    assert.deepEqual(portal.acoes, []);
    assert.deepEqual(portal.foraDoSite, []);
    assert.ok(!desconhecidos.some((u) => /copadubo/i.test(u)), `pedido ao site de verdade: ${desconhecidos.join(", ")}`);

    /* Cadastro excluído: nada do portal daquele motorista fica no banco. */
    await excluirCadastroMotorista(bravo.id);
    for (const tabela of ["portal_motorista_acessos", "portal_leituras", "portal_eventos", "portal_saidas_pendentes"]) {
      const { rows } = await pool.query(`select count(*)::int as n from ${tabela} where motorista_id = $1`, [bravo.id]);
      assert.equal(rows[0].n, 0, `${tabela} ainda guarda dados do motorista excluído`);
    }
    assert.ok((await db.select().from(portalMotoristaAcessos)).length >= 4, "só os dados do motorista excluído saem");
  } finally {
    globalThis.fetch = fetchReal;
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: originalSend });
    await pool.end();
  }
});
