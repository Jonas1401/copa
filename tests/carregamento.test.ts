import assert from "node:assert/strict";
import { test } from "node:test";
import { FRASES, TEMPO_MAXIMO_MS, TEMPO_MINIMO_MS, deveSair, fraseDaVez, progressoCarregamento } from "../src/lib/carregamento";

test("progresso: sobe devagar, nunca passa de 92% sem estar pronto e vai a 100% quando pronto", () => {
  assert.equal(progressoCarregamento(0, false), 0);
  const a = progressoCarregamento(1000, false), b = progressoCarregamento(3000, false);
  assert.ok(a > 0 && b > a, "anda com o tempo");
  assert.ok(progressoCarregamento(600_000, false) <= 0.92);
  assert.equal(progressoCarregamento(10, true), 1);
  assert.equal(progressoCarregamento(Number.NaN, false), 0);
});

test("saída: espera o mínimo, sai quando pronto e nunca prende o app", () => {
  assert.equal(deveSair(100, true), false, "não pisca em internet rápida");
  assert.equal(deveSair(TEMPO_MINIMO_MS, true), true);
  assert.equal(deveSair(5000, false), false);
  assert.equal(deveSair(TEMPO_MAXIMO_MS, false), true, "trava de segurança");
});

test("frases trocam enquanto carrega e mostram Pronto! no fim", () => {
  assert.equal(fraseDaVez(0, false), FRASES[0]);
  assert.equal(fraseDaVez(1300, false), FRASES[1]);
  assert.equal(fraseDaVez(1300 * FRASES.length, false), FRASES[0]);
  assert.equal(fraseDaVez(500, true), "Pronto!");
});
