import assert from "node:assert/strict";
import { test } from "node:test";
import { paginaAppa, paginaSinprapar } from "./navios-fixture";

/**
 * Avisos de navios de fertilizantes de ponta a ponta (cron → chat → Push).
 * Só roda num PostgreSQL local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/navios-aviso.test.ts
 * Não acessa APPA/SINPRAPAR/Open-Meteo (fetch substituído) nem envia Push real.
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try { const u = new URL(uri); return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_"); } catch { return false; }
})();

test("navios: 1ª leitura não avisa; novo programado avisa 1 vez no chat e por Push; carga comum ignorada", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { chatMensagens, motoristas, subscriptions, naviosAvisos } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { limparCacheNavios } = await import("../src/lib/navios");
  const { verificarNaviosFertilizantes, NOME_NAVIOS } = await import("../src/lib/navios-aviso");
  const webpush = (await import("web-push")).default;
  process.env.COMPOSIO_API_KEY = "";
  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey; process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  const pushes: string[] = [];
  Object.defineProperty(webpush, "sendNotification", { configurable: true, value: async (_s: unknown, c: string) => { pushes.push(JSON.parse(c).title); return { statusCode: 201 }; } });

  let appa = paginaAppa({ ATRACADOS: [{ "Programação": "1", "Berço": "114", "Embarcação": "ZY IDOL", IMO: "1", Mercadoria: "UREIA", Previsto: "32.219,000 Tons." }] });
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("appaweb")) return new Response(appa);
    if (url.includes("sinprapar")) return new Response(paginaSinprapar([{ data: "01/10", hora: "02:00", navio: "LEO. K", manobra: "AT: F93/AZ211", calado: "11,40", imo: "2", situacao: "A CONFIRMAR" }]));
    if (url.includes("open-meteo")) return Response.json({ hourly: { time: ["2099-10-01T00:00", "2099-10-01T01:00", "2099-10-01T02:00"], sea_level_height_msl: [0.1, 0.7, 0.2] } });
    if (url.includes("composio")) throw new Error("sem composio no teste");
    return fetchReal(input, init);
  };
  try {
    await garantirTabelas();
    const [m] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: m.id });

    // 1ª leitura: o navio que JÁ estava atracado não gera aviso antigo.
    const r1 = await verificarNaviosFertilizantes({ forcar: true });
    assert.match(r1.motivo, /primeira leitura: 1 evento/);
    assert.equal((await db.select().from(chatMensagens)).length, 0);
    assert.equal(pushes.length, 0);

    // Surge um navio de MAP programado (berço definido) e um de açúcar.
    appa = paginaAppa({
      ATRACADOS: [{ "Programação": "1", "Berço": "114", "Embarcação": "ZY IDOL", IMO: "1", Mercadoria: "UREIA", Previsto: "32.219,000 Tons." }],
      PROGRAMADOS: [
        { "Programação": "2", "Berço": "211", "Embarcação": "LEO. K", IMO: "2", Mercadoria: "MAP", Previsto: "70.000,000 Tons." },
        { "Programação": "9", "Berço": "204", "Embarcação": "OCEAN AZALEA", IMO: "9", Mercadoria: "AÇÚCAR", Previsto: "60.000,000 Tons." },
      ],
    });
    limparCacheNavios();
    const r2 = await verificarNaviosFertilizantes({ forcar: true });
    assert.deepEqual(r2.avisados, ["programado:LEO. K"]);
    const msgs = await db.select().from(chatMensagens);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].nome, NOME_NAVIOS);
    assert.match(msgs[0].texto, /LEO\. K.*berço 211.*map \(70\.000 t\)/);
    assert.deepEqual(pushes, [NOME_NAVIOS], "Push com o nome do aviso");

    // Mesma situação no próximo ciclo: não repete. Intervalo de 5 min respeitado.
    limparCacheNavios();
    assert.equal((await verificarNaviosFertilizantes({ forcar: true })).avisados.length, 0);
    assert.equal((await verificarNaviosFertilizantes()).motivo, "aguardando intervalo");
    assert.equal((await db.select().from(chatMensagens)).length, 1);
    assert.equal((await db.select().from(naviosAvisos)).length, 2);
  } finally {
    globalThis.fetch = fetchReal;
    await pool.end();
  }
});
