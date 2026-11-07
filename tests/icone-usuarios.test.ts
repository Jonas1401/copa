import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

/**
 * Ícone de usuários no topo da tela inicial (ao lado do menu ⋮).
 *
 * Pedido do Jonas: o capacete sai de cena e entra a arte que ele enviou — um
 * motorista de boné, de braços cruzados — com o número de usuários ao lado,
 * no MESMO tamanho do ícone de três pontinhos do menu superior esquerdo.
 *
 * Como rodar:
 *   ./node_modules/.bin/tsx --test tests/icone-usuarios.test.ts
 */

const ler = (p: string) => readFileSync(p, "utf8");
const icone = () => ler("src/components/inicio/IconeUsuarios.tsx");
const menu = () => ler("src/components/inicio/MenuConta.tsx");
const app = () => ler("src/components/MonitorApp.tsx");
const nav = () => ler("src/components/inicio/NavInferior.tsx");
const ARTE = "public/images/inicio/motorista-icone.png";

test("o capacete saiu: nenhum desenho vetorial próprio no lugar da arte", () => {
  const s = icone();
  assert.ok(!s.includes("<svg"), "o ícone ainda desenha um SVG (o capacete continua lá)");
  assert.ok(!s.includes('stroke="currentColor"'), "o traço do capacete voltou para o ícone");
  assert.ok(!s.includes("strokeWidth"), "o capacete voltou para o ícone");
  assert.ok(!s.includes("<path"), "o capacete voltou para o ícone");
});

test("entra a imagem enviada pelo Jonas, servida pelo next/image", () => {
  const s = icone();
  assert.ok(s.includes('from "next/image"'), "a arte não usa o next/image (sem otimização/tamanho fixo)");
  assert.ok(
    s.includes('src="/images/inicio/motorista-icone.png"'),
    "a arte enviada pelo Jonas não está no ícone",
  );
  assert.ok(s.includes("width={83}") && s.includes("height={96}"), "a arte sem largura/altura (deslocamento ao carregar)");
  assert.ok(existsSync(ARTE), `a arte não está em ${ARTE}`);
  assert.ok(statSync(ARTE).size > 1_000, "a arte ficou vazia ou corrompida");
  // PNG de verdade (assinatura do formato)
  const bytes = readFileSync(ARTE).subarray(0, 8);
  assert.equal(bytes.toString("hex"), "89504e470d0a1a0a", "a arte não é um PNG válido");
});

test("o número de usuários tem o tamanho do ícone ⋮ do menu", () => {
  const s = icone();
  const m = menu();
  // o ⋮ é desenhado em 17 px; o número segue o mesmo tamanho
  assert.ok(m.includes("size={17}"), "o menu ⋮ deixou de usar 17 px");
  assert.ok(s.includes("text-[17px]"), "o número de usuários não está no tamanho do ícone ⋮");
  // e o número é realmente desenhado, não só anunciado
  assert.ok(s.includes("{contagem}"), "o número de usuários sumiu do topo");
  assert.ok(s.includes("tabular"), "sem números tabulares a contagem fica dançando no topo");
});

test("a contagem continua viva, abreviada e com estado de carregamento", () => {
  const s = icone();
  assert.ok(s.includes("total > 99") && s.includes('"99+"'), "a contagem perdeu a abreviação usada no rodapé");
  assert.ok(s.includes('"—"'), "sem número enquanto a contagem não chega");
  assert.ok(s.includes("usuário") && s.includes("usuários"), "o rótulo não informa a contagem");
  assert.ok(app().includes("usando o CopaLinks"), "o cartão da aba Sobre perdeu a contagem");
  assert.ok(nav().includes("totalMotoristas"), "o distintivo do rodapé perdeu a contagem");
});

test("o desenho é anunciado uma vez só e mantém a área do topo", () => {
  const s = icone();
  assert.ok(s.includes('role="img"'), "o ícone deixou de ser anunciado como imagem");
  assert.ok(s.includes("aria-label={rotulo}"), "o ícone perdeu o rótulo acessível");
  assert.ok(s.includes('alt=""') && s.includes('aria-hidden="true"'), "a arte seria lida duas vezes pelo leitor de tela");
  assert.ok(s.includes("h-11") && s.includes("sm:h-12"), "o ícone perdeu a altura dos outros controles do topo");
  assert.ok(s.includes("drop-shadow-"), "sem sombra o desenho some em foto clara");
  assert.ok(s.includes("preload"), "a arte do topo ficou com carregamento preguiçoso (pisca ao abrir)");
});

test("as cores continuam na paleta Dark Navy", () => {
  const s = icone();
  assert.ok(s.includes("text-ambar"), "o número perdeu o amarelo de atenção do tema");
  assert.ok(!s.includes("text-gelo"), "o número voltou para o branco azulado");
  assert.ok(!/#FFB82E/i.test(s), "o hex do amarelo foi chumbado no componente em vez do token");
  assert.ok(!/#[0-9a-fA-F]{6}/.test(s.replace("rgba(7,26,40", "")), "cor fora da paleta no componente");
  const css = ler("src/app/globals.css");
  assert.ok(css.includes("--color-ambar: #FFB82E"), "o token do amarelo saiu da paleta");
});
