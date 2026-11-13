import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

test("o olho ao lado do menu alterna os valores monetários da tela inicial", () => {
  const cabecalho = readFileSync("src/components/inicio/Cabecalho.tsx", "utf8");
  const inicio = readFileSync("src/components/MonitorApp.tsx", "utf8");
  const servicos = readFileSync("src/components/inicio/Servicos.tsx", "utf8");
  assert.match(cabecalho, /<MenuConta[\s\S]*?<button[\s\S]*?onClick=\{onAlternarGanhos\}/);
  assert.match(cabecalho, /Mostrar ganhos.*Esconder ganhos/);
  assert.match(cabecalho, /aria-pressed=\{ganhosOcultos\}/);
  assert.match(inicio, /setGanhosOcultos\(\(ocultos\) => !ocultos\)/);
  assert.match(inicio, /ganhosOcultos \? "\*\*\*\*\*" : saldo\.valor/);
  assert.match(inicio, /<Servicos[^>]*ganhosOcultos=\{ganhosOcultos\}/);
  assert.match(servicos, /ganhosOcultos \? "\*\*\*\*\*" : c\.bruto/);
  assert.match(servicos, /ganhosOcultos \? "\*\*\*\*\*" : c\.comissao/);
});
