import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, quadroFalso, telaStatus, type CartaoFalso, type FilaFalsa } from "./portal-fixture";

/**
 * O LIVRO DE CADA PONTO CADASTRADO — A032, B032, M032 — DE PONTA A PONTA.
 *
 * A Tela de Ativos do portal mostra um livro por vez, com três botões no alto:
 * “Livro A · Livro B · Livro M”. O app lê o Livro A e o livro de cada ponto
 * cadastrado: quem cadastra o B032 faz o leitor tocar em “Livro B”; o M032, em
 * “Livro M”. A fila é geral, então quem toca no botão é a conta de quem tem o
 * acesso ao portal — e o que ela lê vale para o ponto de quem não tem.
 *
 * O RITMO: o Livro A é relido de 20 em 20 s com qualquer app aberto. O Livro B
 * (e o M) só entra nessa releitura enquanto alguém COM PONTO NELE está com o
 * app aberto (`marcarLivrosPedidos`); sem ninguém olhando, é lido de minuto em
 * minuto, na carona do Status. E cada livro tem a hora da sua leitura: um
 * livro que parou de vir fica OFFLINE sozinho, sem derrubar os outros.
 *
 * Teste de integração isolado: nunca rode com o banco de produção. Use um
 * PostgreSQL local descartável e VAZIO chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_livros \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_livros \
 *   ./node_modules/.bin/tsx --test tests/portal-fila-livros-cron.test.ts
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

test("o leitor toca no botão do livro de cada ponto cadastrado, e os quadros de cada motorista mostram o livro do ponto dele", { skip: !local }, async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-este-teste-0123456789";
  process.env.COMPOSIO_API_KEY = "";
  delete process.env.PORTAL_FONTE_SAIDA;
  delete process.env.PORTAL_INTERVALO_MIN;
  delete process.env.FONTE_FILA;
  delete process.env.PORTAL_FILA_LIVROS;
  delete process.env.PORTAL_FILA_LIVROS_DOS_PONTOS;
  delete process.env.PORTAL_FILA_INTERVALO_S;

  const { db, pool } = await import("../src/db");
  const { amostras, eventos, motoristas, pontos, portalFila, portalMotoristaAcessos, subscriptions } = await import("../src/db/schema");
  const { garantirTabelas, montarEstado } = await import("../src/lib/estado");
  const { envelhecerLoginsDaSessao, salvarAcessoPortal } = await import("../src/lib/portal-copadubo");
  const { ESPERA_APOS_FALHA_DA_FILA_MS, ESPERA_APOS_FALHA_SEM_FILA_MS, esperaDaFilaMs, esquecerPedidosGravados, livrosEmUso, marcarLivrosPedidos, validadeDaFilaMs } = await import("../src/lib/portal-fila");
  const { esperaEntreLeiturasMs } = await import("../src/lib/portal-situacao");
  const { atualizarFilaEntreCiclos, esquecerConferenciaDaFila, resumoDoMonitor } = await import("../src/lib/portal-monitor");
  const { cardDaFila } = await import("../src/lib/fila-card");
  const { GET } = await import("../src/app/api/cron/route");
  const { desc, eq, sql } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;

  /* ------------------------------------------------- portal de mentira */
  const cartao = (codigo: string, situacao: string): CartaoFalso => ({ codigo, situacao, linhas: ["Ativado hoje, 06:10"], botao: "Entrar na dispensa" });
  // O exemplo do dono do app: o mesmo número (32) na Carreta dos três livros.
  const fila: FilaFalsa = {
    livros: {
      A: { truck: quadroFalso("A", 196, [199, 9, 132, 172, 185], "TRUCK BA 2E"), carreta: quadroFalso("A", 25, [26, 28, 29, 30, 32, 33]) },
      B: { truck: quadroFalso("B", 164, [3, 7, 12], "TRUCK 4 EIXOS"), carreta: quadroFalso("B", 20, [30, 31, 32, 40]) },
      M: { truck: quadroFalso("M", 107, [9], "TRUCK 4 EIXOS"), carreta: quadroFalso("M", 17, [11, 15, 32]) },
    },
  };
  const portal = criarPortalFalso({
    cpf: CPF_ALFA,
    senha: SENHA_ALFA,
    telas: { "moto/status": telaStatus([cartao("A032", "ATIVO")]) },
    contas: { [CPF_CHARLIE]: { senha: SENHA_CHARLIE, telas: { "moto/status": telaStatus([cartao("A185", "ATIVO")]) } } },
    fila,
    trocaCookieDeSessaoEncerrada: true,
  });

  const paraFora: string[] = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(`${BASE_FALSA}/`)) return portal.buscar(input, init);
    if (url.includes("simport.com.br") || url.includes("open-meteo.com")) return Response.json([]);
    paraFora.push(url);
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

    // alfa e charlie cadastraram o acesso ao portal e só têm ponto no Livro A; bravo e delta NÃO têm acesso.
    const [alfa] = await db.insert(motoristas).values({ nome: "Alfa Teste" }).returning();
    const [bravo] = await db.insert(motoristas).values({ nome: "Bravo Teste" }).returning();
    const [charlie] = await db.insert(motoristas).values({ nome: "Charlie Teste" }).returning();
    const [delta] = await db.insert(motoristas).values({ nome: "Delta Teste" }).returning();
    const novoPonto = async (motoristaId: number, tipo: string, livro: string, numero: number, alertaPerto: number | null = null) =>
      (await db.insert(pontos).values({ tipo, livro, numero, motoristaId, status: "AGUARDANDO", alertaPerto }).returning())[0];
    await novoPonto(alfa.id, "CAVALO", "A", 32);
    await novoPonto(charlie.id, "TRUCK", "A", 185);
    const endereco = (nome: string) => `https://fcm.googleapis.com/fcm/send/fila-livros-${nome}`;
    for (const [nome, m] of [["alfa", alfa], ["bravo", bravo], ["charlie", charlie], ["delta", delta]] as const) {
      await db.insert(subscriptions).values({ endpoint: endereco(nome), p256dh: chaves.publicKey, auth: "teste-sem-rede", motoristaId: m.id });
    }
    await salvarAcessoPortal(alfa.id, { cpf: CPF_ALFA, senha: SENHA_ALFA });
    await salvarAcessoPortal(charlie.id, { cpf: CPF_CHARLIE, senha: SENHA_CHARLIE });

    /** O despertador de 1 minuto. */
    const ciclo = async () => {
      const res = await GET(new Request("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(res.status, 200);
    };
    /** Passou o intervalo da fila (as contas NÃO venceram: não é hora do Status). */
    const passarOIntervaloDaFila = async () => {
      await db.execute(sql`update portal_fila set proxima_leitura_em = now() - interval '1 second', tentativa_em = now() - interval '90 seconds'`);
    };
    /** Passou um minuto: vencem as contas e a fila. */
    const passarUmMinuto = async () => {
      await db.execute(sql`update portal_motorista_acessos set proxima_leitura_em = now() - interval '1 second'`);
      await passarOIntervaloDaFila();
    };
    /**
     * O que o `/api/estado` chama depois da resposta, com os livros dos pontos de quem está com o app aberto
     * (sem a pausa de 4 s entre conferências, nem a de 10 s entre gravações do pedido, da mesma instância).
     */
    const entreCiclos = async (livrosDoPedido: string[] = []) => {
      esquecerConferenciaDaFila();
      esquecerPedidosGravados();
      return atualizarFilaEntreCiclos({ livrosDoPedido });
    };
    const APP_DO_ALFA = ["A"]; // só tem ponto no Livro A
    const APP_DO_BRAVO = ["B", "A"]; // B032 e, mais adiante, A030
    const APP_DO_DELTA = ["M"];
    /** Passaram `s` segundos para a fila guardada (as contas não venceram). */
    const passarSegundos = async (s: number) => {
      const d = sql`(${s}::int * interval '1 second')`;
      await db.execute(
        sql`update portal_fila set proxima_leitura_em = proxima_leitura_em - ${d}, tentativa_em = tentativa_em - ${d}, lido_em = lido_em - ${d}, pedido_em = pedido_em - ${d}`,
      );
    };
    /** Quem tinha ponto no B ou no M fechou o app há mais de 45 s. */
    const fecharOsApps = async () => {
      await db.execute(sql`update portal_fila set pedido_em = now() - interval '46 seconds' where pedido_em is not null`);
    };
    /** Os pedidos novos à Tela de Ativos, na ordem, com o livro pedido. */
    let pedidosVistos = 0;
    const pedidosDaFila = () => {
      const fatia = portal.pedidos
        .slice(pedidosVistos)
        .filter((p) => p.caminho.startsWith("moto/fila"))
        .map((p) => `${p.metodo} ${p.caminho}${p.metodo === "POST" ? ` [${p.corpo}]` : ""}`);
      pedidosVistos = portal.pedidos.length;
      return fatia;
    };
    let avisosVistos = 0;
    const avisosNovos = () => {
      const fatia = enviados.slice(avisosVistos).map((a) => `${a.acao} → ${a.endpoint}`);
      avisosVistos = enviados.length;
      return fatia;
    };
    /** As contas como estão no banco (a sessão cifrada muda a cada gravação). */
    const contas = async () =>
      JSON.stringify(
        (await db.select().from(portalMotoristaAcessos).orderBy(portalMotoristaAcessos.motoristaId)).map((a) => [a.motoristaId, a.sessaoCifrada, a.ativo]),
      );
    const guardada = async (livro: string) => (await db.select().from(portalFila).where(eq(portalFila.livro, livro)))[0];
    /** A espera que a última reserva deixou no livro: da tentativa até a próxima leitura. */
    const esperaDe = async (livro: string) => {
      const g = await guardada(livro);
      return (g.proximaLeituraEm as Date).getTime() - (g.tentativaEm as Date).getTime();
    };
    const CURTA = esperaDaFilaMs();
    const LONGA = esperaEntreLeiturasMs();
    assert.deepEqual([CURTA, LONGA], [18_000, 45_000]);
    const perto = (valor: number, esperado: number) => Math.abs(valor - esperado) < 1_500;
    type Estado = Awaited<ReturnType<typeof montarEstado>>;
    const linha = (e: Estado, tipo: string, livro: string) => {
      const l = e.fila.find((x) => x.tipo === tipo && x.livro === livro);
      assert.ok(l, `${tipo} ${livro}`);
      return l;
    };
    /** Os dois quadros do cartão, com o ponto `i` do motorista na tela (sem motorista: o visitante). */
    const quadros = async (motoristaId: number | null, i = 0) => {
      const e = await montarEstado(motoristaId);
      const c = cardDaFila(e.fila, motoristaId === null ? null : e.pontos[i]);
      return [`${c.truck.valor} · ${c.truck.sub}`, `${c.cavalo.valor} · ${c.cavalo.sub}`];
    };
    const QUADROS_DO_A = ["5 · último escalado A196", "6 · último escalado A025"];
    const SEM_LEITURA = ["— · sem leitura da fila", "— · sem leitura da fila"];

    /* 0 — só há ponto no Livro A: a leitura abre a aba e não toca em botão nenhum. */
    assert.deepEqual(await livrosEmUso(), ["A"]);
    await ciclo();
    assert.equal(portal.logins, 2, "as duas contas entraram");
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"]);
    assert.deepEqual(portal.livrosPedidos, []);
    assert.deepEqual(await quadros(alfa.id), QUADROS_DO_A);
    assert.deepEqual(await quadros(null), QUADROS_DO_A, "o visitante vê o Livro A");
    assert.equal(linha(await montarEstado(null), "CAVALO", "B").semLeitura, true);
    assert.deepEqual((await resumoDoMonitor()).fila.livros.map((l) => l.livro), ["A"], "o /admin lista os livros em uso");

    /* 1 — bravo (sem acesso ao portal) cadastra o B032: o Livro B passa a ser lido — pela conta de quem tem acesso. */
    const pBravo = await novoPonto(bravo.id, "CAVALO", "B", 32, 1);
    assert.deepEqual(await livrosEmUso(), ["A", "B"]);
    let doBravo = (await montarEstado(bravo.id)).pontos[0];
    assert.deepEqual([doBravo.semFila, doBravo.detalhe], [true, "sem leitura da fila do Livro B"], "até a primeira leitura do Livro B");
    assert.deepEqual(await quadros(bravo.id), SEM_LEITURA);
    // A leitura entre as olhadas só CONTINUA o que está dando certo: o livro novo espera a olhada do Status.
    for (const id of [alfa.id, charlie.id]) await envelhecerLoginsDaSessao(id, 31 * 60_000);
    await passarOIntervaloDaFila();
    let r = await entreCiclos(APP_DO_BRAVO);
    assert.deepEqual([r.tentou, r.lidos], [true, ["A"]]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"], "o Livro B, que nunca foi lido, não é tocado entre as olhadas — nem com o app do bravo aberto");
    assert.equal(await guardada("B"), undefined, "nem linha ele tem ainda");
    // A olhada do Status: a aba (Livro A) e o toque em “Livro B”.
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B"]);
    assert.deepEqual(portal.livrosPedidos, ["GET B"]);
    assert.equal(portal.logins, 2, "nenhum login a mais");
    let estado = await montarEstado(bravo.id);
    assert.deepEqual([linha(estado, "TRUCK", "B").naFila, linha(estado, "TRUCK", "B").ultimo], [3, 164]);
    assert.deepEqual([linha(estado, "CAVALO", "B").naFila, linha(estado, "CAVALO", "B").ultimo], [4, 20]);
    assert.equal(linha(estado, "CAVALO", "M").semLeitura, true, "ninguém tem ponto no Livro M: ele não é lido");
    doBravo = estado.pontos[0];
    assert.deepEqual([doBravo.semFila ?? false, doBravo.status, doBravo.naFrente], [false, "AGUARDANDO", 2], "o B032 é o 3º da Carreta do Livro B");
    // Cada um vê os quadros do livro do SEU ponto; o visitante continua no Livro A (não a soma dos dois).
    assert.deepEqual(await quadros(bravo.id), ["3 · último escalado B164", "4 · último escalado B020"]);
    assert.deepEqual(await quadros(alfa.id), QUADROS_DO_A);
    assert.deepEqual(await quadros(null), QUADROS_DO_A);
    assert.deepEqual(avisosNovos(), [], "a primeira fila lida de um livro é só o ponto de partida");
    assert.equal((await guardada("B")).motoristaId, (await guardada("A")).motoristaId, "quem leu o Livro B foi a mesma conta, na mesma visita");
    // A espera é de cada livro: o A fica livre de novo em 18 s (é o relido entre as olhadas); o B, que ninguém
    // com ponto nele está olhando, só no minuto seguinte.
    assert.ok(perto(await esperaDe("A"), CURTA), `espera do Livro A: ${await esperaDe("A")} ms`);
    assert.ok(perto(await esperaDe("B"), LONGA), `espera do Livro B: ${await esperaDe("B")} ms`);
    assert.equal((await guardada("B")).pedidoEm, null);
    // Cada quadro leva a hora da leitura do SEU livro.
    assert.equal(linha(estado, "CAVALO", "B").lidoEm, (await guardada("B")).lidoEm?.toISOString());
    assert.equal(linha(estado, "TRUCK", "A").lidoEm, (await guardada("A")).lidoEm?.toISOString());
    assert.equal(linha(estado, "CAVALO", "M").lidoEm, undefined);
    assert.ok(estado.fila.every((l) => l.velha === undefined), "leitura em dia não é velha — e quadro sem leitura também não leva a marca");

    /* 2 — delta cadastra o M032: o leitor passa a tocar também em “Livro M”. E bravo arrasta do B032 para um ponto do Livro A. */
    const pDelta = await novoPonto(delta.id, "CAVALO", "M", 32);
    await novoPonto(bravo.id, "CAVALO", "A", 30);
    assert.deepEqual(await livrosEmUso(), ["A", "B", "M"]);
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B", "GET moto/fila?livro=M"], "um pedido por livro");
    assert.deepEqual(await quadros(delta.id), ["1 · último escalado M107", "3 · último escalado M017"]);
    const doDelta = (await montarEstado(delta.id)).pontos[0];
    assert.deepEqual([doDelta.semFila ?? false, doDelta.naFrente], [false, 2]);
    // O mesmo motorista com pontos em dois livros: o cartão troca de livro junto com o ponto.
    assert.deepEqual(await quadros(bravo.id, 0), ["3 · último escalado B164", "4 · último escalado B020"]);
    assert.deepEqual(await quadros(bravo.id, 1), QUADROS_DO_A);
    assert.deepEqual((await resumoDoMonitor()).fila.livros.map((l) => l.livro), ["A", "B", "M"]);

    /* 3 — ENTRE AS OLHADAS, com o app aberto: o Livro A sempre; o B e o M só enquanto alguém com ponto neles olha. */
    // 3a. Só o app do alfa (ponto no Livro A) está aberto: a aba é relida e nenhum botão de livro é tocado.
    fila.livros.B!.carreta = quadroFalso("B", 30, [31, 32, 40]);
    await passarOIntervaloDaFila();
    let antes = await contas();
    avisosNovos();
    let tentativaDoB = (await guardada("B")).tentativaEm?.getTime();
    r = await entreCiclos(APP_DO_ALFA);
    assert.deepEqual([r.tentou, r.lidos], [true, ["A"]]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"], "ninguém com ponto no B ou no M está olhando: só a aba");
    assert.equal((await guardada("B")).tentativaEm?.getTime(), tentativaDoB);
    assert.equal((await guardada("B")).pedidoEm, null, "o app de quem só tem ponto no Livro A não pede o Livro B");
    assert.deepEqual(await quadros(bravo.id), ["3 · último escalado B164", "4 · último escalado B020"], "o Livro B fica com a leitura do minuto");
    assert.deepEqual(avisosNovos(), []);

    // 3b. O bravo abre o app (B032 e A030): o Livro B entra na releitura — a aba e UM toque. O M, não.
    await passarOIntervaloDaFila();
    const tentativaDoM = (await guardada("M")).tentativaEm?.getTime();
    r = await entreCiclos(APP_DO_BRAVO);
    assert.deepEqual([r.tentou, r.lidos], [true, ["A", "B"]]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B"]);
    assert.equal(portal.logins, 2);
    assert.equal(await contas(), antes, "nada da conta foi gravado");
    assert.equal((await guardada("M")).tentativaEm?.getTime(), tentativaDoM, "o Livro M não foi tocado: o delta não está com o app aberto");
    assert.ok(Date.now() - ((await guardada("B")).pedidoEm as Date).getTime() < 5_000, "o Livro B ficou marcado como pedido");
    assert.equal((await guardada("M")).pedidoEm, null);
    assert.ok(perto(await esperaDe("B"), CURTA), `pedido, o Livro B passa à espera curta: ${await esperaDe("B")} ms`);
    assert.deepEqual(await quadros(bravo.id), ["3 · último escalado B164", "3 · último escalado B030"], "a fila nova do Livro B já está na tela");
    assert.deepEqual(avisosNovos(), [`perto → ${endereco("bravo")}`], "o B032 ficou com 1 na frente");

    // 3c. O delta abre o app também: os três livros na MESMA visita. E a vez do B032 chega por ela.
    fila.livros.B!.carreta = quadroFalso("B", 31, [32, 40]);
    await passarOIntervaloDaFila();
    r = await entreCiclos(APP_DO_DELTA);
    assert.deepEqual(r.lidos, ["A", "B", "M"], "o Livro B continua pedido (o bravo perguntou há pouco)");
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B", "GET moto/fila?livro=M"], "um pedido por livro");
    assert.equal(await contas(), antes);
    assert.equal((await db.select().from(pontos).where(eq(pontos.id, pBravo.id)))[0].status, "NA VEZ");
    assert.deepEqual(avisosNovos(), [`chamada → ${endereco("bravo")}`]);

    // A marca é regravada no máximo de 10 em 10 s por instância (o app pergunta de 5 em 5 s), só para os
    // livros que precisam dela: o A é lido sempre, e “Z” não é livro.
    esquecerPedidosGravados();
    const t0 = Date.now();
    assert.deepEqual(await marcarLivrosPedidos(["b", " M ", "A", "Z"], t0), ["B", "M"]);
    assert.deepEqual(await marcarLivrosPedidos(["B", "M"], t0 + 9_999), []);
    assert.deepEqual(await marcarLivrosPedidos(["B"], t0 + 10_000), ["B"]);
    assert.deepEqual(await marcarLivrosPedidos(["B", "M"], t0 + 10_001), ["M"]);

    // 3d. Os dois fecham o app: 45 s depois da última pergunta, o B e o M saem da releitura…
    await fecharOsApps();
    await passarOIntervaloDaFila();
    r = await entreCiclos(APP_DO_ALFA);
    assert.deepEqual(r.lidos, ["A"]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"], "sem ninguém olhando o B e o M, a aba não ganha toque nenhum");
    // …e continuam na carona do Status, de minuto em minuto — com a espera longa de volta.
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B", "GET moto/fila?livro=M"]);
    assert.deepEqual(
      [perto(await esperaDe("A"), CURTA), perto(await esperaDe("B"), LONGA), perto(await esperaDe("M"), LONGA)],
      [true, true, true],
      `esperas depois da carona, sem ninguém olhando o B e o M: A ${await esperaDe("A")} ms, B ${await esperaDe("B")} ms, M ${await esperaDe("M")} ms`,
    );

    // 3e. O bravo abre o app logo depois da carona: o Livro B não espera o resto do minuto — a espera dele
    //     cai para a curta, contada da última tentativa. (A releitura em si ainda não é agora: a aba acabou de ser aberta.)
    r = await entreCiclos(APP_DO_BRAVO);
    assert.deepEqual([r.tentou, r.lidos], [false, []], "a aba foi aberta agora há pouco");
    assert.deepEqual(pedidosDaFila(), []);
    assert.ok(perto(await esperaDe("B"), CURTA), `o pedido encurta a espera do Livro B: ${await esperaDe("B")} ms`);
    assert.ok(perto(await esperaDe("M"), LONGA), "a do Livro M, que ninguém pediu, não muda");
    await passarSegundos(12);
    r = await entreCiclos(APP_DO_BRAVO);
    assert.deepEqual([r.tentou, r.lidos], [false, []], "12 s: ainda é cedo");
    assert.deepEqual(pedidosDaFila(), []);
    await passarSegundos(7);
    r = await entreCiclos(APP_DO_BRAVO);
    assert.deepEqual(r.lidos, ["A", "B"], "19 s depois da carona, o A e o B são relidos; o M espera o minuto dele");
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B"]);

    // 3f. A visita que só veio buscar o Livro M leva o Livro A junto: a aba abre nele, sem pedido a mais —
    //     e a hora do A é adiada, para a aba não ser aberta de novo segundos depois só por ele.
    await passarSegundos(10); // o A e o B, relidos há 10 s, ainda têm 8 s de espera
    await db.execute(sql`update portal_fila set proxima_leitura_em = now() - interval '1 second' where livro = 'M'`);
    await db.execute(sql`update portal_motorista_acessos set proxima_leitura_em = now() - interval '1 second'`);
    const lidoDoA = (await guardada("A")).lidoEm?.getTime() ?? 0;
    tentativaDoB = (await guardada("B")).tentativaEm?.getTime();
    await new Promise((ok) => setTimeout(ok, 15));
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=M"], "as duas contas olhadas, UMA visita: a aba e o toque no M");
    assert.ok(((await guardada("A")).lidoEm?.getTime() ?? 0) > lidoDoA, "o Livro A que estava na aba foi aproveitado");
    assert.ok(perto(await esperaDe("A"), CURTA), `a hora do Livro A foi adiada junto: ${await esperaDe("A")} ms`);
    assert.equal((await guardada("B")).tentativaEm?.getTime(), tentativaDoB, "o Livro B não estava na hora nem é lido sempre: não foi tocado");
    assert.equal((await guardada("M")).erro, null);

    // 3g. CADA LIVRO TEM A SUA HORA. A varredura guardou os três livros valendo; o tempo passa sem varredura nova e
    //     a leitura do B e do M passa da validade (3 min), enquanto a do A tem 10 s.
    const [ultimaAmostra] = await db.select().from(amostras).orderBy(desc(amostras.id)).limit(1);
    type Guardado = { origem: string; lidoEm: string | null; livros: string[]; fila: Record<string, { livro: string; lidoEm?: string }> };
    const comIdades = (idadeDoA_ms: number, idadeDosOutros_ms: number) => {
      const copia = JSON.parse(JSON.stringify(ultimaAmostra.dados)) as Guardado;
      const hora = (idade: number) => new Date(Date.now() - idade).toISOString();
      for (const l of Object.values(copia.fila)) if (l.lidoEm) l.lidoEm = hora(l.livro === "A" ? idadeDoA_ms : idadeDosOutros_ms);
      // A hora do snapshot é a da leitura MAIS ANTIGA entre as que valiam.
      copia.lidoEm = hora(Math.max(idadeDoA_ms, idadeDosOutros_ms));
      return copia;
    };
    assert.deepEqual((ultimaAmostra.dados as Guardado).livros, ["A", "B", "M"]);
    const VALIDADE = validadeDaFilaMs();
    assert.equal(VALIDADE, 180_000);
    await db.insert(amostras).values({ origem: "portal", dados: comIdades(10_000, VALIDADE + 2_000) });
    estado = await montarEstado(bravo.id);
    assert.equal(estado.online, true, "o Livro A está em dia: o monitor NÃO fica OFFLINE por causa do B e do M");
    assert.deepEqual([linha(estado, "TRUCK", "A").velha, linha(estado, "CAVALO", "A").velha], [undefined, undefined]);
    assert.deepEqual(["TRUCK", "CAVALO"].flatMap((t) => ["B", "M"].map((l) => linha(estado, t, l).velha)), [true, true, true, true]);
    // Na tela do bravo: no B032 o cartão é o do Livro B, com a hora e a marca DELE; arrastando para o A030, as do Livro A.
    let cartao0 = cardDaFila(estado.fila, estado.pontos[0]);
    let cartao1 = cardDaFila(estado.fila, estado.pontos[1]);
    assert.deepEqual([estado.pontos[0].codigo, estado.pontos[1].codigo], ["B32", "A30"]);
    assert.deepEqual([cartao0.velha, cartao1.velha], [true, false]);
    assert.ok(Date.now() - new Date(cartao0.lidoEm as string).getTime() > VALIDADE, "no B032, a hora é a da leitura (velha) do Livro B");
    assert.ok(Date.now() - new Date(cartao1.lidoEm as string).getTime() < 15_000, "no A030, a hora é a da leitura (de 10 s) do Livro A");
    assert.deepEqual([cartao0.cavalo.valor, cartao0.cavalo.sub], ["2", "último escalado B031"], "os últimos números lidos continuam na tela");
    // Um segundo antes da validade ninguém é velho.
    await db.insert(amostras).values({ origem: "portal", dados: comIdades(10_000, VALIDADE - 2_000) });
    estado = await montarEstado(bravo.id);
    assert.equal(estado.online, true);
    assert.ok(estado.fila.every((l) => l.velha === undefined), "dois segundos antes da validade: nenhum quadro é velho");
    // O contrário: o Livro A é que ficou velho — OFFLINE para quem olha o A, e o B segue em dia.
    await db.insert(amostras).values({ origem: "portal", dados: comIdades(VALIDADE + 2_000, 10_000) });
    estado = await montarEstado(bravo.id);
    assert.equal(estado.online, true, "há um livro em dia");
    cartao0 = cardDaFila(estado.fila, estado.pontos[0]);
    cartao1 = cardDaFila(estado.fila, estado.pontos[1]);
    assert.deepEqual([cartao0.velha, cartao1.velha], [false, true]);
    assert.equal(cardDaFila((await montarEstado(null)).fila, null).velha, true, "o visitante vê o Livro A: para ele é OFFLINE");
    // Todos velhos: aí sim o monitor inteiro está OFFLINE.
    await db.insert(amostras).values({ origem: "portal", dados: comIdades(VALIDADE + 2_000, VALIDADE + 60_000) });
    estado = await montarEstado(bravo.id);
    assert.equal(estado.online, false);
    assert.ok(estado.fila.every((l) => l.velha === true), "todos os quadros levam a marca");
    // A varredura seguinte põe tudo no lugar.
    await passarUmMinuto();
    await ciclo();
    pedidosDaFila();
    estado = await montarEstado(bravo.id);
    assert.equal(estado.online, true);
    assert.ok(estado.fila.every((l) => l.velha === undefined), "leitura nova nos três livros: nenhuma marca");

    // 3h. O contrário do passo 4: é o Livro A que para de vir (um ponto repetido no quadro: leitura recusada) e o B
    //     continua bom, com o app do bravo aberto. O B segue relido; o A, em erro, espera a carona do Status —
    //     a visita que vai buscar o B não tenta o A de novo.
    const carretaDoA = fila.livros.A!.carreta;
    fila.livros.A!.carreta = quadroFalso("A", 25, [26, 28, 28, 30]);
    await passarOIntervaloDaFila();
    r = await entreCiclos(APP_DO_BRAVO);
    assert.deepEqual([r.tentou, r.lidos], [true, ["B"]]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B"]);
    assert.match((await guardada("A")).erro ?? "", /Livro A - Carreta/);
    await passarOIntervaloDaFila();
    const tentativaDoA = (await guardada("A")).tentativaEm?.getTime();
    r = await entreCiclos(APP_DO_BRAVO);
    assert.deepEqual([r.tentou, r.lidos], [true, ["B"]], "o Livro A sem leitura não segura o Livro B");
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "GET moto/fila?livro=B"]);
    assert.equal((await guardada("A")).tentativaEm?.getTime(), tentativaDoA, "o Livro A, em erro, não é tentado entre as olhadas");
    assert.deepEqual(await quadros(alfa.id), QUADROS_DO_A, "a última fila boa do Livro A continua na tela");
    fila.livros.A!.carreta = carretaDoA;
    await passarUmMinuto();
    await ciclo();
    pedidosDaFila();
    assert.equal((await guardada("A")).erro, null, "a carona do Status volta a ler o Livro A");

    /* 4 — os botões de livro mudam para uma forma que a leitura não sabe usar: o B e o M ficam sem leitura nova,
           com o motivo — e o Livro A NÃO perde a releitura entre as olhadas. */
    fila.botoes = "script";
    await passarOIntervaloDaFila();
    r = await entreCiclos([...APP_DO_BRAVO, ...APP_DO_DELTA]);
    assert.deepEqual(r.lidos, ["A"]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"], "sem botão que sirva, só a aba é pedida");
    let doB = await guardada("B");
    assert.match(doB.erro ?? "", /não achei na tela um botão “Livro B” que eu saiba usar \(a tela tem: Livro A: <button type="button" data-livro="A">/);
    assert.match((await guardada("M")).erro ?? "", /não achei na tela um botão “Livro M” que eu saiba usar/);
    assert.equal((await guardada("A")).erro, null);
    // Com uma fila boa ainda valendo, a próxima tentativa do livro é logo (20 s).
    const esperaCurta = (doB.proximaLeituraEm as Date).getTime() - (doB.tentativaEm as Date).getTime();
    assert.ok(Math.abs(esperaCurta - ESPERA_APOS_FALHA_DA_FILA_MS) < 1_500, `espera depois da falha: ${esperaCurta} ms`);
    // A última fila boa do Livro B continua na tela.
    assert.deepEqual(await quadros(bravo.id), ["3 · último escalado B164", "2 · último escalado B031"]);
    // Entre as olhadas, o livro que falhou não é tentado de novo, por mais que o app dele peça — e o pedido não
    // mexe na espera de um livro em erro. O Livro A segue no ritmo dele.
    fila.livros.A!.carreta = quadroFalso("A", 26, [28, 29, 30, 32, 33]);
    const proximaDoB = (await guardada("B")).proximaLeituraEm?.getTime();
    r = await entreCiclos([...APP_DO_BRAVO, ...APP_DO_DELTA]);
    assert.equal((await guardada("B")).proximaLeituraEm?.getTime(), proximaDoB, "livro em erro: o pedido não adianta a próxima tentativa");
    await passarOIntervaloDaFila();
    tentativaDoB = (await guardada("B")).tentativaEm?.getTime();
    r = await entreCiclos([...APP_DO_BRAVO, ...APP_DO_DELTA]);
    assert.deepEqual([r.tentou, r.lidos], [true, ["A"]], "o Livro B sem leitura não segura o Livro A");
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"]);
    assert.equal((await guardada("B")).tentativaEm?.getTime(), tentativaDoB, "o Livro B não foi tentado entre as olhadas");
    assert.deepEqual(await quadros(alfa.id), ["5 · último escalado A196", "5 · último escalado A026"]);
    // Na olhada do Status ele é tentado de novo. Sem nenhuma fila boa valendo, a espera depois da falha é maior (50 s).
    await db.execute(sql`update portal_fila set lido_em = now() - interval '10 minutes' where livro in ('B', 'M')`);
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"]);
    doB = await guardada("B");
    assert.match(doB.erro ?? "", /não achei na tela um botão “Livro B”/);
    const esperaLonga = (doB.proximaLeituraEm as Date).getTime() - (doB.tentativaEm as Date).getTime();
    assert.ok(Math.abs(esperaLonga - ESPERA_APOS_FALHA_SEM_FILA_MS) < 1_500, `espera sem fila boa: ${esperaLonga} ms`);
    const doA = await guardada("A");
    assert.equal(doA.erro, null);
    assert.ok((doA.proximaLeituraEm as Date).getTime() - (doA.tentativaEm as Date).getTime() < 19_000, "o Livro A segue na espera normal");
    // O que o motorista do B032 vê: os últimos números do Livro B, com a marca de leitura velha (OFFLINE para
    // ele); quem olha o Livro A continua ONLINE.
    estado = await montarEstado(bravo.id);
    assert.equal(estado.online, true);
    assert.equal(estado.atualizadoEm, (await guardada("A")).lidoEm?.toISOString(), "a hora geral é a do único livro que vale");
    cartao0 = cardDaFila(estado.fila, estado.pontos[0]);
    cartao1 = cardDaFila(estado.fila, estado.pontos[1]);
    assert.deepEqual([cartao0.velha, cartao1.velha], [true, false]);
    assert.deepEqual([cartao0.cavalo.valor, cartao0.cavalo.sub], ["2", "último escalado B031"]);
    assert.ok(Date.now() - new Date(cartao0.lidoEm as string).getTime() > 9 * 60_000, "com a idade verdadeira: uns 10 minutos");

    /* 5 — o portal passa a usar formulários POST nos botões: a olhada do Status volta a ler o B e o M,
           e a leitura entre as olhadas volta a incluí-los. */
    fila.botoes = "form-post";
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "POST moto/fila [livro=B]", "POST moto/fila [livro=M]"]);
    assert.equal((await guardada("B")).erro, null);
    assert.deepEqual(await quadros(delta.id), ["1 · último escalado M107", "3 · último escalado M017"]);
    estado = await montarEstado(bravo.id);
    assert.ok(estado.fila.every((l) => l.velha === undefined), "leitura nova: a marca de velha some");
    await passarOIntervaloDaFila();
    antes = await contas();
    r = await entreCiclos([...APP_DO_BRAVO, ...APP_DO_DELTA]);
    assert.deepEqual(r.lidos, ["A", "B", "M"]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "POST moto/fila [livro=B]", "POST moto/fila [livro=M]"]);
    assert.equal(await contas(), antes);
    assert.equal(portal.livrosRecusados, 0);

    /* 6 — a chave de retorno: PORTAL_FILA_LIVROS_DOS_PONTOS=0 volta a ler só o Livro A, como era. */
    process.env.PORTAL_FILA_LIVROS_DOS_PONTOS = "0";
    assert.deepEqual(await livrosEmUso(), ["A"]);
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"]);
    estado = await montarEstado(bravo.id);
    assert.equal(linha(estado, "CAVALO", "B").semLeitura, true);
    assert.deepEqual([estado.pontos[0].semFila, estado.pontos[0].detalhe], [true, "sem leitura da fila do Livro B"]);
    assert.deepEqual(await quadros(bravo.id), SEM_LEITURA);
    await fecharOsApps();
    const pedidoDoB = (await guardada("B")).pedidoEm?.getTime();
    await passarOIntervaloDaFila();
    r = await entreCiclos([...APP_DO_BRAVO, ...APP_DO_DELTA]);
    assert.deepEqual(r.lidos, ["A"]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"]);
    assert.equal((await guardada("B")).pedidoEm?.getTime(), pedidoDoB, "com a chave desligada, nenhum livro é marcado como pedido");
    delete process.env.PORTAL_FILA_LIVROS_DOS_PONTOS;

    /* 7 — delta tira o M032, o último ponto do Livro M: o leitor para de tocar em “Livro M”. */
    await db.delete(pontos).where(eq(pontos.id, pDelta.id));
    assert.deepEqual(await livrosEmUso(), ["A", "B"]);
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "POST moto/fila [livro=B]"]);
    estado = await montarEstado(null);
    assert.equal(linha(estado, "CAVALO", "M").semLeitura, true, "o quadro do Livro M volta a “sem leitura”, não fica com um número velho");
    assert.equal(linha(estado, "CAVALO", "B").naFila, 2);
    // O app do delta ainda pede o Livro M (um aparelho com a tela antiga): livro sem ponto não volta a ser lido por isso.
    await passarOIntervaloDaFila();
    r = await entreCiclos(APP_DO_DELTA);
    assert.deepEqual(r.lidos, ["A"]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila"]);

    /* 8 — PORTAL_FILA_LIVROS=A,M: o Livro M é lido SEMPRE, com ou sem ponto nele e sem ninguém pedir — na carona e
           entre as olhadas, com a espera curta. O B continua pelo ponto do bravo, no ritmo de quem não está olhando. */
    process.env.PORTAL_FILA_LIVROS = "A,M";
    assert.deepEqual(await livrosEmUso(), ["A", "B", "M"]);
    await passarUmMinuto();
    await ciclo();
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "POST moto/fila [livro=B]", "POST moto/fila [livro=M]"]);
    assert.ok(perto(await esperaDe("A"), CURTA) && perto(await esperaDe("M"), CURTA), "os lidos sempre: espera curta");
    assert.ok(perto(await esperaDe("B"), LONGA), `o Livro B, que ninguém olha: ${await esperaDe("B")} ms`);
    await fecharOsApps();
    await passarOIntervaloDaFila();
    r = await entreCiclos(APP_DO_ALFA);
    assert.deepEqual(r.lidos, ["A", "M"]);
    assert.deepEqual(pedidosDaFila(), ["GET moto/fila", "POST moto/fila [livro=M]"]);
    // Lido sempre não precisa de marca: nada é gravado para ele.
    const pedidoDoM = (await guardada("M")).pedidoEm?.getTime();
    await passarOIntervaloDaFila();
    r = await entreCiclos(APP_DO_DELTA);
    assert.equal((await guardada("M")).pedidoEm?.getTime(), pedidoDoM);
    pedidosDaFila();
    delete process.env.PORTAL_FILA_LIVROS;

    /* Em todo o percurso. */
    assert.equal(portal.logins, 2, "dois logins em todo o teste: um por conta");
    assert.deepEqual(paraFora.filter((u) => u.includes("copadubo") || u.includes("composio")), []);
    assert.deepEqual(portal.acoes, [], "nenhuma ação do portal é aberta");
    assert.deepEqual(portal.foraDoSite, []);
    assert.ok(
      portal.pedidos.every((p) => p.metodo === "GET" || p.caminho.startsWith("seguranca/") || p.caminho === "moto/fila"),
      "além do login e do botão de livro, só leitura",
    );
  } finally {
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: originalSend });
    globalThis.fetch = fetchReal;
    delete process.env.PORTAL_FILA_LIVROS;
    delete process.env.PORTAL_FILA_LIVROS_DOS_PONTOS;
    await pool.end();
  }
});
