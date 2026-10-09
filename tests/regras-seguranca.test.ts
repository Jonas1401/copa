import assert from "node:assert/strict";
import { test } from "node:test";
import { ATRASO_INICIAL_MS, INTERVALO_MS, JANELA_MS, REGRAS, proximaRegra } from "../src/lib/regras-seguranca";

test("regras: 11, na ordem e com o texto pedido", () => {
  assert.equal(REGRAS.length, 11);
  assert.equal(REGRAS[0].titulo, "REGRA 01 — FARÓIS 🚛");
  assert.equal(REGRAS[10].titulo, "REGRA 11 — SEGURANÇA SEMPRE 🦺");
  assert.ok(REGRAS.every((r) => r.texto.startsWith("🚨 Atenção, motorista:")));
});

test("quando mandar: 1 min após a saída, depois a cada 30 min, até 11 ou 6 h", () => {
  const saida = new Date("2026-10-01T10:00:00Z");
  const em = (ms: number) => new Date(saida.getTime() + ms);
  assert.equal(proximaRegra(saida, 0, null, em(30_000)), null, "antes de 1 min: espera o aviso de saída");
  assert.equal(proximaRegra(saida, 0, null, em(ATRASO_INICIAL_MS)), 0);
  assert.equal(proximaRegra(saida, 1, em(ATRASO_INICIAL_MS), em(ATRASO_INICIAL_MS + 10 * 60_000)), null, "intervalo");
  assert.equal(proximaRegra(saida, 1, em(ATRASO_INICIAL_MS), em(ATRASO_INICIAL_MS + INTERVALO_MS)), 1);
  assert.equal(proximaRegra(saida, 11, em(0), em(9 * 60 * 60_000)), null, "já mandou as 11");
  assert.equal(proximaRegra(saida, 3, null, em(JANELA_MS + 1)), null, "saída antiga");
});

/**
 * Ponta a ponta com banco descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/regras-seguranca.test.ts
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try { const u = new URL(uri); return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_"); } catch { return false; }
})();

test("ponta a ponta: saída real não dispara regras automáticas; conteúdo continua disponível à IA", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { motoristas, pontos } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { enviarRegrasSeguranca } = await import("../src/lib/regras-seguranca");
  try {
    await garantirTabelas();
    const agora = new Date();
    const min = (n: number) => new Date(agora.getTime() - n * 60_000);
    const cria = async (nome: string, ponto: Partial<typeof pontos.$inferInsert>) => {
      const [m] = await db.insert(motoristas).values({ nome }).returning();
      await db.insert(pontos).values({ tipo: "TRUCK", livro: "A", numero: m.id, motoristaId: m.id, ...ponto });
      return m.id;
    };
    await cria("João", { status: "SAIU", vistoEm: min(40), saidaEm: min(5) });       // saiu há 5 min
    await cria("Foratabela", { status: "SAIU", vistoEm: null, saidaEm: min(5) });              // nunca esteve no quadro
    await cria("Antigo", { status: "SAIU", vistoEm: min(500), saidaEm: min(7 * 60) });         // saiu há 7 h
    await cria("Esperando", { status: "AGUARDANDO", vistoEm: min(1) });                         // ainda na fila

    const enviados: { motoristaId: number | null | undefined; title: string }[] = [];
    const falso = (async (p: { title: string }, o: { motoristaId?: number | null }) => {
      enviados.push({ motoristaId: o.motoristaId, title: p.title });
      return { enviadas: 1, assinaturas: 1 };
    }) as unknown as typeof import("../src/lib/push").enviarPush;

    for (const ms of [0, 5 * 60000, INTERVALO_MS, 4 * INTERVALO_MS]) {
      const r = await enviarRegrasSeguranca(new Date(agora.getTime() + ms), falso);
      assert.equal(r.enviadas, 0);
      assert.equal(r.motoristas, 0);
    }
    assert.equal(enviados.length, 0);
    const { contextoOrientacoesPorto } = await import("../src/lib/ia-memoria-porto");
    assert.match(await contextoOrientacoesPorto(), /REGRA 01 — FARÓIS/);
  } finally {
    await pool.end();
  }
});
