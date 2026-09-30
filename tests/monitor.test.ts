import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { normalizarCodigo, extrairCodigos } from "../src/lib/matcher";
import { validarEventoMonitor } from "../src/lib/monitor";
import { HASH_GRUPO_MONITORADO, NOME_GRUPO_MONITORADO, normalizarNomeGrupo } from "../src/lib/monitor-group";

const eventId = "a".repeat(64);

test("normalização de A/B/M e proteção contra códigos parciais", () => {
  assert.equal(normalizarCodigo("A184"), "A184");
  assert.equal(normalizarCodigo("b-022"), "B22");
  assert.equal(normalizarCodigo("M 069"), "M69");
  for (const v of ["A000", "C184", "A1840", "123", "A-0", "ABC184", "A - 1000"]) assert.equal(normalizarCodigo(v), null);
  assert.deepEqual(extrairCodigos("A184, A 184, B-022 e M069"), ["A184", "B22", "M69"]);
  assert.deepEqual(extrairCodigos("A1840 ABC184 grupoB184 4191994041"), []);
});

test("monitor só aceita o grupo exato, códigos sem texto bruto e origem WhatsApp", () => {
  assert.equal(NOME_GRUPO_MONITORADO, "INFO. OP PORTO / FOSPAR **");
  assert.equal(normalizarNomeGrupo("  info.  op porto /  fospar **  "), NOME_GRUPO_MONITORADO);
  assert.notEqual(normalizarNomeGrupo("INFO. OP PORTO / FOSPAR ** OUTRO"), NOME_GRUPO_MONITORADO);
  assert.equal(HASH_GRUPO_MONITORADO, "dd7790905a6cb38e7d5368c24e810ec1171af1153135300af46cc7b5225fe895");
  const base = { eventId, origem: "com.whatsapp", grupoHash: HASH_GRUPO_MONITORADO, message: "A184 B22" };
  const ok = validarEventoMonitor(base);
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.codigos, ["A184", "B22"]);
  for (const p of [
    { ...base, grupoHash: undefined },
    { ...base, grupoHash: "b".repeat(64) },
    { ...base, message: "Olá, seu A184 vai sair da fila" },
    { ...base, origem: "com.instagram.android" },
    { ...base, eventId: "x" },
    { ...base, message: "A1840" },
  ]) assert.equal(validarEventoMonitor(p).ok, false);
});

const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  try {
    if (!uri || process.env.DATABASE_URL !== uri) return false;
    const u = new URL(uri);
    return ["localhost", "127.0.0.1"].includes(u.hostname) && u.pathname.startsWith("/monitor_test_");
  } catch { return false; }
})();

test("PostgreSQL isolado: pareamento de uso único, distribuição por dono e deduplicação", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { motoristas, monitorCodes, monitorDevices, monitorMessages, monitorDeliveries } = await import("../src/db/schema");
  const { gerarPareamento, parearAparelho, dispositivoAutenticado } = await import("../src/lib/auth");
  const { processarEventoMonitor } = await import("../src/lib/monitor");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { eq } = await import("drizzle-orm");
  try {
    await garantirTabelas();
    const owners = await db.insert(motoristas).values([
      { nome: "Motorista A" }, { nome: "Motorista B" }, { nome: "Motorista C" },
    ]).returning({ id: motoristas.id });
    const [a, b, c] = owners;
    await db.insert(monitorCodes).values([
      { motoristaId: a.id, codigo: "A184" },
      { motoristaId: b.id, codigo: "B22" },
      { motoristaId: c.id, codigo: "A184" },
    ]);
    const monCode = await gerarPareamento("MONITOR", null);
    const paired = await parearAparelho("MONITOR", monCode.codigo, "Teste monitor", null);
    assert.ok(paired);
    assert.equal(await parearAparelho("MONITOR", monCode.codigo, "Repetido", null), null);
    assert.equal((await dispositivoAutenticado(new Request("https://local/api", { headers: { authorization: `Bearer ${paired.deviceSecret}` } }), "MONITOR"))?.id, paired.deviceId);
    assert.equal(await dispositivoAutenticado(new Request("https://local/api", { headers: { authorization: `Bearer ${paired.deviceSecret}` } }), "RECEIVER"), null);
    const saved = await db.select().from(monitorDevices).where(eq(monitorDevices.id, paired.deviceId));
    assert.equal(saved[0].tokenHash.length, 64);
    assert.notEqual(saved[0].tokenHash, paired.deviceSecret);

    const tokenA = "fcm-a-" + randomBytes(30).toString("hex");
    const tokenB = "fcm-b-" + randomBytes(30).toString("hex");
    const tokenC = "fcm-c-" + randomBytes(30).toString("hex");
    for (const [owner, token] of [[a, tokenA], [b, tokenB], [c, tokenC]] as const) {
      const code = await gerarPareamento("RECEIVER", owner.id);
      const receiver = await parearAparelho("RECEIVER", code.codigo, "Celular teste", token);
      assert.ok(receiver);
      assert.equal(await parearAparelho("RECEIVER", code.codigo, "Usado", token), null);
    }
    const delivered: { token: string; code: string }[] = [];
    const mockSend = async (token: string, code: string) => {
      delivered.push({ token, code });
      return "fcm-aceito-mock";
    };
    const [monitor] = await db.select().from(monitorDevices).where(eq(monitorDevices.id, paired.deviceId));
    const input = { eventId, origem: "com.whatsapp", codigos: ["A184", "B22"] };
    const result = await processarEventoMonitor(monitor, input, mockSend);
    assert.equal(result.aceitas, 3);
    assert.deepEqual(delivered.map((d) => d.code).sort(), ["A184", "A184", "B22"]);
    assert.deepEqual(delivered.filter((d) => d.code === "A184").map((d) => d.token).sort(), [tokenA, tokenC].sort());
    assert.equal(delivered.find((d) => d.code === "B22")?.token, tokenB);
    assert.equal((await processarEventoMonitor(monitor, input, mockSend)).duplicada, true);
    assert.equal(delivered.length, 3, "um evento repetido nunca dispara outro FCM");

    const [code] = await db.select().from(monitorCodes).where(eq(monitorCodes.motoristaId, c.id));
    await db.update(monitorCodes).set({ ativo: 0 }).where(eq(monitorCodes.id, code.id));
    delivered.length = 0;
    const result2 = await processarEventoMonitor(monitor, { ...input, eventId: "b".repeat(64) }, mockSend);
    assert.equal(result2.aceitas, 2);
    assert.deepEqual(delivered.map((d) => d.token).sort(), [tokenA, tokenB].sort());
    assert.equal((await db.select().from(monitorDeliveries)).length, 5);
    const events = await db.select().from(monitorMessages);
    assert.equal(events.length, 2);
    assert.deepEqual(events[0].codigos, ["A184", "B22"]);
    assert.equal("texto" in events[0], false, "nenhum conteúdo da conversa é persistido");
  } finally {
    await pool.end();
  }
});
