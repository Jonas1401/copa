import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

/**
 * Filtro do grupo "INFO. OP PORTO / FOSPAR **" de ponta a ponta:
 * Monitor Android autenticado → POST /api/monitor/grupo → Web Push só para o
 * dono de cada ponto.
 *
 * Só roda num PostgreSQL local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/grupo-aviso.test.ts
 * O envio do web-push é substituído: nenhuma notificação real sai.
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try {
    const u = new URL(uri);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_");
  } catch { return false; }
})();

const MENSAGEM = [
  "PONTOS NA VEZ",
  "",
  "CARRETAS TRUCADAS (A):",
  "A014 - A016 - A017 - A018 - A021 - A023 - A024 - A190",
  "",
  "TRUCADAS PULADAS:",
  "A137 - A140 - A144 - A146 - A147",
].join("\n");

test("grupo WhatsApp: cada motorista recebe só o aviso do próprio ponto", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { monitorDevices, motoristas, pontos, subscriptions, monitorMessages } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { HASH_GRUPO_MONITORADO } = await import("../src/lib/monitor-group");
  const { POST } = await import("../src/app/api/monitor/grupo/route");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  const enviados: { endpoint: string; title: string; body: string }[] = [];
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (s: { endpoint: string }, corpo: string) => {
      enviados.push({ endpoint: s.endpoint, ...JSON.parse(corpo) });
      return { statusCode: 201, body: "" };
    },
  });

  try {
    await garantirTabelas();
    const segredo = randomBytes(32).toString("base64url");
    await db.insert(monitorDevices).values({
      tipo: "MONITOR", tokenHash: createHash("sha256").update(segredo).digest("hex"), nome: "Monitor teste",
    });

    // Motoristas, seus pontos e um aparelho com notificação para cada um.
    const cadastro = [
      { nome: "João", tipo: "TRUCK", numero: 14 },   // A014 → na vez
      { nome: "Maria", tipo: "CAVALO", numero: 21 }, // A021 → na vez
      { nome: "Ana", tipo: "CAVALO", numero: 137 },  // A137 → pulado
      { nome: "Pedro", tipo: "TRUCK", numero: 140 }, // A140 → pulado (não confundir com A014)
      { nome: "Carlos", tipo: "TRUCK", numero: 19 }, // A019 → nada (A190 não é A019)
      { nome: "Bia", tipo: "TRUCK", numero: 1 },     // A001 → nada (A014 não é A001)
    ];
    const id: Record<string, number> = {};
    for (const c of cadastro) {
      const [m] = await db.insert(motoristas).values({ nome: c.nome }).returning();
      id[c.nome] = m.id;
      await db.insert(pontos).values({ tipo: c.tipo, livro: "A", numero: c.numero, motoristaId: m.id });
      await db.insert(subscriptions).values({ endpoint: `https://push.teste/${c.nome}`, p256dh: "x", auth: "y", motoristaId: m.id });
    }

    const chamar = (corpo: object, auth = `Bearer ${segredo}`) => POST(new Request("http://teste/api/monitor/grupo", {
      method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(corpo),
    }));
    const evento = (sufixo: string) => createHash("sha256").update(sufixo).digest("hex");
    const base = { origem: "com.whatsapp", grupoHash: HASH_GRUPO_MONITORADO, texto: MENSAGEM };

    // Sem credencial do Monitor ou de outro grupo: recusado, nada enviado.
    assert.equal((await chamar({ ...base, eventId: evento("x") }, "Bearer " + "a".repeat(43))).status, 401);
    assert.equal((await chamar({ ...base, eventId: evento("x"), grupoHash: "0".repeat(64) })).status, 400);
    assert.equal(enviados.length, 0);

    // Mensagem do grupo: 4 avisos, cada um só no aparelho do dono.
    const r1 = await chamar({ ...base, eventId: evento("msg-1") });
    assert.equal(r1.status, 202);
    const j1 = await r1.json();
    assert.equal(j1.naVez, 8);
    assert.equal(j1.pulados, 5);
    assert.equal(j1.avisados, 4);
    const recebido = Object.fromEntries(enviados.map((e) => [e.endpoint.split("/").pop(), e.title]));
    assert.deepEqual(recebido, {
      "João": "🔔 Ponto na vez nº A014",
      "Maria": "🔔 Ponto na vez nº A021",
      "Ana": "⚠️ Ponto pulado nº A137",
      "Pedro": "⚠️ Ponto pulado nº A140",
    });
    assert.equal(enviados.length, 4, "Carlos (A019) e Bia (A001) não recebem nada");

    // O texto da conversa não é gravado: só o resumo com a quantidade de códigos.
    const [gravado] = await db.select().from(monitorMessages);
    assert.deepEqual(gravado.codigos, ["NA VEZ: 8 códigos", "PULADAS: 5 códigos"]);

    // Android reenviou o mesmo evento: não duplica.
    const r2 = await (await chamar({ ...base, eventId: evento("msg-1") })).json();
    assert.equal(r2.duplicada, true);
    // O grupo repetiu a lista no mesmo dia: o motorista não é avisado de novo.
    const r3 = await (await chamar({ ...base, eventId: evento("msg-2") })).json();
    assert.equal(r3.repetidos, 4);
    assert.equal(enviados.length, 4);

    // Mensagem comum do grupo: ignorada, sem aviso.
    const r4 = await chamar({ ...base, eventId: evento("msg-3"), texto: "Bom dia, A014 favor ir à balança." });
    assert.equal(r4.status, 200);
    assert.equal((await r4.json()).ignorada, true);
    assert.equal(enviados.length, 4);
    assert.ok(id["Carlos"] > 0);
  } finally {
    await pool.end();
  }
});
