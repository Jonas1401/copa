import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Teste de integração isolado: nunca rode com o banco de produção.
 * Crie um PostgreSQL local descartável chamado fila_push_test_<qualquer-sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/cron-push.test.ts
 *
 * Sobrescreve fetch dos quadros e envio de Web Push: não toca no site da
 * Copadubo nem envia uma notificação real para motoristas.
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try {
    const u = new URL(uri);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
      u.pathname.startsWith("/fila_push_test_");
  } catch { return false; }
})();

function quadro(livro: string, tipo: "TRUCK" | "CARRETA", ultimo: number, linhas: { numero: number; vermelho?: boolean }[]) {
  return `<h2>Livro ${livro} - ${tipo}</h2>Último Escalado: <b>${livro}${String(ultimo).padStart(3, "0")}</b><table>${linhas.map((l, i) =>
    `<tr${l.vermelho ? " bgcolor='#ff0000'" : ""}><td>${i + 1}</td><td><h3>${livro}${String(l.numero).padStart(3, "0")}</h3></td></tr>`,
  ).join("")}</table>`;
}

test("app fechado: cron aguarda Push, NA VEZ não vira SAIU e uma página parcial não gera falso aviso", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { amostras, eventos, motoristas, notificacoes, pontos, subscriptions } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { GET } = await import("../src/app/api/cron/route");
  const { asc } = await import("drizzle-orm");
  const webpush = (await import("web-push")).default;

  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.COMPOSIO_API_KEY = "";
  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;

  let quadroA = quadro("A", "TRUCK", 39, []) + quadro("A", "CARRETA", 183, [
    { numero: 184, vermelho: true }, { numero: 187 }, { numero: 188 },
  ]);
  let falhaLivroB: "http503" | "parcial200" | null = null;
  const quadroB = quadro("B", "TRUCK", 102, []) + quadro("B", "CARRETA", 22, []);
  const quadroM = quadro("M", "TRUCK", 28, []) + quadro("M", "CARRETA", 69, []);
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/ponto/pontoa.php")) return new Response(quadroA, { status: 200 });
    if (url.endsWith("/ponto/pontob.php")) {
      if (falhaLivroB === "http503") return new Response("Serviço indisponível", { status: 503 });
      if (falhaLivroB === "parcial200") return new Response(quadro("B", "TRUCK", 102, []), { status: 200 });
      return new Response(quadroB, { status: 200 });
    }
    if (url.endsWith("/ponto/pontom.php")) return new Response(quadroM, { status: 200 });
    // Clima roda no cron, mas aqui não há dados: nenhum alerta deve ser criado.
    if (url.includes("simport.com.br") || url.includes("open-meteo.com")) return Response.json([]);
    return fetchReal(input, init);
  };

  const enviados: { title: string; body: string; tag: string; acao: string }[] = [];
  const originalSend = webpush.sendNotification;
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (_endpoint: unknown, corpo: string) => {
      await new Promise((r) => setTimeout(r, 90));
      enviados.push(JSON.parse(corpo));
      return { statusCode: 201, body: "" };
    },
  });

  try {
    await garantirTabelas();
    const [m] = await db.insert(motoristas).values({ nome: "Teste integração" }).returning();
    await db.insert(pontos).values([
      { tipo: "CAVALO", livro: "A", numero: 184, motoristaId: m.id, status: "AGUARDANDO" },
      { tipo: "CAVALO", livro: "A", numero: 187, motoristaId: m.id, status: "AGUARDANDO" },
    ]);
    // Impede a semente de produção em um banco vazio de teste.
    await db.insert(eventos).values({ codigo: "TESTE", tipo: "TRUCK", livro: "A", numero: 1, acao: "cadastrou", mensagem: "Inicialização do teste" });
    await db.insert(subscriptions).values({
      endpoint: "https://fcm.googleapis.com/fcm/send/cron-push-teste-isolado",
      p256dh: chaves.publicKey,
      auth: "teste-sem-rede",
      motoristaId: m.id,
    });
    const executar = async () => {
      const inicio = Date.now();
      const res = await GET(new Request("http://localhost:3000/api/cron", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }));
      assert.equal(res.status, 200);
      return { dados: await res.json() as { origem?: string; rodou?: boolean }, ms: Date.now() - inicio };
    };
    const atuais = async () => db.select().from(pontos).orderBy(asc(pontos.numero));

    const primeira = await executar();
    assert.equal(primeira.dados.origem, "intranet");
    assert.ok(primeira.ms >= 85, "o cron só pode responder depois que o envio ao Push terminou");
    let lista = await atuais();
    assert.equal(lista[0].status, "NA VEZ");
    assert.equal(lista[0].naFrente, 0);
    assert.equal(lista[1].status, "AGUARDANDO");
    assert.equal(lista[1].naFrente, 1);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].acao, "chamada");
    assert.match(enviados[0].body, /NA VEZ/);
    assert.doesNotMatch(enviados[0].body, /saiu para o trabalho/i);
    assert.equal((await db.select().from(eventos)).filter((e) => e.acao === "saiu").length, 0);

    await executar();
    assert.equal(enviados.length, 1, "continua NA VEZ: nada de saída nem Push duplicado");

    // Um quadro retornou 503, mas A ainda contém A184 na primeira linha:
    // a leitura passa a OFFLINE, conserva a posição e não declara saída.
    falhaLivroB = "http503";
    quadroA = quadro("A", "TRUCK", 39, []) + quadro("A", "CARRETA", 184, [
      { numero: 184, vermelho: true }, { numero: 187 },
    ]);
    for (const falha of ["http503", "parcial200"] as const) {
      falhaLivroB = falha;
      const parcial = await executar();
      assert.equal(parcial.dados.origem, "offline", `${falha}: não pode considerar um livro ausente como fila vazia`);
      lista = await atuais();
      assert.equal(lista[0].status, "NA VEZ");
      assert.equal(enviados.length, 1);
      assert.equal((await db.select().from(eventos)).filter((e) => e.acao === "saiu").length, 0);
    }

    // Com os seis quadros válidos, A184 virou Último Escalado, embora ainda
    // esteja no HTML. Agora SIM está confirmado que saiu para o trabalho.
    falhaLivroB = null;
    const fim = await executar();
    assert.equal(fim.dados.origem, "intranet");
    lista = await atuais();
    assert.equal(lista[0].status, "SAIU");
    assert.equal(lista[1].status, "NA VEZ");
    assert.ok(enviados.some((e) => e.acao === "saiu" && /Último Escalado/.test(e.body)));
    assert.ok(enviados.some((e) => e.acao === "chamada" && /NA VEZ/.test(e.body)));
    const tags = (await db.select().from(notificacoes)).map((n) => n.tag);
    assert.ok(tags.some((t) => t.startsWith("CHAMADA_")));
    assert.ok(tags.some((t) => t.startsWith("SAIU_")), "a tag SAÍDA não é bloqueada pela tag NA VEZ");

    await executar();
    assert.equal((await db.select().from(eventos)).filter((e) => e.acao === "saiu").length, 1,
      "a mesma saída não é notificada duas vezes");

    // A187 saiu do site sem virar o Último Escalado: também é saída real.
    quadroA = quadro("A", "TRUCK", 39, []) + quadro("A", "CARRETA", 184, [
      { numero: 188, vermelho: true }, { numero: 189 },
    ]);
    await executar();
    lista = await atuais();
    assert.equal(lista[1].status, "SAIU");
    assert.ok(enviados.some((e) => e.acao === "saiu" && /não aparece mais no quadro/.test(e.body)));
    await executar();
    const saidas = (await db.select().from(eventos)).filter((e) => e.acao === "saiu");
    assert.equal(saidas.length, 2, "cada saída confirmada é avisada uma vez");
    const [ultimo] = await db.select().from(amostras).orderBy(asc(amostras.id));
    assert.ok(ultimo, "o cron persistiu a varredura mesmo com o app fechado");
  } finally {
    globalThis.fetch = fetchReal;
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: originalSend });
    await pool.end();
  }
});
