import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, quadroFalso, telaStatus, type CartaoFalso, type FilaFalsa } from "./portal-fixture";

/**
 * A FILA ENTRE AS OLHADAS DO STATUS — DE PONTA A PONTA.
 *
 * A carona do Status abre a aba “Fila” do portal uma vez por ciclo de 1
 * minuto. Com alguém com o app aberto, a aba é relida entre um ciclo e outro
 * (`atualizarFilaEntreCiclos`, chamada pelo `/api/estado` depois da resposta):
 * um pedido, com a sessão de quem leu por último, sem login e sem gravar nada
 * da sessão de volta. Depois de qualquer falha, quem volta a ler é a carona.
 * E só usa uma sessão assentada: depois de um login, a conta fica 30 minutos
 * fora da leitura entre ciclos (o freio, se as consultas a mais derrubarem
 * sessões).
 *
 * Teste de integração isolado: nunca rode com o banco de produção. Use um
 * PostgreSQL local descartável e VAZIO chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_entreciclos \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_entreciclos \
 *   ./node_modules/.bin/tsx --test tests/portal-fila-entre-ciclos-cron.test.ts
 *
 * Nada sai da máquina; pessoas, CPFs e filas são inventados.
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

test("com o app aberto, a fila é relida entre as olhadas do Status — um pedido, sem login, sem mexer na sessão", { skip: !local }, async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-este-teste-0123456789";
  process.env.COMPOSIO_API_KEY = "";
  delete process.env.PORTAL_FONTE_SAIDA;
  delete process.env.PORTAL_INTERVALO_MIN;
  delete process.env.FONTE_FILA;
  delete process.env.PORTAL_FILA_LIVROS;
  delete process.env.PORTAL_FILA_INTERVALO_S;

  const { db, pool } = await import("../src/db");
  const { eventos, motoristas, pontos, portalFila, portalMotoristaAcessos, subscriptions } = await import("../src/db/schema");
  const { garantirTabelas, montarEstado } = await import("../src/lib/estado");
  const { envelhecerLoginsDaSessao, removerAcessoPortal, salvarAcessoPortal } = await import("../src/lib/portal-copadubo");
  const { atualizarFilaDoPortal, atualizarFilaEntreCiclos, esquecerConferenciaDaFila } = await import("../src/lib/portal-monitor");
  const { GET } = await import("../src/app/api/cron/route");
  const { eq, sql } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;

  /* ------------------------------------------------- portal de mentira */
  const cartao = (codigo: string, situacao: string): CartaoFalso => ({ codigo, situacao, linhas: ["Ativado hoje, 06:10"], botao: "Entrar na dispensa" });
  const fila: FilaFalsa = {
    livros: {
      A: { truck: quadroFalso("A", 196, [199, 9, 132, 172, 185], "TRUCK BA 2E"), carreta: quadroFalso("A", 25, [26, 28, 29, 30, 32, 33]) },
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
    // Como um PHP de verdade: quem chega com uma sessão encerrada recebe um cookie novo, de visitante.
    trocaCookieDeSessaoEncerrada: true,
  });

  const paraFora: string[] = [];
  /** Cookie a mais que o portal manda JUNTO com a tela da fila (null = nenhum). */
  let cookieNaFila: string | null = null;
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(`${BASE_FALSA}/`)) {
      const resposta = await portal.buscar(input, init);
      if (!cookieNaFila || new URL(url).pathname !== "/moto/fila" || resposta.status !== 200) return resposta;
      const cabecalhos = new Headers(resposta.headers);
      cabecalhos.append("set-cookie", cookieNaFila);
      return new Response(await resposta.text(), { status: 200, headers: cabecalhos });
    }
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

    // alfa e charlie cadastraram o acesso ao portal; bravo, não (e é ele quem espera a vez).
    const [alfa] = await db.insert(motoristas).values({ nome: "Alfa Teste" }).returning();
    const [bravo] = await db.insert(motoristas).values({ nome: "Bravo Teste" }).returning();
    const [charlie] = await db.insert(motoristas).values({ nome: "Charlie Teste" }).returning();
    const novoPonto = async (motoristaId: number, tipo: string, livro: string, numero: number, alertaPerto: number | null = null) =>
      (await db.insert(pontos).values({ tipo, livro, numero, motoristaId, status: "AGUARDANDO", alertaPerto }).returning())[0];
    await novoPonto(alfa.id, "CAVALO", "A", 32);
    const pBravo = await novoPonto(bravo.id, "CAVALO", "A", 29, 1);
    await novoPonto(charlie.id, "TRUCK", "A", 185);
    const endereco = (nome: string) => `https://fcm.googleapis.com/fcm/send/fila-entre-ciclos-${nome}`;
    for (const [nome, m] of [["alfa", alfa], ["bravo", bravo], ["charlie", charlie]] as const) {
      await db.insert(subscriptions).values({ endpoint: endereco(nome), p256dh: chaves.publicKey, auth: "teste-sem-rede", motoristaId: m.id });
    }
    await salvarAcessoPortal(alfa.id, { cpf: CPF_ALFA, senha: SENHA_ALFA });
    await salvarAcessoPortal(charlie.id, { cpf: CPF_CHARLIE, senha: SENHA_CHARLIE });

    type ResumoPortal = { motoristas: number; lidos: number; falhas: number; adiados: number; avisos: number; logins: number; fila: number };
    /** O despertador de 1 minuto. */
    const ciclo = async () => {
      const res = await GET(new Request("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(res.status, 200);
      return ((await res.json()) as { portal?: ResumoPortal }).portal ?? null;
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
    /** O que o `/api/estado` chama depois da resposta (aqui, sem a pausa de 4 s entre conferências da mesma instância). */
    const entreCiclos = async () => {
      esquecerConferenciaDaFila();
      return atualizarFilaEntreCiclos();
    };
    /** Passou meia hora desde o último login das duas contas (de mentira: os logins guardados ficam 31 min mais velhos). */
    const assentarAsSessoes = async () => {
      for (const id of [alfa.id, charlie.id]) await envelhecerLoginsDaSessao(id, 31 * 60_000);
    };
    let pedidosVistos = 0;
    const pedidosNovos = () => {
      const fatia = portal.pedidos.slice(pedidosVistos).map((p) => `${p.metodo} ${p.caminho.split("?")[0]}`);
      pedidosVistos = portal.pedidos.length;
      return fatia;
    };
    let avisosVistos = 0;
    const avisosNovos = () => {
      const fatia = enviados.slice(avisosVistos).map((a) => `${a.acao} → ${a.endpoint}`);
      avisosVistos = enviados.length;
      return fatia;
    };
    /** As contas como estão no banco: a sessão cifrada (muda a cada gravação) e a hora da próxima olhada do Status. */
    const contas = async () =>
      JSON.stringify(
        (await db.select().from(portalMotoristaAcessos).orderBy(portalMotoristaAcessos.motoristaId)).map((a) => [
          a.motoristaId,
          a.sessaoCifrada,
          a.proximaLeituraEm?.toISOString() ?? null,
          a.ativo,
        ]),
      );
    const guardadaA = async () => (await db.select().from(portalFila).where(eq(portalFila.livro, "A")))[0];
    const carretaNaTela = async () => {
      const l = (await montarEstado(bravo.id)).fila.find((x) => x.tipo === "CAVALO" && x.livro === "A");
      assert.ok(l);
      return [l.ultimo, l.naFila];
    };

    /* 0 — antes de qualquer leitura não há o que continuar: nenhum pedido. */
    let r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos], [false, []]);
    assert.deepEqual(pedidosNovos(), []);

    /* 1 — o despertador: as duas contas entram e UMA abre a aba Fila (a carona). */
    let resumo = await ciclo();
    assert.deepEqual([resumo?.lidos, resumo?.logins, resumo?.fila], [2, 2, 1]);
    assert.equal(pedidosNovos().filter((p) => p === "GET moto/fila").length, 1);
    assert.deepEqual(await carretaNaTela(), [25, 6]);
    let linha = await guardadaA();
    const leitor = linha.motoristaId as number;
    const outro = leitor === alfa.id ? charlie.id : alfa.id;
    assert.ok(leitor === alfa.id || leitor === charlie.id);
    // A reserva da carona já deixa a fila livre para ser relida daqui a 18 s (20 s menos a folga) — não mais 45 s.
    const esperaReservada = (linha.proximaLeituraEm as Date).getTime() - (linha.tentativaEm as Date).getTime();
    assert.ok(esperaReservada > 15_000 && esperaReservada <= 18_500, `espera reservada: ${esperaReservada} ms`);
    assert.deepEqual(avisosNovos(), [], "a primeira fila lida é só o ponto de partida");

    /* 2 — logo depois: cedo demais, nenhum pedido. */
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), []);

    /* 3 — passou o intervalo e a fila andou, mas as contas acabaram de entrar no portal: a leitura
           entre ciclos só usa uma sessão assentada (30 min sem login). Nenhum pedido. */
    carretasA(26, [28, 29, 30, 32, 33]);
    await passarOIntervaloDaFila();
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), [], "login há segundos: a leitura entre ciclos espera");
    /* …meia hora depois: UM pedido, com a sessão de quem leu por último. */
    await assentarAsSessoes();
    let antes = await contas();
    const loginsAntes = portal.logins;
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos, r.motoristaId], [true, ["A"], leitor]);
    assert.deepEqual(pedidosNovos(), ["GET moto/fila"], "um pedido só: a aba Fila");
    assert.equal(portal.logins, loginsAntes, "nenhum login");
    assert.equal(await contas(), antes, "nada da conta foi gravado: nem a sessão, nem a hora da próxima olhada do Status");
    assert.deepEqual(await carretaNaTela(), [26, 5], "a fila nova já está na tela — sem esperar o próximo minuto");
    // Os avisos de vez saem junto: o A029 ficou com 1 na frente.
    assert.deepEqual(avisosNovos(), [`perto → ${endereco("bravo")}`]);
    linha = await guardadaA();
    assert.equal(linha.erro, null);
    assert.equal(linha.motoristaId, leitor);

    /* 4 — na mesma instância, a conferência seguinte espera 4 s; e sem passar o intervalo ninguém lê. */
    await passarOIntervaloDaFila();
    r = await atualizarFilaEntreCiclos();
    assert.equal(r.tentou, false, "conferência repetida em menos de 4 s na mesma instância");
    assert.deepEqual(pedidosNovos(), []);
    // Desta vez o portal manda um cookie novo junto com a fila: a leitura entre ciclos usa a sessão, mas não grava.
    cookieNaFila = "rota=b7; path=/";
    antes = await contas();
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos], [true, ["A"]]);
    assert.deepEqual(pedidosNovos(), ["GET moto/fila"]);
    assert.equal(await contas(), antes, "cookie novo na resposta da fila: nada volta para o banco (quem cuida da sessão é a olhada do Status)");
    cookieNaFila = null;
    r = await entreCiclos();
    assert.equal(r.tentou, false, "acabou de ler: não é hora");
    assert.deepEqual(pedidosNovos(), []);
    assert.deepEqual(avisosNovos(), [], "fila igual: nenhum aviso repetido");

    /* 5 — duas funções ao mesmo tempo (dois aparelhos com o app aberto): só uma abre a aba. */
    await passarOIntervaloDaFila();
    const juntas = await Promise.all([
      atualizarFilaDoPortal(leitor, { entreCiclos: true }),
      atualizarFilaDoPortal(outro, { entreCiclos: true }),
    ]);
    assert.equal(juntas.filter((x) => x.tentou).length, 1, "a reserva no banco deixa passar uma só");
    assert.deepEqual(pedidosNovos(), ["GET moto/fila"]);
    // Quem decide é a reserva no banco, não a conta da instância: outra função acabou de reservar
    // (a hora ainda não venceu), e esta instância acha, pela última tentativa que ELA viu, que já deu tempo.
    await db.execute(sql`update portal_fila set tentativa_em = now() - interval '90 seconds'`);
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos], [false, []]);
    assert.deepEqual(pedidosNovos(), [], "a leitura entre ciclos nunca fura a reserva");

    /* 6 — o portal encerra as sessões: a leitura entre ciclos NÃO entra de novo; fica a última fila boa. */
    portal.sessoes.clear();
    carretasA(28, [29, 30, 32, 33]);
    await passarOIntervaloDaFila();
    antes = await contas();
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos], [true, []]);
    let pedidos = pedidosNovos();
    assert.ok(pedidos.length >= 1 && pedidos.every((p) => p.startsWith("GET ")), pedidos.join(", "));
    assert.equal(pedidos.filter((p) => p === "GET moto/fila").length, 1);
    assert.equal(portal.logins, loginsAntes, "sem sessão, a leitura entre ciclos para: quem entra de novo é a olhada do Status");
    assert.equal(await contas(), antes, "a sessão guardada não foi trocada pelo que o portal respondeu");
    linha = await guardadaA();
    assert.match(linha.erro ?? "", /login/, "o motivo fica guardado para o painel");
    assert.deepEqual(await carretaNaTela(), [26, 5], "a última fila boa continua valendo");
    assert.equal((await montarEstado(bravo.id)).online, true);
    assert.deepEqual(avisosNovos(), []);

    /* 7 — depois de uma falha, a leitura entre ciclos não insiste: nenhum pedido até a carona dar certo. */
    await passarOIntervaloDaFila();
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), []);

    /* 8 — o minuto seguinte: a olhada do Status entra de novo e a carona volta a ler a fila. */
    await passarUmMinuto();
    resumo = await ciclo();
    assert.deepEqual([resumo?.lidos, resumo?.logins, resumo?.fila], [2, 2, 1]);
    pedidosNovos();
    assert.equal((await guardadaA()).erro, null);
    assert.deepEqual(await carretaNaTela(), [28, 4]);
    assert.deepEqual(avisosNovos(), [`chamada → ${endereco("bravo")}`], "o A029 chegou à vez");
    assert.equal((await db.select().from(pontos).where(eq(pontos.id, pBravo.id)))[0].status, "NA VEZ");

    /* 9 — as contas acabaram de entrar DE NOVO (a sessão tinha caído): a leitura entre ciclos se afasta
           delas por 30 minutos. Nenhum pedido, nenhuma reserva tomada, nenhum erro registrado — a carona
           do Status segue livre para ler. É o freio para o caso de as consultas a mais derrubarem sessões. */
    carretasA(29, [30, 32, 33]);
    await passarOIntervaloDaFila();
    const leitorNovo = (await guardadaA()).motoristaId as number;
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos], [false, []]);
    assert.deepEqual(pedidosNovos(), [], "sessão recém-aberta: nenhum pedido");
    linha = await guardadaA();
    assert.equal(linha.erro, null, "não é uma falha: nada fica registrado");
    assert.ok((linha.proximaLeituraEm as Date).getTime() < Date.now(), "a reserva não foi tomada");
    // A segunda tranca: mesmo chamada direto, a leitura sem gravação não usa uma sessão recém-aberta.
    const direta = await atualizarFilaDoPortal(leitorNovo, { entreCiclos: true });
    assert.deepEqual([direta.tentou, direta.lidos], [true, []]);
    assert.deepEqual(pedidosNovos(), [], "nenhum pedido ao portal");
    assert.match((await guardadaA()).erro ?? "", /entrou no portal há menos de 1 min/);
    await db.execute(sql`update portal_fila set erro = null`); // (limpa o registro para o percurso seguir)
    await passarOIntervaloDaFila();
    // 29 minutos depois do login: ainda não.
    await envelhecerLoginsDaSessao(leitorNovo, 29 * 60_000);
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), [], "29 min depois do login: ainda não");
    /* …30 minutos depois do login, a leitura entre ciclos volta sozinha, com a conta que a carona usou. */
    await envelhecerLoginsDaSessao(leitorNovo, 61_000);
    await envelhecerLoginsDaSessao(leitorNovo === alfa.id ? charlie.id : alfa.id, 31 * 60_000);
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos, r.motoristaId], [true, ["A"], leitorNovo]);
    assert.deepEqual(pedidosNovos(), ["GET moto/fila"]);
    assert.deepEqual(await carretaNaTela(), [29, 3]);

    /* 10 — a chave de retorno: PORTAL_FILA_INTERVALO_S=0 volta à carona, e só a ela. */
    process.env.PORTAL_FILA_INTERVALO_S = "0";
    await passarOIntervaloDaFila();
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), []);
    await passarUmMinuto();
    resumo = await ciclo();
    assert.equal(resumo?.fila, 1, "a carona continua lendo");
    linha = await guardadaA();
    const esperaAntiga = (linha.proximaLeituraEm as Date).getTime() - (linha.tentativaEm as Date).getTime();
    assert.ok(esperaAntiga > 44_000 && esperaAntiga <= 45_500, `desligada, a reserva volta aos 45 s: ${esperaAntiga} ms`);
    pedidosNovos();
    delete process.env.PORTAL_FILA_INTERVALO_S;

    /* 11 — fila guardada que já não vale (mais de 3 min sem leitura boa): a corrente quebrou; quem retoma é a carona. */
    await db.execute(sql`update portal_fila set lido_em = now() - interval '10 minutes'`);
    await passarOIntervaloDaFila();
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), []);
    await db.execute(sql`update portal_fila set lido_em = now() - interval '25 seconds'`);
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos], [true, ["A"]], "com a fila em dia de novo, lê");
    assert.deepEqual(pedidosNovos(), ["GET moto/fila"]);

    /* 12 — a conta de quem leu por último foi pausada (senha recusada): nenhum pedido, nenhuma reserva, nenhum erro. */
    const ultimoLeitor = (await guardadaA()).motoristaId as number;
    await db.update(portalMotoristaAcessos).set({ ativo: 0 }).where(eq(portalMotoristaAcessos.motoristaId, ultimoLeitor));
    await passarOIntervaloDaFila();
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), []);
    assert.equal((await guardadaA()).erro, null);
    await db.update(portalMotoristaAcessos).set({ ativo: 1 }).where(eq(portalMotoristaAcessos.motoristaId, ultimoLeitor));
    r = await entreCiclos();
    assert.deepEqual([r.tentou, r.lidos], [true, ["A"]], "conta ativa de novo: lê");
    assert.deepEqual(pedidosNovos(), ["GET moto/fila"]);

    /* 13 — quem leu por último tirou o acesso: não há sessão para continuar; espera a carona de outra conta. */
    await removerAcessoPortal(ultimoLeitor);
    await passarOIntervaloDaFila();
    r = await entreCiclos();
    assert.equal(r.tentou, false);
    assert.deepEqual(pedidosNovos(), []);

    /* Em todo o percurso. */
    assert.deepEqual(paraFora.filter((u) => u.includes("copadubo") || u.includes("composio")), []);
    assert.deepEqual(portal.acoes, [], "nenhuma ação do portal é aberta");
    assert.deepEqual(portal.foraDoSite, []);
    assert.ok(portal.pedidos.every((p) => p.metodo === "GET" || p.caminho.startsWith("seguranca/")), "além do login, só leitura");
  } finally {
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: originalSend });
    globalThis.fetch = fetchReal;
    delete process.env.PORTAL_FILA_INTERVALO_S;
    await pool.end();
  }
});
