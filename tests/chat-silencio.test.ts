import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Silenciar SÓ as notificações do chat.
 * Só roda num PostgreSQL local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/chat-silencio.test.ts
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

test("quem silenciou o chat não recebe push do chat, mas continua recebendo o aviso do ponto", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { motoristas, subscriptions } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { notificarMensagemChat } = await import("../src/lib/chat-push");
  const { definirSilencioChat, chatEstaSilenciado } = await import("../src/lib/chat-silencio");
  const { enviarPush } = await import("../src/lib/push");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  const enviados: string[] = [];
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (s: { endpoint: string }) => { enviados.push(s.endpoint.split("/").pop()!); return { statusCode: 201, body: "" }; },
  });

  try {
    await garantirTabelas();
    const ids: Record<string, number> = {};
    for (const nome of ["Autor", "Ana", "Beto"]) {
      const [m] = await db.insert(motoristas).values({ nome }).returning();
      ids[nome] = m.id;
      await db.insert(subscriptions).values({ endpoint: `https://push.teste/${nome}`, p256dh: "x", auth: "y", motoristaId: m.id });
    }

    // Ninguém silenciou: Ana e Beto recebem a mensagem do Autor.
    await notificarMensagemChat({ id: 1, motoristaId: ids.Autor, nome: "Autor", texto: "Fila andando" });
    assert.deepEqual(enviados.sort(), ["Ana", "Beto"]);

    // Beto silencia o chat.
    await definirSilencioChat(ids.Beto, true);
    await definirSilencioChat(ids.Beto, true); // repetir não dá erro
    assert.equal(await chatEstaSilenciado(ids.Beto), true);
    enviados.length = 0;
    await notificarMensagemChat({ id: 2, motoristaId: ids.Autor, nome: "Autor", texto: "☕ Bom dia, motoristas!" });
    assert.deepEqual(enviados, ["Ana"], "Beto silenciou: não recebe");

    // Mensagem do sistema (clima) também respeita o silêncio.
    enviados.length = 0;
    await notificarMensagemChat({ id: 3, motoristaId: 0, nome: "🌦️ Clima no Porto", texto: "Chuva forte chegando" });
    assert.deepEqual(enviados.sort(), ["Ana", "Autor"]);

    // Aviso do PONTO (fora do chat) continua chegando para o Beto.
    enviados.length = 0;
    await enviarPush({ title: "🔔 Ponto na vez nº A014", body: "x", tag: "PONTO_TESTE" }, { motoristaId: ids.Beto });
    assert.deepEqual(enviados, ["Beto"]);

    // Beto reativa: volta a receber o chat.
    await definirSilencioChat(ids.Beto, false);
    enviados.length = 0;
    await notificarMensagemChat({ id: 4, motoristaId: ids.Autor, nome: "Autor", texto: "Voltou?" });
    assert.deepEqual(enviados.sort(), ["Ana", "Beto"]);
  } finally {
    await pool.end();
  }
});
