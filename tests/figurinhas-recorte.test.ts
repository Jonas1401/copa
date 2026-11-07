import assert from "node:assert/strict";
import { test } from "node:test";
import { contarPixels, PADRAO, segmentarFolha } from "../scripts/lib/segmentar-folha.mjs";

/* ------------------------------------------------------------------------- *
 * Testes da separação da folha de figurinhas, com imagens sintéticas.
 * Protegem os três defeitos que o corte por caixa reta causava:
 *   - pontas que ultrapassam a caixa eram cortadas (estrela do "Top!");
 *   - desenho vizinho entrava no recorte (boné no caminhão);
 *   - fiapo de contorno ficava no lado errado do corte.
 * ------------------------------------------------------------------------- */

type RGBA = { dados: Uint8Array; largura: number; altura: number };

/** Cria uma folha preta (fundo) e pinta retângulos opacos por cima. */
function folha(
  largura: number,
  altura: number,
  blocos: { x0: number; y0: number; x1: number; y1: number; cor?: [number, number, number] }[],
): RGBA {
  const dados = new Uint8Array(largura * altura * 4);
  for (let i = 0; i < largura * altura; i += 1) dados[i * 4 + 3] = 255; // fundo preto opaco
  for (const b of blocos) {
    const [r, g, bb] = b.cor ?? [240, 240, 240];
    for (let y = b.y0; y < b.y1; y += 1) {
      for (let x = b.x0; x < b.x1; x += 1) {
        const o = (y * largura + x) * 4;
        dados[o] = r; dados[o + 1] = g; dados[o + 2] = bb; dados[o + 3] = 255;
      }
    }
  }
  return { dados, largura, altura };
}

const donoEm = (r: { dono: Int32Array }, largura: number, x: number, y: number) => r.dono[y * largura + x];

test("fundo preto sai, mas o preto dentro do desenho é preservado", () => {
  // Anel branco com miolo preto: o miolo é arte, não fundo.
  const f = folha(40, 40, [
    { x0: 10, y0: 10, x1: 30, y1: 30 },
    { x0: 15, y0: 15, x1: 25, y1: 25, cor: [0, 0, 0] },
  ]);
  const r = segmentarFolha({ ...f, figurinhas: [{ slug: "anel", caixa: [10, 10, 30, 30] }] });

  assert.equal(donoEm(r, 40, 2, 2), -1, "o fundo preto tinha de virar transparente");
  assert.equal(r.alpha[2 * 40 + 2], 0);
  assert.equal(donoEm(r, 40, 20, 20), 0, "o miolo preto faz parte do desenho");
  assert.ok(r.alpha[20 * 40 + 20] > PADRAO.alphaMinimo);
});

test("ponta que ultrapassa a caixa de referência NÃO é cortada", () => {
  // O desenho começa em y=6, mas a caixa só começa em y=14 (caso da estrela
  // do "Top!" e do dedo do "Gostei!"). A ponta inteira tem de sobreviver.
  const f = folha(40, 50, [{ x0: 12, y0: 6, x1: 28, y1: 40 }]);
  const r = segmentarFolha({ ...f, figurinhas: [{ slug: "ponta", caixa: [12, 14, 28, 40] }] });

  for (let y = 6; y < 14; y += 1) {
    assert.equal(donoEm(r, 40, 20, y), 0, `a linha ${y} da ponta foi perdida`);
  }
  const { contagem, desenho } = contarPixels(r.dono, r.alpha, 1);
  assert.equal(contagem[0], desenho, "nenhum pixel de desenho pode sumir");
  assert.equal(desenho, 16 * 34);
});

test("detalhe solto (vapor, risco de movimento) vai para a figurinha mais perto", () => {
  const f = folha(50, 60, [
    { x0: 10, y0: 25, x1: 34, y1: 50 }, // desenho principal
    { x0: 18, y0: 14, x1: 24, y1: 20 }, // vapor, fora da caixa
  ]);
  const r = segmentarFolha({ ...f, figurinhas: [{ slug: "xicara", caixa: [10, 25, 34, 50] }] });

  assert.equal(donoEm(r, 50, 21, 17), 0, "o vapor tinha de acompanhar a xícara");
  const { contagem, desenho } = contarPixels(r.dono, r.alpha, 1);
  assert.equal(contagem[0], desenho);
});

test("ruído longe de qualquer figurinha é descartado", () => {
  const f = folha(80, 60, [
    { x0: 10, y0: 30, x1: 30, y1: 50 },
    { x0: 70, y0: 4, x1: 76, y1: 10 }, // manchas longe da única caixa
  ]);
  const r = segmentarFolha({ ...f, figurinhas: [{ slug: "desenho", caixa: [10, 30, 30, 50] }] });
  assert.equal(donoEm(r, 80, 73, 7), -1, "mancha distante não pode entrar no recorte");
});

