import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DURACAO_ENCERRAMENTO_MS, DURACAO_MINIMA_MS, DURACAO_VINHETA_MS,
  calcularVelocidade, progressoDoCarregamento,
} from "../src/lib/vinheta";

test("vinheta: mesmos tempos da versão que estava no ar (5 s, fim em 0,6 s)", () => {
  assert.equal(DURACAO_VINHETA_MS, 5000);
  assert.equal(DURACAO_MINIMA_MS, 5000);
  assert.equal(DURACAO_ENCERRAMENTO_MS, 600);
});

test("vinheta: progresso do carregamento e velocidade", () => {
  assert.equal(progressoDoCarregamento({ pronto: true, decorridoMs: 0 }), 1);
  assert.equal(progressoDoCarregamento({ pronto: false, decorridoMs: 6000 }), 0.5);
  assert.equal(progressoDoCarregamento({ pronto: false, decorridoMs: 60000 }), 0.85, "sem pronto, para em 85%");
  assert.equal(progressoDoCarregamento({ pronto: false, decorridoMs: -5 }), 0);
  assert.equal(calcularVelocidade(0), 1);
  assert.ok(Math.abs(calcularVelocidade(1) - 3.2) < 1e-9);
  assert.equal(calcularVelocidade(Number.NaN), 1);
  assert.ok(Math.abs(calcularVelocidade(5) - 3.2) < 1e-9, "limitado a 3,2x");
});
