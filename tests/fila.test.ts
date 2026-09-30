import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codigoFila,
  parseMarkdownQuadros,
  parseQuadros,
  posicaoNaFila,
  type FilaEstado,
  type Livro,
  type Tipo,
} from "../src/lib/estado";

type Linha = { numero: number; vermelho?: boolean };
type Quadro = `${Tipo}:${Livro}`;

function quadro(livro: Livro, tipo: "TRUCK" | "CARRETA", ultimo: number, linhas: Linha[]) {
  const rows = linhas.map((linha, i) =>
    `<tr${linha.vermelho ? " bgcolor='#ff0000'" : ""}><td>${i + 1}</td><td><h3>${livro}${String(linha.numero).padStart(3, "0")}</h3></td><td>${tipo}</td></tr>`,
  );
  return `<h2>Livro ${livro} - ${tipo}</h2>Último Escalado: <b>${livro}${String(ultimo).padStart(3, "0")}</b><table>${rows.join("")}</table>`;
}

/** O site tem três livros, com dois quadros completos por livro. */
function quadrosCompletos(trocas: Partial<Record<Quadro, string>> = {}): string[] {
  return (["A", "B", "M"] as Livro[]).map((livro) => [
    trocas[`TRUCK:${livro}`] ?? quadro(livro, "TRUCK", 1, []),
    trocas[`CAVALO:${livro}`] ?? quadro(livro, "CARRETA", 1, []),
  ].join("\n"));
}

function parseCompleto(trocas: Partial<Record<Quadro, string>>): FilaEstado {
  const fila = parseQuadros(quadrosCompletos(trocas));
  assert.ok(fila, "os seis quadros deveriam estar completos");
  return fila;
}

function markdown(livro: Livro, ultimo: number, codigos: number[]) {
  const rows = codigos.map((numero, i) => `| ${i + 1} | ${livro}${String(numero).padStart(3, "0")} |`).join("\n");
  return `## Último Escalado: ${livro}${String(ultimo).padStart(3, "0")}\n| Fila | Ponto |\n${rows}`;
}

function markdownCompleto(trocas: Partial<Record<Quadro, string>> = {}) {
  return (["A", "B", "M"] as Livro[]).map((livro) => [
    trocas[`TRUCK:${livro}`] ?? markdown(livro, 1, []),
    trocas[`CAVALO:${livro}`] ?? markdown(livro, 1, []),
  ].join("\n\n"));
}

test("A183 já foi chamado, A184 vermelho segue NA VEZ, A187 tem 1 na frente", () => {
  const fila = parseCompleto({ "CAVALO:A": quadro("A", "CARRETA", 183, [
    { numero: 184, vermelho: true }, { numero: 187 }, { numero: 188 }, { numero: 189 },
  ]) });
  const linha = fila["CAVALO:A"];
  assert.equal(linha.ultimo, 183);
  assert.deepEqual(linha.codigos, [184, 187, 188, 189]);
  assert.deepEqual(linha.vermelhos, [184]);
  assert.equal(posicaoNaFila(fila, "CAVALO", "A", 184), 0);
  assert.equal(posicaoNaFila(fila, "CAVALO", "A", 187), 1);
  assert.equal(posicaoNaFila(fila, "CAVALO", "A", 188), 2);
});

test("o ponto só sai depois de virar Último Escalado, inclusive se ainda constar no HTML", () => {
  const naVez = parseCompleto({ "CAVALO:A": quadro("A", "CARRETA", 183, [
    { numero: 184, vermelho: true }, { numero: 187 },
  ]) });
  const chamado = parseCompleto({ "CAVALO:A": quadro("A", "CARRETA", 184, [
    { numero: 184 }, { numero: 187, vermelho: true }, { numero: 188 },
  ]) });
  assert.equal(posicaoNaFila(naVez, "CAVALO", "A", 184), 0);
  assert.equal(chamado["CAVALO:A"].ultimo, 184);
  assert.equal(posicaoNaFila(chamado, "CAVALO", "A", 184), -1);
  assert.equal(posicaoNaFila(chamado, "CAVALO", "A", 187), 0);
});

test("o último escalado ainda listado acima do vermelho não conta como ponto à frente", () => {
  const fila = parseCompleto({ "CAVALO:B": quadro("B", "CARRETA", 22, [
    { numero: 22 }, { numero: 24, vermelho: true }, { numero: 25 }, { numero: 26 },
  ]) });
  assert.equal(fila["CAVALO:B"].ultimo, 22);
  assert.deepEqual(fila["CAVALO:B"].codigos, [24, 25, 26]);
  assert.deepEqual(fila["CAVALO:B"].vermelhos, [24]);
  assert.equal(fila["CAVALO:B"].ignorados, 1);
  assert.equal(posicaoNaFila(fila, "CAVALO", "B", 25), 1);
});

test("livro inteiro ausente, um bloco ausente ou HTML truncado nunca viram fila vazia", () => {
  const completos = quadrosCompletos({ "CAVALO:A": quadro("A", "CARRETA", 183, [
    { numero: 184, vermelho: true }, { numero: 187 },
  ]) });
  assert.ok(parseQuadros(completos));
  assert.equal(parseQuadros([completos[0], "", completos[2]]), null, "falha do livro B");
  assert.equal(parseQuadros([completos[0].replace(/<h2>Livro A - CARRETA[\s\S]*$/, ""), completos[1], completos[2]]), null, "faltou CARRETA A");
  assert.equal(parseQuadros([completos[0].replace("</table>", ""), completos[1], completos[2]]), null, "tabela cortada com HTTP 200");
  assert.equal(parseQuadros([completos[0].replace("Último Escalado:", "Último indefinido:"), completos[1], completos[2]]), null, "sem confirmação do último escalado");
  assert.ok(parseQuadros(quadrosCompletos()), "tabela realmente vazia, mas completa, é válida");
});

test("a leitura de reserva sem cores também exige os seis blocos completos", () => {
  const completos = markdownCompleto({
    "CAVALO:A": markdown("A", 183, [184, 187, 188]),
    "CAVALO:B": markdown("B", 22, [22, 24, 25]),
  });
  const fila = parseMarkdownQuadros(completos);
  assert.ok(fila);
  assert.equal(posicaoNaFila(fila, "CAVALO", "A", 184), 0);
  assert.equal(posicaoNaFila(fila, "CAVALO", "A", 187), 1);
  assert.deepEqual(fila["CAVALO:B"].codigos, [24, 25]);
  assert.equal(fila["CAVALO:B"].ignorados, 1);
  assert.equal(parseMarkdownQuadros([completos[0], "", completos[2]]), null);
  assert.equal(parseMarkdownQuadros([completos[0], markdown("B", 22, [24, 25]), completos[2]]), null);
});

test("formato do último escalado mantém três dígitos", () => {
  assert.equal(codigoFila("A", 183), "A183");
  assert.equal(codigoFila("B", 22), "B022");
  assert.equal(codigoFila("M", 69), "M069");
});
