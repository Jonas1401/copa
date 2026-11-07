import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Ícone do capacete no topo da tela inicial (ao lado do menu ⋮).
 *
 * Pedido do Jonas: o desenho antigo era uma cabeça de capacete com um balão
 * mostrando o total de usuários. Agora é SÓ o capacete, mais bem desenhado —
 * sem número desenhado na tela. A contagem continua no cartão e no
 * distintivo da aba "Sobre", e no rótulo acessível deste ícone.
 *
 * Como rodar:
 *   ./node_modules/.bin/tsx --test tests/icone-capacete.test.ts
 */

const ler = (p: string) => readFileSync(p, "utf8");
const icone = () => ler("src/components/inicio/IconeUsuarios.tsx");
const app = () => ler("src/components/MonitorApp.tsx");
const nav = () => ler("src/components/inicio/NavInferior.tsx");

test("o ícone é só o capacete: nenhum número é desenhado na tela", () => {
  const s = icone();
  assert.ok(!s.includes("<text"), "o balão com o número voltou a ser desenhado");
  assert.ok(!s.includes("<rect"), "o distintivo do total voltou para o ícone");
  assert.ok(!s.includes("999+"), "a abreviação da contagem voltou para o desenho");
  // nada de fonte/contador dinâmico: o desenho não depende mais do total
  assert.ok(!s.includes("fontSize"), "o ícone voltou a calcular fonte para o número");
  assert.ok(!s.includes("texto.length"), "o ícone voltou a medir o texto do número");
});

test("o capacete tem casco, crista central e aba saliente", () => {
  const s = icone();
  const paths = [...s.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length >= 4, `o capacete perdeu partes do desenho (${paths.length} traços)`);
  // crista: dois vincos verticais do topo do casco até a aba
  const verticais = paths.filter((d) => /^M[\d.]+ [\d.]+V[\d.]+$/.test(d));
  assert.equal(verticais.length, 2, "o capacete perdeu os dois vincos da crista central");
  // aba: traço horizontal largo com as pontas arredondadas (arcos nos dois lados)
  const aba = paths.find((d) => d.includes("h34.8") && d.includes("a3.1 3.1"));
  assert.ok(aba, "o capacete perdeu a aba saliente com as pontas arredondadas");
  // o desenho usa traço (igual aos outros controles do topo), não preenchimento
  assert.ok(s.includes('stroke="currentColor"'), "o capacete deixou de herdar a cor do tema");
  assert.ok(s.includes('fill="none"'), "o capacete virou sólido e destoa dos ícones do topo");
});

test("a contagem continua disponível: rótulo acessível, aba Sobre e rodapé", () => {
  const s = icone();
  assert.ok(s.includes("aria-label={rotulo}"), "o capacete perdeu o rótulo acessível");
  assert.ok(s.includes("usuário") && s.includes("usuários"), "o rótulo não informa a contagem");
  assert.ok(s.includes('role="img"'), "o capacete deixou de ser anunciado como imagem");
  // o número continua visível nos lugares onde já existia
  assert.ok(app().includes("usando o CopaLinks"), "o cartão da aba Sobre perdeu a contagem");
  assert.ok(nav().includes("totalMotoristas"), "o distintivo do rodapé perdeu a contagem");
});

test("o capacete mantém o ganho de toque e a legibilidade sobre a foto", () => {
  const s = icone();
  assert.ok(s.includes("h-11 w-11"), "o capacete perdeu a área de 44 px");
  assert.ok(s.includes("sm:h-12 sm:w-12"), "o capacete não cresce nas telas maiores");
  assert.ok(s.includes("drop-shadow-"), "sem sombra o capacete some em foto clara");
});

test("o capacete é amarelo de segurança, como o Jonas escolheu", () => {
  const s = icone();
  // opção 3 do painel: mesmo desenho, traço no amarelo da paleta (#FFB82E)
  assert.ok(s.includes("text-ambar"), "o capacete perdeu o amarelo de segurança");
  assert.ok(!s.includes("text-gelo"), "o capacete voltou para o branco azulado");
  // o amarelo vem do token do tema, não de um hex solto no componente
  assert.ok(!/#FFB82E/i.test(s), "o hex do amarelo foi chumbado no componente em vez do token");
  const css = ler("src/app/globals.css");
  assert.ok(css.includes("--color-ambar: #FFB82E"), "o token do amarelo saiu da paleta");
});
