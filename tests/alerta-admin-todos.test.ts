import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * "ENVIAR ALERTA PARA TODOS SEM NOTIFICAÇÕES" — o botão do painel.
 *
 * O painel faz UMA chamada (/api/admin/motoristas/alertar-todos) e o servidor
 * grava o alerta de todos EM LOTE: o número de consultas não pode crescer com
 * a quantidade de motoristas. Quando era uma consulta por motorista, 60
 * motoristas viravam ~350 idas e voltas ao banco remoto (o painel ainda abria
 * um pedido HTTP por motorista), o tempo da Function estourava e o botão ficava
 * preso em "Enviando…" com o aplicativo travado.
 *
 * Só roda num PostgreSQL local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/alerta-admin-todos.test.ts
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

test("as três grafias do endpoint apontam para o mesmo tratador", async () => {
  const principal = await import("../src/app/api/admin/motoristas/alertar-todos/route");
  const atalho1 = await import("../src/app/api/admin/motoristas/alerta-todos/route");
  const atalho2 = await import("../src/app/api/admin/motoristas/alerta/route");
  assert.equal(typeof principal.POST, "function");
  assert.equal(atalho1.POST, principal.POST, "/alerta-todos é atalho de /alertar-todos");
  assert.equal(atalho2.POST, principal.POST, "/alerta é atalho de /alertar-todos");
});

test("alerta para todos: lote único, sem Push, sem duplicar, custo fixo", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { alertasMotorista, motoristas, subscriptions } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { criarAlertaParaTodosSemNotificacao, mensagemPadrao, MENSAGEM_MAX } = await import("../src/lib/alerta-admin");
  const webpush = (await import("web-push")).default;
  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  let pushes = 0;
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async () => { pushes++; return { statusCode: 201, body: "" }; },
  });

  // Conta cada consulta SQL que sai do pool.
  let consultas = 0;
  const original = pool.query.bind(pool);
  (pool as unknown as { query: typeof original }).query = ((...a: unknown[]) => {
    consultas++;
    return (original as (...x: unknown[]) => unknown)(...a);
  }) as typeof original;

  try {
    await garantirTabelas();
    await db.delete(alertasMotorista);
    await db.delete(subscriptions);
    await db.delete(motoristas);

    const TOTAL = 40;
    const criados = await db
      .insert(motoristas)
      .values(Array.from({ length: TOTAL }, (_, i) => ({ nome: `Motorista Teste ${i + 1}` })))
      .returning({ id: motoristas.id, nome: motoristas.nome });
    // 2 com notificação ativa (ficam de fora) e 1 com inscrição inativa (entra).
    await db.insert(subscriptions).values([
      { endpoint: "https://push.teste/ativo-1", p256dh: "x", auth: "y", motoristaId: criados[0].id },
      { endpoint: "https://push.teste/ativo-2", p256dh: "x", auth: "y", motoristaId: criados[1].id },
      { endpoint: "https://push.teste/inativo", p256dh: "x", auth: "y", motoristaId: criados[2].id, ativa: 0 },
    ]);

    consultas = 0;
    const r = await criarAlertaParaTodosSemNotificacao("Admin");
    const consultasDoLote = consultas;

    assert.equal(r.total, TOTAL - 2);
    assert.equal(r.enviados, TOTAL - 2);
    assert.equal(pushes, 0, "quem está na lista não tem inscrição ativa: nada a enviar");
    assert.equal(r.pushEnviadas, 0);

    const pendentes = await db.select().from(alertasMotorista);
    assert.equal(pendentes.length, TOTAL - 2);
    for (const a of pendentes) {
      assert.equal(a.resolvidoEm, null);
      assert.notEqual(a.motoristaId, criados[0].id);
      assert.notEqual(a.motoristaId, criados[1].id);
      const dono = criados.find((m) => m.id === a.motoristaId);
      assert.ok(dono, "alerta é de um motorista da lista");
      assert.equal(a.mensagem, mensagemPadrao(dono!.nome), "mensagem padrão com o primeiro nome");
    }

    // Custo fixo: o mesmo número de consultas valeria para 400 motoristas.
    assert.ok(consultasDoLote <= 6, `esperado ≤ 6 consultas, vieram ${consultasDoLote}`);

    // Enviar de novo substitui o pendente — nunca empilha um por envio.
    const deNovo = await criarAlertaParaTodosSemNotificacao("Admin");
    assert.equal(deNovo.enviados, TOTAL - 2);
    assert.equal((await db.select().from(alertasMotorista)).length, TOTAL - 2);

    // Mensagem própria vale para todos, e o limite de tamanho é respeitado.
    await db.delete(alertasMotorista);
    const longa = "Ative as notificações. ".repeat(60);
    const comTexto = await criarAlertaParaTodosSemNotificacao("Admin", longa);
    assert.equal(comTexto.enviados, TOTAL - 2);
    const textos = await db
      .select({ mensagem: alertasMotorista.mensagem, adminNome: alertasMotorista.adminNome })
      .from(alertasMotorista);
    assert.equal(textos.length, TOTAL - 2);
    for (const t of textos) {
      assert.equal(t.mensagem, longa.slice(0, MENSAGEM_MAX));
      assert.equal(t.adminNome, "Admin");
    }
  } finally {
    await pool.end();
  }
});