test("duas figurinhas grudadas são separadas sem perder pixel", () => {
  // Dois blocos encostados (4-conexos) formam um componente só — o caso do
  // caminhão colado no motorista e do motorista colado no "Obrigado!".
  const f = folha(50, 70, [
    { x0: 10, y0: 5, x1: 34, y1: 30, cor: [230, 60, 60] },
    { x0: 10, y0: 30, x1: 34, y1: 58, cor: [60, 60, 230] },
  ]);
  const figurinhas = [
    { slug: "cima", caixa: [10, 5, 34, 27] as [number, number, number, number] },
    { slug: "baixo", caixa: [10, 33, 34, 58] as [number, number, number, number] },
  ];
  const r = segmentarFolha({ ...f, figurinhas });

  assert.deepEqual(
    r.separadas.map((par) => [...par].sort()),
    [["baixo", "cima"]],
    "o blob compartilhado tinha de ser rachado",
  );
  assert.equal(donoEm(r, 50, 20, 10), 0);
  assert.equal(donoEm(r, 50, 20, 50), 1);

  const { contagem, desenho } = contarPixels(r.dono, r.alpha, 2);
  assert.equal(contagem[0] + contagem[1], desenho, "a separação não pode apagar desenho");
  assert.ok(contagem[0] > 500 && contagem[1] > 500, "os dois lados precisam receber desenho");
  // O corte cai na zona de contato, não no meio de uma das figurinhas.
  assert.ok(Math.abs(contagem[0] - contagem[1]) < desenho * 0.2, "o corte ficou torto");
});

test("corte por caixa reta deixaria desenho vizinho no recorte; o geodésico não", () => {
  // Bloco de cima com uma aba fina descendo para dentro da caixa de baixo.
  const f = folha(50, 70, [
    { x0: 10, y0: 5, x1: 34, y1: 30 },
    { x0: 10, y0: 30, x1: 34, y1: 58 },
  ]);
  const r = segmentarFolha({
    ...f,
    figurinhas: [
      { slug: "cima", caixa: [10, 5, 34, 27] },
      { slug: "baixo", caixa: [10, 33, 34, 58] },
    ],
  });
  // Nenhum pixel muito acima do contato pode pertencer à figurinha de baixo.
  for (let y = 5; y < 20; y += 1) {
    assert.equal(donoEm(r, 50, 20, y), 0, `pixel y=${y} vazou para a figurinha de baixo`);
  }
  for (let y = 45; y < 58; y += 1) {
    assert.equal(donoEm(r, 50, 20, y), 1, `pixel y=${y} vazou para a figurinha de cima`);
  }
});

test("sobreposição declarada no manifesto devolve os pixels ao dono certo", () => {
  const f = folha(50, 70, [
    { x0: 10, y0: 5, x1: 34, y1: 30 },
    { x0: 10, y0: 30, x1: 34, y1: 58 },
  ]);
  const semRetoque = segmentarFolha({
    ...f,
    figurinhas: [
      { slug: "cima", caixa: [10, 5, 34, 27] },
      { slug: "baixo", caixa: [10, 33, 34, 58] },
    ],
  });
  const antes = donoEm(semRetoque, 50, 20, 26);

  const comRetoque = segmentarFolha({
    ...f,
    figurinhas: [
      { slug: "cima", caixa: [10, 5, 34, 27] },
      { slug: "baixo", caixa: [10, 33, 34, 58], sobreposicao: [[18, 25, 24, 28]] },
    ],
  });
  assert.equal(antes, 0);
  assert.equal(donoEm(comRetoque, 50, 20, 26), 1, "a região declarada tinha de trocar de dono");
  assert.ok(comRetoque.sobreposicoes.some((s) => s.slug === "baixo" && s.movidos > 0));

  const { contagem, desenho } = contarPixels(comRetoque.dono, comRetoque.alpha, 2);
  assert.equal(contagem[0] + contagem[1], desenho, "o retoque só move pixels, nunca apaga");
});

test("a folha real do projeto é separada sem perder desenho", async () => {
  const { readFile } = await import("node:fs/promises");
  const sharp = (await import("sharp")).default;
  const manifesto = JSON.parse(await readFile("assets/figurinhas/copalinks-bordo.json", "utf8"));
  const { data, info } = await sharp(`assets/figurinhas/${manifesto.fonte}`)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const r = segmentarFolha({
    dados: data,
    largura: info.width,
    altura: info.height,
    figurinhas: manifesto.figurinhas,
  });
  const { contagem, desenho } = contarPixels(r.dono, r.alpha, manifesto.figurinhas.length);

  assert.equal(contagem.length, 42);
  assert.ok(contagem.every((n) => n > 5000), "toda figurinha precisa receber desenho");
  const atribuidos = contagem.reduce((a, b) => a + b, 0);
  assert.ok(desenho - atribuidos <= desenho * 0.001, "pixels de desenho foram perdidos na separação");

  // Os dois pares que se encostam na folha continuam sendo detectados.
  const pares = r.separadas.map((p) => [...p].sort().join("+")).sort();
  assert.deepEqual(pares, ["caminhao-azul-frente+motorista-joinha", "motorista-sono+obrigado"]);
});
