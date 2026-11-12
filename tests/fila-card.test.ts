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

test("mais de um livro lido e nenhum ponto na tela: o cartão continua no Livro A — nunca a soma dos livros", () => {
  const doisLivros = [lida("TRUCK", "A", 5, 196), lida("TRUCK", "B", 2, 164), semLeitura("TRUCK", "M"), lida("CAVALO", "A", 55, 25), lida("CAVALO", "B", 3, 34), semLeitura("CAVALO", "M")];
  // O Livro B só é lido porque OUTRO motorista tem ponto nele: quem não tem ponto vê o Livro A, como sempre viu.
  const geral = cardDaFila(doisLivros, null);
  assert.deepEqual(geral.truck, { valor: "5", sub: "último escalado A196" });
  assert.deepEqual(geral.cavalo, { valor: "55", sub: "último escalado A025" });
  assert.equal(geral.ultimoEscalado, "—");
  // Com um ponto do Livro B na tela, as faixas são só do Livro B.
  const doB = cardDaFila(doisLivros, { tipo: "CAVALO", livro: "B" });
  assert.deepEqual(doB.truck, { valor: "2", sub: "último escalado B164" });
  assert.deepEqual(doB.cavalo, { valor: "3", sub: "último escalado B034" });
  assert.equal(doB.ultimoEscalado, "B034");
});

test("arrastando de um ponto para o outro: A032 → B032 → M032, os dois quadros acompanham o livro do ponto", () => {
  const tresLivros = [
    lida("TRUCK", "A", 5, 196), lida("TRUCK", "B", 3, 164), lida("TRUCK", "M", 1, 107),
    lida("CAVALO", "A", 55, 25), lida("CAVALO", "B", 6, 20), lida("CAVALO", "M", 3, 17),
  ];
  const quadros = (livro: "A" | "B" | "M") => {
    const c = cardDaFila(tresLivros, { tipo: "CAVALO", livro });
    return [c.truck.valor, c.truck.sub, c.cavalo.valor, c.cavalo.sub, c.ultimoEscalado];
  };
  assert.deepEqual(quadros("A"), ["5", "último escalado A196", "55", "último escalado A025", "A025"]);
  assert.deepEqual(quadros("B"), ["3", "último escalado B164", "6", "último escalado B020", "B020"]);
  assert.deepEqual(quadros("M"), ["1", "último escalado M107", "3", "último escalado M017", "M017"]);
});

test("sem ponto na tela e o Livro A sem leitura: vale o primeiro livro lido, na ordem A, B, M", () => {
  const semA = [semLeitura("TRUCK", "A"), lida("TRUCK", "B", 2, 164), lida("TRUCK", "M", 1, 107), semLeitura("CAVALO", "A"), lida("CAVALO", "B", 3, 34), lida("CAVALO", "M", 4, 17)];
  assert.deepEqual(cardDaFila(semA, null).truck, { valor: "2", sub: "último escalado B164" });
  assert.deepEqual(cardDaFila(semA, null).cavalo, { valor: "3", sub: "último escalado B034" });
  // A ordem é a dos livros, não a em que as linhas chegam.
  assert.deepEqual(cardDaFila([...semA].reverse(), null).cavalo, { valor: "3", sub: "último escalado B034" });
});

test("cada livro tem a hora da sua leitura: o cartão leva a do livro do ponto que está na tela", () => {
  const h = (segundo: number) => new Date(Date.UTC(2026, 10, 12, 2, 0, segundo)).toISOString();
  const comHora = (l: LinhaFila, lidoEm: string, velha?: boolean): LinhaFila => ({ ...l, lidoEm, ...(velha ? { velha } : {}) });
  // O Livro A foi lido aos 40 s; o Livro B, aos 5 s — e a leitura dele já passou da validade; o Livro M nunca veio.
  const fila = [
    comHora(lida("TRUCK", "A", 5, 196), h(40)), comHora(lida("TRUCK", "B", 3, 164), h(5), true), semLeitura("TRUCK", "M"),
    comHora(lida("CAVALO", "A", 55, 25), h(40)), comHora(lida("CAVALO", "B", 6, 20), h(5), true), semLeitura("CAVALO", "M"),
  ];
  const doA = cardDaFila(fila, { tipo: "CAVALO", livro: "A" });
  assert.deepEqual([doA.lidoEm, doA.velha], [h(40), false]);
  // No ponto do Livro B a hora é a do Livro B — e a leitura velha dele não passa por nova por causa do Livro A.
  const doB = cardDaFila(fila, { tipo: "CAVALO", livro: "B" });
  assert.deepEqual([doB.lidoEm, doB.velha], [h(5), true]);
  assert.deepEqual(doB.cavalo, { valor: "6", sub: "último escalado B020" }, "os últimos números lidos continuam na tela");
  // Livro sem leitura: não há hora (a tela usa a geral) nem marca de velha.
  const doM = cardDaFila(fila, { tipo: "CAVALO", livro: "M" });
  assert.deepEqual([doM.lidoEm, doM.velha], [null, false]);
  // Sem ponto na tela, a hora é a do Livro A — o livro que o cartão mostra.
  const geral = cardDaFila(fila, null);
  assert.deepEqual([geral.lidoEm, geral.velha], [h(40), false]);

  // Um quadro só do livro com a marca já basta; e, se as horas dos dois quadros diferirem, vale a mais antiga.
  const umSo = fila.map((l) => (l.livro === "A" && l.tipo === "TRUCK" ? { ...l, lidoEm: h(12), velha: true } : l));
  const misto = cardDaFila(umSo, { tipo: "CAVALO", livro: "A" });
  assert.deepEqual([misto.lidoEm, misto.velha], [h(12), true]);
  assert.equal(cardDaFila([...umSo].reverse(), { tipo: "CAVALO", livro: "A" }).lidoEm, h(12), "não depende da ordem em que as linhas chegam");
  // A marca de OUTRO livro nunca vaza para o que está na tela.
  assert.equal(cardDaFila(umSo, { tipo: "CAVALO", livro: "M" }).velha, false);

  // Quadro “sem leitura” não empresta hora nem marca, mesmo que venham junto por engano.
  const semLeituraComHora = fila.map((l) => (l.livro === "M" ? { ...l, lidoEm: h(1), velha: true } : l));
  const doMcomHora = cardDaFila(semLeituraComHora, { tipo: "CAVALO", livro: "M" });
  assert.deepEqual([doMcomHora.lidoEm, doMcomHora.velha], [null, false]);

  // Fila guardada antes de a hora vir por quadro (ou a do quadro antigo): sem hora, sem marca — a tela usa a geral.
  const antiga = cardDaFila(SO_LIVRO_A, { tipo: "CAVALO", livro: "A" });
  assert.deepEqual([antiga.lidoEm, antiga.velha], [null, false]);
});
