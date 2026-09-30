import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Alerta individual do administrador: só fecha com notificação ativa NESTE aparelho.
 * Só roda num PostgreSQL local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/alerta-admin.test.ts
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

test("alerta do admin: pendente até ativar; outro motorista/aparelho não fecha; reenviar substitui", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { motoristas, subscriptions, alertasMotorista } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { alertaPendente, cancelarAlerta, criarAlerta, mensagemPadrao, resolverAlerta, ultimosAlertas } = await import("../src/lib/alerta-admin");
  const webpush = (await import("web-push")).default;
  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  const enviados: string[] = [];
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (s: { endpoint: string }) => { enviados.push(s.endpoint); return { statusCode: 201, body: "" }; },
  });

  try {
    await garantirTabelas();
    const [joao] = await db.insert(motoristas).values({ nome: "João Silva" }).returning();
    const [maria] = await db.insert(motoristas).values({ nome: "Maria" }).returning();
    assert.match(mensagemPadrao(joao.nome), /^Olá, João! Suas notificações do CopaLinks estão desativadas/);

    // João sem notificação: alerta criado, nenhum push possível.
    const a1 = await criarAlerta(joao.id, "Ative as notificações, por favor.", "Admin");
    assert.equal(a1.pushEnviadas, 0);
    assert.equal((await alertaPendente(joao.id))?.mensagem, "Ative as notificações, por favor.");
    assert.equal(await alertaPendente(maria.id), null, "Maria não recebe o alerta do João");

    // Sem inscrição: não fecha.
    assert.deepEqual(await resolverAlerta(joao.id, a1.id, ""), { ok: false, motivo: "sem_notificacao" });
    assert.deepEqual(await resolverAlerta(joao.id, a1.id, "https://push.teste/qualquer"), { ok: false, motivo: "sem_notificacao" });

    // Aparelho de OUTRA pessoa não fecha o alerta do João.
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/maria", p256dh: "x", auth: "y", motoristaId: maria.id });
    assert.equal((await resolverAlerta(joao.id, a1.id, "https://push.teste/maria")).ok, false);

    // Reenviar substitui (continua um só pendente).
    const a2 = await criarAlerta(joao.id, mensagemPadrao(joao.nome), "Admin");
    const pendentes = (await db.select().from(alertasMotorista)).filter((a) => a.motoristaId === joao.id && !a.resolvidoEm);
    assert.equal(pendentes.length, 1);
    assert.equal(pendentes[0].id, a2.id);

    // João ativa neste aparelho: agora fecha, e o painel mostra "ativou".
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/joao", p256dh: "x", auth: "y", motoristaId: joao.id });
    assert.deepEqual(await resolverAlerta(joao.id, a2.id, "https://push.teste/joao"), { ok: true });
    assert.equal(await alertaPendente(joao.id), null);
    const painel = await ultimosAlertas([joao.id, maria.id]);
    assert.ok(painel.get(joao.id)?.resolvidoEm);
    assert.equal(painel.has(maria.id), false);

    // Com notificação ativa, o alerta também sai por Push, só para o dono.
    enviados.length = 0;
    const a3 = await criarAlerta(joao.id, "Teste", "Admin");
    assert.equal(a3.pushEnviadas, 1);
    assert.deepEqual(enviados, ["https://push.teste/joao"]);

    // Cancelar remove o pendente.
    assert.equal(await cancelarAlerta(joao.id), true);
    assert.equal(await alertaPendente(joao.id), null);
    assert.equal(await cancelarAlerta(joao.id), false);
  } finally {
    await pool.end();
  }
});
