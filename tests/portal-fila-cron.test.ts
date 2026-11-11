import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, quadroFalso, telaStatus, type CartaoFalso, type FilaFalsa } from "./portal-fixture";

/**
 * A FILA DO APP VEM DA ABA “FILA” DO PORTAL — DE PONTA A PONTA, PELO CRON.
 *
 * O quadro público foi desligado. A fila (card principal, posição de cada
 * ponto, avisos de “perto da vez” e “na vez”) passou a ser a “Tela de Ativos”
 * do Portal do Motorista, lida com a sessão de um motorista que cadastrou o
 * acesso, na carona da olhada do Status. O que ela traz vale para TODOS os
 * motoristas do app — inclusive quem não cadastrou CPF e senha.
 *
 * Teste de integração isolado: nunca rode com o banco de produção. Use um
 * PostgreSQL local descartável e VAZIO chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_filaportal \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_filaportal \
 *   ./node_modules/.bin/tsx --test tests/portal-fila-cron.test.ts
 *
 * Nada sai da máquina; pessoas, CPFs, placas e filas são inventados.
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

// CPFs com os dígitos verificadores ERRADOS de propósito (não são de ninguém) e senhas inventadas.
const CPF_ALFA = "70000000011";
const SENHA_ALFA = "senha-alfa-11";
const CPF_CHARLIE = "70000000022";
const SENHA_CHARLIE = "senha-charlie-22";

type Aviso = { title: string; body: string; tag: string; acao: string; endpoint: string };

test("a aba “Fila” do portal alimenta o card, a posição e os avisos de vez de todos os motoristas", { skip: !local }, async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-este-teste-0123456789";
  process.env.COMPOSIO_API_KEY = "";
  delete process.env.PORTAL_FONTE_SAIDA;
  delete process.env.PORTAL_INTERVALO_MIN;
  delete process.env.FONTE_FILA;
  delete process.env.PORTAL_FILA_LIVROS;

  const { db, pool } = await import("../src/db");
  const { eventos, motoristas, pontos, portalFila, subscriptions } = await import("../src/db/schema");
  const { garantirTabelas, montarEstado, varrer } = await import("../src/lib/estado");
  const { removerAcessoPortal, salvarAcessoPortal } = await import("../src/lib/portal-copadubo");
  const { CARONA_DA_FILA_ATE_MS, monitorarMotorista, monitorarStatusDoMotorista, resumoDoMonitor } = await import("../src/lib/portal-monitor");
  const { GET } = await import("../src/app/api/cron/route");
  const { desc, eq, sql } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;

  /* ------------------------------------------------- portal de mentira */
  const cartao = (codigo: string, situacao: string): CartaoFalso => ({ codigo, situacao, linhas: ["Ativado hoje, 06:10"], botao: "Entrar na dispensa" });
  const fila: FilaFalsa = {
    livros: {
      A: { truck: quadroFalso("A", 196, [199, 9, 132, 172, 185], "TRUCK BA 2E"), carreta: quadroFalso("A", 25, [26, 28, 29, 30, 32, 33]) },
      B: { truck: quadroFalso("B", 164, [3, 7], "TRUCK 4 EIXOS"), carreta: quadroFalso("B", 34, [40, 41]) },
    },
  };
  const carretasA = (ultimo: number, numeros: number[]) => {
    fila.livros.A!.carreta = quadroFalso("A", ultimo, numeros);
  };
  const portal = criarPortalFalso({
    cpf: CPF_ALFA,
    senha: SENHA_ALFA,
    telas: { "moto/status": telaStatus([cartao("A032", "ATIVO")]) },
    contas: { [CPF_CHARLIE]: { senha: SENHA_CHARLIE, telas: { "moto/status": telaStatus([cartao("A185", "ATIVO")]) } } },
    fila,
  });

  /** Pedidos ao quadro público antigo (ou a qualquer outro endereço da Copadubo): têm de ficar em zero. */
  const aoQuadroAntigo: string[] = [];
  const desconhecidos: string[] = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(`${BASE_FALSA}/`)) return portal.buscar(input, init);
    if (url.includes("/ponto/") || url.includes("intranet.copadubo")) {
      aoQuadroAntigo.push(url);
      return new Response("<html><body>A tela de ativos mudou de endereço</body></html>", { status: 200 });
    }
    if (url.includes("simport.com.br") || url.includes("open-meteo.com")) return Response.json([]);
    desconhecidos.push(url);
    return new Response("", { status: 503 });
  }) as typeof fetch;

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

    // alfa e charlie cadastraram o acesso ao portal; bravo e delta, não.
    const [alfa] = await db.insert(motoristas).values({ nome: "Alfa Teste" }).returning();
    const [bravo] = await db.insert(motoristas).values({ nome: "Bravo Teste" }).returning();
    const [charlie] = await db.insert(motoristas).values({ nome: "Charlie Teste" }).returning();
    const [delta] = await db.insert(motoristas).values({ nome: "Delta Teste" }).returning();
    const novoPonto = async (motoristaId: number, tipo: string, livro: string, numero: number, alertaPerto: number | null = null) =>
      (await db.insert(pontos).values({ tipo, livro, numero, motoristaId, status: "AGUARDANDO", alertaPerto }).returning())[0];
    const pAlfa = await novoPonto(alfa.id, "CAVALO", "A", 32);
    const pBravo = await novoPonto(bravo.id, "CAVALO", "A", 29, 1);
    const pCharlie = await novoPonto(charlie.id, "TRUCK", "A", 185);
    const pDelta = await novoPonto(delta.id, "CAVALO", "B", 40);
    const endereco = (nome: string) => `https://fcm.googleapis.com/fcm/send/fila-portal-${nome}`;
    for (const [nome, m] of [["alfa", alfa], ["bravo", bravo], ["charlie", charlie], ["delta", delta]] as const) {
      await db.insert(subscriptions).values({ endpoint: endereco(nome), p256dh: chaves.publicKey, auth: "teste-sem-rede", motoristaId: m.id });
    }
    await salvarAcessoPortal(alfa.id, { cpf: CPF_ALFA, senha: SENHA_ALFA });
    await salvarAcessoPortal(charlie.id, { cpf: CPF_CHARLIE, senha: SENHA_CHARLIE });

    type ResumoPortal = { motoristas: number; lidos: number; falhas: number; adiados: number; avisos: number; logins: number; fila: number };
    const executar = async () => {
      const res = await GET(new Request("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(res.status, 200);
      const dados = (await res.json()) as { portal?: ResumoPortal; origem?: string };
      return { portal: dados.portal ?? null, origem: dados.origem ?? null };
    };
    /** Vence a espera das contas e da fila: o próximo ciclo lê de novo. */
    const adiantar = async () => {
      await db.execute(sql`update portal_motorista_acessos set proxima_leitura_em = now() - interval '1 second'`);
      await db.execute(sql`update portal_fila set proxima_leitura_em = now() - interval '1 second'`);
    };
    let pedidosVistos = 0;
    /** Pedidos ao portal desde a última chamada (caminho + parâmetros). */
    const pedidosNovos = () => {
      const fatia = portal.pedidos.slice(pedidosVistos).map((p) => `${p.metodo} ${p.caminho}`);
      pedidosVistos = portal.pedidos.length;
      return fatia;
    };
    let avisosVistos = 0;
    const avisosNovos = () => {
      const fatia = enviados.slice(avisosVistos);
      avisosVistos = enviados.length;
      return fatia;
    };
    const pontoDe = async (id: number) => (await db.select().from(pontos).where(eq(pontos.id, id)))[0];
    const linha = (estado: Awaited<ReturnType<typeof montarEstado>>, tipo: string, livro: string) => {
      const l = estado.fila.find((x) => x.tipo === tipo && x.livro === livro);
      assert.ok(l, `sem a linha ${tipo} ${livro}`);
      return l;
    };
    const historico = async (codigo: string) =>
      (await db.select().from(eventos).where(eq(eventos.codigo, codigo)).orderBy(desc(eventos.id))).map((e) => `${e.acao}: ${e.mensagem}`);

    /* 1 — primeiro ciclo: as duas contas entram, e UMA delas abre a aba Fila. */
    let ciclo = await executar();
    let pedidos = pedidosNovos();
    assert.equal(ciclo.origem, "portal");
    assert.equal(ciclo.portal?.motoristas, 2);
    assert.equal(ciclo.portal?.lidos, 2);
    assert.equal(ciclo.portal?.logins, 2);
    assert.equal(ciclo.portal?.fila, 1, "a fila do Livro A foi lida uma vez");
    assert.equal(pedidos.filter((p) => p.startsWith("GET moto/fila")).length, 1, pedidos.join(", "));

    let estado = await montarEstado(bravo.id);
    assert.equal(estado.origem, "portal");
    assert.equal(estado.online, true);
    assert.equal(estado.temLeitura, true);
    assert.equal(linha(estado, "TRUCK", "A").naFila, 5);
    assert.equal(linha(estado, "TRUCK", "A").ultimo, 196);
    assert.equal(linha(estado, "CAVALO", "A").naFila, 6);
    assert.equal(linha(estado, "CAVALO", "A").ultimo, 25);
    assert.ok(!linha(estado, "CAVALO", "A").semLeitura, "a Carreta do Livro A tem leitura");
    // Só o Livro A é lido: B e M ficam “sem leitura”, com os números zerados.
    for (const livro of ["B", "M"]) {
      for (const tipo of ["TRUCK", "CAVALO"]) {
        assert.equal(linha(estado, tipo, livro).semLeitura, true, `${tipo} ${livro}`);
        assert.equal(linha(estado, tipo, livro).naFila, 0);
        assert.equal(linha(estado, tipo, livro).ultimo, 0);
      }
    }
    // Os números da fila não vão para o navegador (só as contagens).
    assert.deepEqual(linha(estado, "CAVALO", "A").codigos, []);

    // A posição de cada ponto vem do SEQ da tela — inclusive de quem NÃO tem acesso ao portal.
    assert.deepEqual([(await pontoDe(pAlfa.id)).status, (await pontoDe(pAlfa.id)).naFrente], ["AGUARDANDO", 4]);
    assert.deepEqual([(await pontoDe(pBravo.id)).status, (await pontoDe(pBravo.id)).naFrente], ["AGUARDANDO", 2]);
    assert.deepEqual([(await pontoDe(pCharlie.id)).status, (await pontoDe(pCharlie.id)).naFrente], ["AGUARDANDO", 4]);
    assert.equal(estado.pontos[0].posicao, 3, "bravo vê o A029 como o 3º da fila");
    // O ponto do Livro B não foi conferido (a fila dele não é lida) e a tela diz isso.
    assert.equal((await pontoDe(pDelta.id)).vistoEm, null);
    assert.equal((await pontoDe(pDelta.id)).status, "AGUARDANDO", "livro sem leitura nunca dá o ponto como “saiu”");
    const deDelta = (await montarEstado(delta.id)).pontos[0];
    assert.equal(deDelta.semFila, true);
    assert.equal(deDelta.detalhe, "sem leitura da fila do Livro B");
    assert.deepEqual(avisosNovos(), [], "a primeira fila lida é só o ponto de partida");

    /* 2 — a fila anda: o A029 fica com 1 na frente → “perto da vez” para o bravo. */
    carretasA(26, [28, 29, 30, 32, 33]);
    await adiantar();
    ciclo = await executar();
    pedidos = pedidosNovos();
    // Sessão guardada: um pedido por conta, mais UM da fila — nenhum login.
    assert.deepEqual([...pedidos].sort(), ["GET moto/fila", "GET moto/status", "GET moto/status"]);
    assert.equal(ciclo.portal?.logins, 0);
    assert.equal(ciclo.portal?.fila, 1);
    let rodada = avisosNovos();
    assert.deepEqual(rodada.map((a) => `${a.acao} → ${a.endpoint}`), [`perto → ${endereco("bravo")}`]);
    assert.deepEqual([(await pontoDe(pBravo.id)).status, (await pontoDe(pBravo.id)).naFrente], ["AGUARDANDO", 1]);
    estado = await montarEstado(bravo.id);
    assert.equal(linha(estado, "CAVALO", "A").ultimo, 26);
    assert.equal(linha(estado, "CAVALO", "A").naFila, 5);
    assert.ok(linha(estado, "CAVALO", "A").ultimoDesde, "o último escalado mudou: a hora da troca fica guardada");
    assert.equal(linha(estado, "TRUCK", "A").ultimoDesde ?? null, null, "o do Truck não mudou");

    /* 3 — o A029 chega ao SEQ 1 → “na vez”, para um motorista que não tem acesso ao portal. */
    carretasA(28, [29, 30, 32, 33]);
    await adiantar();
    await executar();
    pedidosNovos();
    rodada = avisosNovos();
    assert.deepEqual(rodada.map((a) => `${a.acao} → ${a.endpoint}`), [`chamada → ${endereco("bravo")}`]);
    assert.equal((await pontoDe(pBravo.id)).status, "NA VEZ");

    /* 4 — o A029 é escalado e sai da tela: sem acesso ao portal não há aviso de saída (quem avisa é o Status). */
    carretasA(29, [30, 32, 33]);
    await adiantar();
    await executar();
    pedidosNovos();
    assert.deepEqual(avisosNovos(), []);
    assert.equal((await pontoDe(pBravo.id)).status, "SAIU");
    assert.match((await historico("A29"))[0] ?? "", /sem aviso de saída: motorista sem acesso ao Portal do Motorista/);
    assert.deepEqual([(await pontoDe(pAlfa.id)).status, (await pontoDe(pAlfa.id)).naFrente], ["AGUARDANDO", 1]);

    /* 5 — no mesmo minuto ninguém é lido de novo: nem o Status, nem a fila. */
    ciclo = await executar();
    assert.deepEqual(pedidosNovos(), []);
    assert.equal(ciclo.portal, null);
    assert.equal(ciclo.origem, "portal", "a fila lida há pouco continua valendo");
    assert.equal((await montarEstado(alfa.id)).online, true);

    /* 6 — a resposta da fila chega pela metade: é recusada; vale a última fila boa. */
    fila.cortada = true;
    carretasA(30, [32, 33, 36, 41]);
    await adiantar();
    ciclo = await executar();
    assert.equal(pedidosNovos().filter((p) => p.startsWith("GET moto/fila")).length, 1);
    assert.equal(ciclo.portal?.fila, 0);
    assert.equal(ciclo.portal?.lidos, 2, "o Status das contas foi lido normalmente");
    let guardada = (await db.select().from(portalFila).where(eq(portalFila.livro, "A")))[0];
    assert.match(guardada.erro ?? "", /Livro A - Carreta: a página veio cortada/);
    assert.deepEqual((guardada.dados as { CAVALO: { codigos: number[] } }).CAVALO.codigos, [30, 32, 33], "a fila boa não é trocada pela cortada");
    // O diagnóstico da falha mostra o começo da tela, sem o aviso que é da conta de quem leu.
    assert.match(guardada.diagnostico ?? "", /primeiras linhas: .*Tela de Ativos/);
    assert.ok(!(guardada.diagnostico ?? "").includes("A777"), guardada.diagnostico ?? "");
    assert.deepEqual([(await pontoDe(pAlfa.id)).status, (await pontoDe(pAlfa.id)).naFrente], ["AGUARDANDO", 1]);
    assert.deepEqual(avisosNovos(), []);

    // Sem leitura boa por mais que a validade: OFFLINE. A fila velha continua
    // na tela, e ninguém é dado como “saiu” por causa dela.
    await db.execute(sql`update portal_fila set lido_em = now() - interval '4 minutes'`);
    const velha = await varrer();
    assert.equal(velha.origem, "offline");
    assert.deepEqual(velha.livros, []);
    estado = await montarEstado(alfa.id);
    assert.equal(estado.online, false);
    assert.equal(estado.temLeitura, true);
    assert.equal(linha(estado, "CAVALO", "A").naFila, 3);
    assert.ok(Date.now() - new Date(estado.atualizadoEm).getTime() > 3 * 60_000, "o contador mostra a idade da leitura de verdade");
    assert.deepEqual([(await pontoDe(pAlfa.id)).status, (await pontoDe(pAlfa.id)).naFrente], ["AGUARDANDO", 1]);
    assert.equal((await pontoDe(pCharlie.id)).status, "AGUARDANDO");

    // A tela volta inteira: a fila é lida de novo e o monitor volta a ONLINE.
    fila.cortada = false;
    await adiantar();
    ciclo = await executar();
    pedidosNovos();
    assert.equal(ciclo.portal?.fila, 1);
    assert.equal(ciclo.origem, "portal");
    guardada = (await db.select().from(portalFila).where(eq(portalFila.livro, "A")))[0];
    assert.equal(guardada.erro, null);
    assert.equal((await montarEstado(alfa.id)).online, true);
    // A032 agora é o SEQ 1 → “na vez” para o alfa.
    assert.deepEqual(avisosNovos().map((a) => `${a.acao} → ${a.endpoint}`), [`chamada → ${endereco("alfa")}`]);

    /* 7 — o portal encerra as sessões: o Status entra de novo e a fila é lida no mesmo ciclo. */
    portal.sessoes.clear();
    await adiantar();
    ciclo = await executar();
    pedidos = pedidosNovos();
    assert.equal(ciclo.portal?.logins, 2);
    assert.equal(ciclo.portal?.fila, 1);
    assert.equal(pedidos.filter((p) => p.startsWith("GET moto/fila")).length, 1);
    assert.equal(pedidos.filter((p) => p.startsWith("POST seguranca/")).length, 2, "só a leitura do Status faz login");
    assert.deepEqual(avisosNovos(), []);

    /* 8 — com `PORTAL_FILA_LIVROS=A,B` a aba “Livro B” também é lida, e o ponto do Livro B ganha posição. */
    process.env.PORTAL_FILA_LIVROS = "A,B";
    await adiantar();
    ciclo = await executar();
    pedidos = pedidosNovos();
    assert.deepEqual(pedidos.filter((p) => p.startsWith("GET moto/fila")), ["GET moto/fila", "GET moto/fila?livro=B"]);
    assert.equal(ciclo.portal?.fila, 2);
    estado = await montarEstado(delta.id);
    assert.equal(linha(estado, "CAVALO", "B").naFila, 2);
    assert.equal(linha(estado, "CAVALO", "B").ultimo, 34);
    assert.equal(linha(estado, "TRUCK", "B").naFila, 2);
    assert.equal(linha(estado, "CAVALO", "M").semLeitura, true);
    assert.equal(estado.pontos[0].semFila ?? false, false);
    assert.equal((await pontoDe(pDelta.id)).status, "NA VEZ", "B040 é o SEQ 1 da Carreta do Livro B");
    assert.deepEqual(avisosNovos().map((a) => `${a.acao} → ${a.endpoint}`), [`chamada → ${endereco("delta")}`]);
    delete process.env.PORTAL_FILA_LIVROS;

    /* 9 — o painel do administrador mostra o que a aba Fila trouxe. */
    const resumo = await resumoDoMonitor();
    assert.equal(resumo.fila.fonte, "portal");
    assert.deepEqual(resumo.fila.livros.map((l) => l.livro), ["A"]);
    assert.deepEqual(resumo.fila.livros[0].truck, { naFila: 5, ultimo: 196 });
    assert.deepEqual(resumo.fila.livros[0].carreta, { naFila: 4, ultimo: 30 });
    assert.equal(resumo.fila.livros[0].recente, true);
    assert.equal(resumo.fila.livros[0].erro, null);

    /* 9-B — leitura pedida na hora (“Ler agora”, “Salvar e ler o portal”): a aba Fila é
       aberta mesmo fora da hora, e a fila nova já vale — sem esperar o próximo ciclo. */
    fila.livros.A!.truck = quadroFalso("A", 199, [9, 132, 172, 185], "TRUCK BA 2E");
    pedidosNovos();
    const naHora = await monitorarMotorista(alfa.id);
    pedidos = pedidosNovos();
    assert.ok("filaLida" in naHora, "a leitura pelo Status diz quais livros da fila leu");
    assert.deepEqual(naHora.filaLida, ["A"]);
    assert.equal(pedidos.filter((p) => p.startsWith("GET moto/fila")).length, 1, pedidos.join(", "));
    assert.match(naHora.diagnostico.join(" "), /Fila do Livro A \(moto\/fila\): Truck 4 na fila \(último A199\) · Carreta 4 na fila \(último A030\)/);
    assert.equal((await pontoDe(pCharlie.id)).naFrente, 3, "o A185 andou uma casa sem esperar o cron");
    assert.deepEqual(avisosNovos(), []);

    /* 9-B2 — portal lento: se a conta levou tempo demais para abrir, a aba Fila fica para a
       próxima leitura. Nada é pedido e nada é reservado: outra conta abre a aba em seguida. */
    assert.deepEqual(CARONA_DA_FILA_ATE_MS, { periodica: 12_000, manual: 25_000 }, "25 s + 12 s + 14 s cabem nos 60 s do cron; 25 s + 14 s, nos 45 s do “Ler agora”");
    await adiantar();
    pedidosNovos();
    const lenta = await monitorarStatusDoMotorista(alfa.id, { origem: "periodica", caronaDaFilaAteMs: 0 });
    pedidos = pedidosNovos();
    assert.ok(lenta.rodou && lenta.entrou, "o Status foi lido normalmente");
    assert.deepEqual(lenta.filaLida, []);
    assert.equal(pedidos.filter((p) => p.startsWith("GET moto/fila")).length, 0, pedidos.join(", "));
    assert.match(lenta.diagnostico.join(" "), /Fila: não foi lida nesta visita \(o portal levou \d+ s para abrir a conta\); fica para a próxima leitura\./);
    const emSeguida = await monitorarStatusDoMotorista(charlie.id, { origem: "periodica" });
    pedidos = pedidosNovos();
    assert.ok(emSeguida.rodou, "a leitura seguinte rodou");
    assert.deepEqual(emSeguida.filaLida, ["A"], "a reserva da fila não foi gasta pela leitura lenta");
    assert.equal(pedidos.filter((p) => p.startsWith("GET moto/fila")).length, 1, pedidos.join(", "));
    assert.deepEqual(avisosNovos(), []);

    /* 9-C — o cartão de um quadro some da tela.
       Fila grande: ninguém escala 9 pontos de um minuto para o outro → a leitura não é aceita.
       Fila pequena: o portal não desenha a fila sem pontos → vale como fila vazia. */
    fila.livros.A!.truck = quadroFalso("A", 199, [9, 132, 172, 185, 186, 187, 188, 189, 190], "TRUCK BA 2E");
    await adiantar();
    await executar();
    pedidosNovos();
    assert.equal((await pontoDe(pCharlie.id)).naFrente, 3);
    fila.semCartao = "truck";
    await adiantar();
    ciclo = await executar();
    pedidos = pedidosNovos();
    assert.equal(pedidos.filter((p) => p.startsWith("GET moto/fila")).length, 1);
    assert.equal(ciclo.portal?.fila, 0, "a fila que “sumiu” não foi aceita");
    guardada = (await db.select().from(portalFila).where(eq(portalFila.livro, "A")))[0];
    assert.match(guardada.erro ?? "", /^o quadro Truck tinha 9 pontos há 1 min e agora veio fora da tela: leitura não aceita/);
    assert.equal((guardada.dados as { TRUCK: { codigos: number[] } }).TRUCK.codigos.length, 9, "a fila boa continua guardada");
    assert.match(guardada.diagnostico ?? "", /Truck 0 na fila \(o quadro não apareceu na tela\)/);
    assert.deepEqual([(await pontoDe(pCharlie.id)).status, (await pontoDe(pCharlie.id)).naFrente], ["AGUARDANDO", 3]);
    assert.deepEqual(avisosNovos(), []);

    fila.semCartao = undefined;
    fila.livros.A!.truck = quadroFalso("A", 172, [185, 186], "TRUCK BA 2E");
    await adiantar();
    await executar();
    assert.deepEqual(avisosNovos().map((a) => `${a.acao} → ${a.endpoint}`), [`chamada → ${endereco("charlie")}`], "A185 é o SEQ 1 do Truck");
    fila.semCartao = "truck";
    await adiantar();
    ciclo = await executar();
    pedidosNovos();
    assert.equal(ciclo.portal?.fila, 1, "com 2 pontos na leitura anterior, o quadro fora da tela é fila vazia");
    assert.equal((await pontoDe(pCharlie.id)).status, "SAIU");
    assert.match((await historico("A185"))[0] ?? "", /quem avisa a saída é o Status do Portal do Motorista/);
    assert.deepEqual(avisosNovos(), [], "a fila não avisa saída: quem avisa é o Status");
    estado = await montarEstado(charlie.id);
    assert.equal(linha(estado, "TRUCK", "A").naFila, 0);
    assert.equal(linha(estado, "TRUCK", "A").ultimo, 0);
    assert.ok(!linha(estado, "TRUCK", "A").semLeitura, "fila vazia não é “sem leitura”");
    assert.equal(linha(estado, "CAVALO", "A").naFila, 4, "a Carreta do mesmo livro continua lida");
    assert.equal(estado.online, true);
    fila.semCartao = undefined;

    /* 10 — quem tira o acesso ao portal sai da anotação “quem leu”; a fila geral fica. */
    const leitores = (await db.select().from(portalFila)).map((l) => l.motoristaId);
    assert.ok(leitores.every((id) => id === alfa.id || id === charlie.id), JSON.stringify(leitores));
    await removerAcessoPortal(alfa.id);
    await removerAcessoPortal(charlie.id);
    const depois = await db.select().from(portalFila);
    assert.ok(depois.every((l) => l.motoristaId === null), "a anotação de quem leu a fila some com o acesso");
    assert.ok(depois.every((l) => l.dados !== null), "a fila geral continua guardada");

    /* Em todo o percurso. */
    assert.deepEqual(aoQuadroAntigo, [], "o quadro público antigo nunca é pedido");
    assert.deepEqual(desconhecidos.filter((u) => u.includes("copadubo") || u.includes("composio")), []);
    assert.deepEqual(portal.acoes, [], "nenhuma ação do portal é aberta");
    assert.deepEqual(portal.foraDoSite, []);
    assert.ok(portal.pedidos.every((p) => p.metodo === "GET" || p.caminho.startsWith("seguranca/")), "além do login, só leitura");
    // Na tabela da fila não há nada da conta de quem leu: nem CPF, nem senha, nem cookie.
    const bruto = JSON.stringify(await db.execute(sql`select * from portal_fila`).then((r) => r.rows));
    for (const segredo of [CPF_ALFA, SENHA_ALFA, CPF_CHARLIE, SENHA_CHARLIE, "PHPSESSID", "logado", "A777"]) {
      assert.ok(!bruto.includes(segredo), `portal_fila não pode guardar “${segredo}”`);
    }
  } finally {
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: originalSend });
    globalThis.fetch = fetchReal;
    delete process.env.PORTAL_FILA_LIVROS;
    await pool.end();
  }
});
