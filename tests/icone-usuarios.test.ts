import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");
const cabecalho = () => ler("src/components/inicio/Cabecalho.tsx");
const app = () => ler("src/components/MonitorApp.tsx");

test("o topo não exibe a imagem do motorista nem o número de usuários", () => {
  const c = cabecalho();
  assert.doesNotMatch(c, /IconeUsuarios|motorista-icone|totalMotoristas/);
  const chamada = app().match(/<Cabecalho\b[\s\S]*?\/>/);
  assert.ok(chamada, "o cabeçalho deixou de ser exibido");
  assert.doesNotMatch(chamada[0], /totalMotoristas/);
});

test("o menu, compartilhamento e previsão permanecem no topo", () => {
  const c = cabecalho();
  assert.match(c, /<MenuConta\b/);
  assert.match(c, /onClick=\{onCompartilhar\}/);
  assert.match(c, /<Share2\b/);
  assert.match(c, /<ChipClima\s*\/>/);
  assert.match(c, /href="\/tempo"/);
  assert.match(c, /fetch\("\/api\/tempo"/);
  assert.match(app(), /onCompartilhar=\{compartilhar\}/);
});

test("a contagem de motoristas permanece na aba Sobre; o rodapé mostra navios atracados", () => {
  assert.match(app(), /usando o CopaLinks/);
  const nav = ler("src/components/inicio/NavInferior.tsx");
  assert.match(nav, /naviosAtracados\s*=\s*0/, "o selo de navios precisa começar/voltar em 0");
  assert.match(nav, /Navios/, "o item do rodapé precisa se chamar Navios");
  assert.match(nav, /Ship/, "o item do rodapé precisa usar o ícone de navio");
  assert.match(app(), /<NavInferior[\s\S]*?naviosAtracados=\{naviosAtracados\}/);
});
