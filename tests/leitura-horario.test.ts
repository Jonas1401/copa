import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * "Atualizado há…" = horário da leitura REAL do quadro da Copadubo.
 *
 * Teste de integração isolado (mesma regra do cron-push.test.ts): só roda num
 * PostgreSQL local descartável chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/leitura-horario.test.ts
 *
 * Sobrescreve o fetch dos quadros: não acessa o site da Copadubo.
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

function quadro(livro: string, tipo: "TRUCK" | "CARRETA", ultimo: number, numeros: number[]) {
  return `<h2>Livro ${livro} - ${tipo}</h2>Último Escalado: <b>${livro}${String(ultimo).padStart(3, "0")}</b><table>${numeros.map((n, i) =>
    `<tr${i === 0 ? " bgcolor='#ff0000'" : ""}><td>${i + 1}</td><td><h3>${livro}${String(n).padStart(3, "0")}</h3></td></tr>`,
  ).join("")}</table>`;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("contador mostra a hora da leitura real; falha no site não renova o horário nem fica ONLINE", { skip: !local }, async () => {
  const { pool } = await import("../src/db");
  const { garantirTabelas, varrer, montarEstado } = await import("../src/lib/estado");
  process.env.COMPOSIO_API_KEY = "";

  let siteFora = false;
  const paginas: Record<string, string> = {
    "/ponto/pontoa.php": quadro("A", "TRUCK", 39, [40, 41]) + quadro("A", "CARRETA", 183, [184, 187]),
    "/ponto/pontob.php": quadro("B", "TRUCK", 102, [103]) + quadro("B", "CARRETA", 22, [23]),
    "/ponto/pontom.php": quadro("M", "TRUCK", 28, [29]) + quadro("M", "CARRETA", 69, [70]),
  };
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const pagina = Object.keys(paginas).find((p) => url.endsWith(p));
    if (pagina) return siteFora ? new Response("fora do ar", { status: 503 }) : new Response(paginas[pagina], { status: 200 });
    if (url.includes("composio")) throw new Error("Composio desligado no teste");
    return fetchReal(input, init);
  };

  try {
    await garantirTabelas();

    // Banco sem nenhuma leitura: não finge que atualizou.
    const vazio = await montarEstado(null);
    assert.equal(vazio.temLeitura, false);
    assert.equal(vazio.online, false);
    assert.ok(vazio.servidorAgora, "resposta traz o relógio do servidor");

    // 1) Leitura real do site: horário = agora e ONLINE.
    const antes = Date.now();
    await varrer({ forcarRede: true });
    const ok = await montarEstado(null);
    const lidoEm = new Date(ok.atualizadoEm).getTime();
    assert.equal(ok.temLeitura, true);
    assert.equal(ok.online, true);
    assert.ok(lidoEm >= antes - 50 && lidoEm <= Date.now(), "horário da leitura real");

    // 2) Site fora do ar: a tentativa é gravada, mas o horário mostrado
    // continua o da última leitura boa e o monitor sai de ONLINE.
    await espera(1200);
    siteFora = true;
    await varrer({ forcarRede: true });
    const fora = await montarEstado(null);
    assert.equal(fora.origem, "offline");
    assert.equal(fora.online, false);
    assert.equal(fora.atualizadoEm, ok.atualizadoEm, "falha não renova o 'Atualizado há'");
    assert.ok(
      new Date(fora.servidorAgora).getTime() - new Date(fora.atualizadoEm).getTime() >= 1000,
      "o contador continua subindo enquanto o site não responde",
    );

    // 3) Site voltou: nova leitura real, horário renovado e ONLINE de novo.
    siteFora = false;
    await varrer({ forcarRede: true });
    const voltou = await montarEstado(null);
    assert.equal(voltou.online, true);
    assert.ok(new Date(voltou.atualizadoEm).getTime() > lidoEm, "nova leitura real renova o horário");
  } finally {
    globalThis.fetch = fetchReal;
    await pool.end();
  }
});
