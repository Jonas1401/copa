import assert from "node:assert/strict";
import { test } from "node:test";
import { analisarPortal } from "../src/lib/portal-copadubo-parse";
import { pontoEmDispensa } from "../src/lib/portal-status-ponto";

const agora = Date.parse("2026-11-09T12:00:00Z");
const ponto = { livro: "A", numero: 32, criadoEm: "2026-11-09T10:00:00Z" };
function leitura(texto: string, em = agora, ok = 1) {
  return { ok, criadoEm: new Date(em), secoes: analisarPortal(`<h1>Status do Ponto</h1><p>A032</p><p>${texto}</p>`).secoes };
}

test("dispensa recente pertence somente ao ponto identificado pelo portal", () => {
  assert.equal(pontoEmDispensa(leitura("EM DISPENSA"), ponto, agora), true);
  assert.equal(pontoEmDispensa(leitura("EM DISPENSA"), { ...ponto, numero: 33 }, agora), false);
  assert.equal(pontoEmDispensa(leitura("EM DISPENSA"), { ...ponto, livro: "B" }, agora), false);
  assert.equal(pontoEmDispensa(leitura("EM ATENDIMENTO"), ponto, agora), false);
});

test("não mostra dispensa com leitura falha, antiga ou anterior ao cadastro", () => {
  assert.equal(pontoEmDispensa(null, ponto, agora), false);
  assert.equal(pontoEmDispensa(leitura("EM DISPENSA", agora, 0), ponto, agora), false);
  assert.equal(pontoEmDispensa(leitura("EM DISPENSA", agora - 16 * 60_000), ponto, agora), false);
  assert.equal(pontoEmDispensa(leitura("EM DISPENSA"), { ...ponto, criadoEm: "2026-11-09T12:01:00Z" }, agora), false);
});
