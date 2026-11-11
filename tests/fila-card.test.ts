import assert from "node:assert/strict";
import { test } from "node:test";
import { cardDaFila } from "../src/lib/fila-card";
import type { LinhaFila } from "../src/lib/estado";

/**
 * O card principal: “Último escalado”, “Pontos no quadro TRUCK” e “Pontos no
 * quadro CAVALO/C”, alimentados pela aba “Fila” do Portal do Motorista.
 * Dados inventados.
 */

const lida = (tipo: LinhaFila["tipo"], livro: LinhaFila["livro"], naFila: number, ultimo: number): LinhaFila => ({
  tipo,
  livro,
  naFila,
  ultimo,
  codigos: [],
  vermelhos: [],
  ignorados: 0,
  historico: [],
});
const semLeitura = (tipo: LinhaFila["tipo"], livro: LinhaFila["livro"]): LinhaFila => ({ ...lida(tipo, livro, 0, 0), semLeitura: true });

/** Como o app fica com o padrão: só o Livro A é lido na aba “Fila”. */
const SO_LIVRO_A: LinhaFila[] = [
  lida("TRUCK", "A", 5, 196),
  semLeitura("TRUCK", "B"),
  semLeitura("TRUCK", "M"),
  lida("CAVALO", "A", 55, 25),
  semLeitura("CAVALO", "B"),
  semLeitura("CAVALO", "M"),
];

test("motorista com ponto de carreta no Livro A: os números da tela do portal", () => {
  const card = cardDaFila(SO_LIVRO_A, { tipo: "CAVALO", livro: "A" });
  assert.deepEqual(card.truck, { valor: "5", sub: "último escalado A196" });
  assert.deepEqual(card.cavalo, { valor: "55", sub: "último escalado A025" });
  // “Último escalado” do topo é o do quadro do ponto dele (Carreta), com três dígitos.
  assert.equal(card.ultimoEscalado, "A025");
  assert.equal(card.linhaDoAlvo?.naFila, 55);
  // Com um ponto de Truck, o topo mostra o último escalado do Truck.
  assert.equal(cardDaFila(SO_LIVRO_A, { tipo: "TRUCK", livro: "A" }).ultimoEscalado, "A196");
});

test("sem ponto cadastrado: só o livro lido entra na conta (nada de somar B e M)", () => {
  const card = cardDaFila(SO_LIVRO_A, undefined);
  assert.deepEqual(card.truck, { valor: "5", sub: "último escalado A196" });
  assert.deepEqual(card.cavalo, { valor: "55", sub: "último escalado A025" });
  assert.equal(card.ultimoEscalado, "—");
  assert.equal(card.linhaDoAlvo, undefined);
});

test("ponto de um livro que não é lido: “—”, nunca um número velho", () => {
  const velhas = SO_LIVRO_A.map((l) => (l.semLeitura ? { ...l, naFila: 32, ultimo: 34 } : l));
  const card = cardDaFila(velhas, { tipo: "CAVALO", livro: "B" });
  assert.deepEqual(card.truck, { valor: "—", sub: "sem leitura da fila" });
  assert.deepEqual(card.cavalo, { valor: "—", sub: "sem leitura da fila" });
  assert.equal(card.ultimoEscalado, "—");
  assert.equal(card.linhaDoAlvo, undefined);
});

test("antes da primeira leitura da fila: tudo “—”", () => {
  const nada = SO_LIVRO_A.map((l) => semLeitura(l.tipo, l.livro));
  for (const alvo of [undefined, { tipo: "CAVALO" as const, livro: "A" as const }]) {
    const card = cardDaFila(nada, alvo);
    assert.equal(card.truck.valor, "—");
    assert.equal(card.cavalo.valor, "—");
    assert.equal(card.ultimoEscalado, "—");
  }
});

test("fila vazia lida de verdade é 0 (não “—”); sem último escalado a linha de baixo não inventa um", () => {
  const card = cardDaFila([lida("TRUCK", "A", 0, 0), lida("CAVALO", "A", 12, 77)], { tipo: "TRUCK", livro: "A" });
  assert.deepEqual(card.truck, { valor: "0", sub: "ponto ativo" });
  assert.deepEqual(card.cavalo, { valor: "12", sub: "último escalado A077" });
  assert.equal(card.ultimoEscalado, "—");
});

test("mais de um livro lido e nenhum ponto na tela: soma os lidos, sem “último escalado”", () => {
  const doisLivros = [lida("TRUCK", "A", 5, 196), lida("TRUCK", "B", 2, 164), semLeitura("TRUCK", "M"), lida("CAVALO", "A", 55, 25), lida("CAVALO", "B", 3, 34), semLeitura("CAVALO", "M")];
  const geral = cardDaFila(doisLivros, null);
  assert.deepEqual(geral.truck, { valor: "7", sub: "ponto ativo" });
  assert.deepEqual(geral.cavalo, { valor: "58", sub: "ponto ativo" });
  // Com um ponto do Livro B na tela, as faixas são só do Livro B.
  const doB = cardDaFila(doisLivros, { tipo: "CAVALO", livro: "B" });
  assert.deepEqual(doB.truck, { valor: "2", sub: "último escalado B164" });
  assert.deepEqual(doB.cavalo, { valor: "3", sub: "último escalado B034" });
  assert.equal(doB.ultimoEscalado, "B034");
});
