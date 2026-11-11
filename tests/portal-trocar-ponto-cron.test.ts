import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, telaFila, type CartaoFalso } from "./portal-fixture";

/**
 * O PORTAL MOSTRA UM PONTO POR VEZ — DE PONTA A PONTA, PELO CRON.
 *
 * Como no site real: a conta tem vários pontos, e “Status do Ponto” só mostra o
 * que foi escolhido em “Trocar Ponto”. O cron escolhe cada ponto do motorista,
 * lê o Status dele e avisa a TROCA de situação — de cada ponto, com as linhas
 * do cartão DELE. O formulário de dispensa da mesma tela nunca é enviado.
 *
 * Teste de integração isolado: nunca rode com o banco de produção. Use um
 * PostgreSQL local descartável e VAZIO chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_troca \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_troca \
 *   ./node_modules/.bin/tsx --test tests/portal-trocar-ponto-cron.test.ts
 *
 * Nada sai da máquina; pessoas, CPFs, placas e escalas são inventados.
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

// CPF com os dígitos verificadores ERRADOS de propósito (não é de ninguém) e senha inventada.
const CPF = "70000000007";
const SENHA = "senha-golf-7";

type Aviso = { title: string; body: string; tag: string; acao: string; endpoint: string };

test("um ponto por vez: o cron escolhe cada ponto em “Trocar Ponto”, lê o Status e avisa a troca", { skip: !local }, async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-este-teste-0123456789";
  process.env.COMPOSIO_API_KEY = "";
  // Este teste cobre a fila lida do quadro público antigo (hoje a fonte padrão é a aba “Fila” do portal).
  process.env.FONTE_FILA = "quadro";
  delete process.env.PORTAL_FONTE_SAIDA;
  delete process.env.PORTAL_INTERVALO_MIN;

  const { db, pool } = await import("../src/db");
  const { eventos, motoristas, pontos, portalSituacoes, subscriptions } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { salvarAcessoPortal } = await import("../src/lib/portal-copadubo");
  const { GET } = await import("../src/app/api/cron/route");
  const { asc, sql } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;

  /* A conta tem quatro pontos; o motorista monitora dois (A032 e A063) no app. */
  const cartao = (codigo: string, situacao: string, linhas: string[]): CartaoFalso => ({
    codigo,
    situacao,
    linhas,
    nome: "GOLF TESTE DE OLIVEIRA",
    botao: situacao === "EM DISPENSA" ? "Sair da dispensa" : "Entrar na dispensa",
  });
  const portal = criarPortalFalso({
    cpf: CPF,
    senha: SENHA,
    escolha: {
      cartoes: [
        cartao("A006", "ESCALADO", ["Navio: DE UM PONTO QUE NAO E MONITORADO"]),
        cartao("A032", "ATIVO", ["Ativado hoje, 19:50 <b>há 2 h 27 min</b>"]),
        cartao("A063", "ATIVO", ["Ativado hoje, 18:05 <b>há 4 h 12 min</b>"]),
        cartao("B171", "EM DISPENSA", ["MOTIVO", "002 - DESCANSO"]),
      ],
    },
    telas: { "moto/fila": telaFila("A", "A102", [{ codigo: "A063", tipo: "CARRETA 6 EIXOS" }]) },
  });
  const cartoes = portal.escolha!.cartoes;

  const quadroA = quadro("A", "TRUCK", 39, []) + quadro("A", "CARRETA", 183, [40, 32, 63]);
  const quadroB = quadro("B", "TRUCK", 102, []) + quadro("B", "CARRETA", 22, []);
  const quadroM = quadro("M", "TRUCK", 28, []) + quadro("M", "CARRETA", 69, []);
  const desconhecidos: string[] = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(`${BASE_FALSA}/`)) return portal.buscar(input, init);
    if (url.endsWith("/ponto/pontoa.php")) return new Response(quadroA, { status: 200 });
    if (url.endsWith("/ponto/pontob.php")) return new Response(quadroB, { status: 200 });
    if (url.endsWith("/ponto/pontom.php")) return new Response(quadroM, { status: 200 });
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

    const [golf] = await db.insert(motoristas).values({ nome: "Golf Teste" }).returning();
    for (const numero of [32, 63]) {
      await db.insert(pontos).values({ tipo: "CAVALO", livro: "A", numero, motoristaId: golf.id, status: "AGUARDANDO" });
    }
    await db
      .insert(subscriptions)
      .values({ endpoint: "https://fcm.googleapis.com/fcm/send/trocar-ponto-golf", p256dh: chaves.publicKey, auth: "teste-sem-rede", motoristaId: golf.id });
    await salvarAcessoPortal(golf.id, { cpf: CPF, senha: SENHA });

    const executar = async () => {
      const res = await GET(new Request("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(res.status, 200);
      const dados = (await res.json()) as { portal?: { motoristas: number; lidos: number; falhas: number; adiados: number; avisos: number; logins: number } };
      return dados.portal ?? null;
    };
    const adiantar = () => db.execute(sql`update portal_motorista_acessos set proxima_leitura_em = now() - interval '1 second'`);
    let lidos = 0;
    /** Avisos do PORTAL desde a última chamada (os do quadro — “perto da vez” — ficam de fora). */
    const novos = () => {
      const fatia = enviados.slice(lidos).filter((a) => a.acao !== "chamada" && a.acao !== "preparar");
      lidos = enviados.length;
      return fatia;
    };
    const situacoes = async () => (await db.select().from(portalSituacoes).orderBy(asc(portalSituacoes.codigo))).map((s) => `${s.codigo}=${s.turno}`);

    /* 1 — primeira leitura: um login, uma escolha por ponto monitorado, ponto de partida sem aviso. */
    let resumo = await executar();
    assert.deepEqual(novos(), [], "a primeira leitura não é novidade");
    assert.deepEqual(await situacoes(), ["A032=ATIVO", "A063=ATIVO"], "só os pontos que o motorista monitora");
    assert.deepEqual(portal.trocas, ["A032", "A063"]);
    assert.equal(portal.logins, 1);
    assert.equal(resumo?.lidos, 1);
    assert.equal(resumo?.falhas, 0);

    /* 2 — o A063 é escalado: UM aviso, do A063, com as linhas do cartão dele. */
    cartoes[2] = cartao("A063", "ESCALADO", ["Escalado hoje, 22:40 <b>há 1 min</b>", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO"]);
    await adiantar();
    resumo = await executar();
    let rodada = novos();
    assert.equal(rodada.length, 1, JSON.stringify(rodada.map((a) => a.title)));
    assert.equal(rodada[0].title, "🚛 Seu ponto foi ESCALADO");
    assert.match(rodada[0].body, /Seu ponto A063 foi ESCALADO\./);
    assert.match(rodada[0].body, /Navio: NAVIO DE EXEMPLO/);
    assert.match(rodada[0].body, /Terminal: TERMINAL DE EXEMPLO/);
    assert.match(rodada[0].body, /Trabalho: CARRETA 6 EIXOS · Livro A\./, "o tipo de trabalho vem da aba Fila");
    // Nada do outro ponto, do ponto que ele não monitora, nem do formulário de dispensa.
    for (const proibido of ["A032", "19:50", "NAO E MONITORADO", "Motivo", "OFICINA", "DESCANSO", "Cancelar", "Confirmar", "GOLF TESTE", CPF, SENHA]) {
      assert.ok(!rodada[0].body.includes(proibido), `o aviso não pode trazer “${proibido}”: ${rodada[0].body}`);
    }
    assert.deepEqual(await situacoes(), ["A032=ATIVO", "A063=ESCALADO"]);
    assert.equal(resumo?.avisos, 1);
    assert.equal(portal.logins, 1, "a sessão guardada continua valendo");

    /* 3 — nada mudou: nenhum aviso; uma escolha por leitura (a sessão fica no último ponto lido). */
    const trocasAntes = portal.trocas.length;
    await adiantar();
    resumo = await executar();
    assert.deepEqual(novos(), []);
    assert.equal(portal.trocas.length - trocasAntes, 1);
    assert.equal(resumo?.lidos, 1);

    /* 4 — o A032 vai para a dispensa: aviso do A032, com o motivo dele. */
    cartoes[1] = cartao("A032", "EM DISPENSA", ["Em dispensa desde hoje, 23:05 <b>há 1 min</b>", "MOTIVO", "001 - OFICINA"]);
    await adiantar();
    await executar();
    rodada = novos();
    assert.equal(rodada.length, 1, JSON.stringify(rodada.map((a) => a.title)));
    assert.equal(rodada[0].title, "🟥 Seu ponto foi para a DISPENSA");
    assert.match(rodada[0].body, /Seu ponto A032 saiu para a DISPENSA \(motivo 001 - OFICINA\)\./);
    assert.ok(!rodada[0].body.includes("A063") && !rodada[0].body.includes("DESCANSO"));

    /* 5 — o A063 volta para a fila. */
    cartoes[2] = cartao("A063", "ATIVO", ["Ativado hoje, 23:30 <b>há 1 min</b>"]);
    await adiantar();
    await executar();
    rodada = novos();
    assert.equal(rodada.length, 1, JSON.stringify(rodada.map((a) => a.title)));
    assert.equal(rodada[0].title, "🟦 Seu ponto está ATIVO");
    assert.match(rodada[0].body, /Seu ponto A063 voltou para a fila/);
    assert.deepEqual(await situacoes(), ["A032=EM DISPENSA", "A063=ATIVO"]);

    /* Em todo o percurso: um login, nenhuma ação aberta, só os dois pontos monitorados escolhidos. */
    assert.equal(portal.logins, 1);
    assert.deepEqual(portal.acoes, [], "o formulário de dispensa e o “Sair” nunca são tocados");
    assert.deepEqual([...new Set(portal.trocas)].sort(), ["A032", "A063"]);
    assert.equal(portal.trocasRecusadas, 0);
    const envios = portal.pedidos.filter((p) => p.metodo === "POST" && !p.caminho.startsWith("seguranca/"));
    assert.ok(envios.every((p) => p.caminho === "moto/trocar_ponto.php" && /^id_ponto=10[23]$/.test(p.corpo)), "só a escolha do ponto é enviada");
    assert.deepEqual(portal.foraDoSite, []);
    assert.deepEqual(desconhecidos.filter((u) => u.includes("copadubo")), []);
  } finally {
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: originalSend });
    globalThis.fetch = fetchReal;
    await pool.end();
  }
});
