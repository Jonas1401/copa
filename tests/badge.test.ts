import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import sharp from "sharp";

/**
 * Badge da notificação (ícone pequeno da barra de status, ao lado do relógio).
 *
 * O Android/Chrome só desenha o badge quando o PNG é monocromático: BRANCO
 * sobre TRANSPARENTE, 72x72. Se o arquivo tiver qualquer outra cor (por ex.
 * um desenho preto com fundo transparente), o sistema não consegue aplicar a
 * máscara e mostra um quadradinho cinza no lugar do caminhão.
 *
 * Este teste trava essa regra para o problema não voltar.
 *
 * Como rodar:
 *   ./node_modules/.bin/tsx --test tests/badge.test.ts
 */

const BADGE = "public/icons/public/icons/copalinks-badge-72.png";

test("badge da notificação é branco sobre transparente, em 72x72", async () => {
  const { data, info } = await sharp(BADGE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.width, 72, "o badge precisa ter 72 px de largura");
  assert.equal(info.height, 72, "o badge precisa ter 72 px de altura");
  assert.ok(info.channels >= 4, "o badge precisa ter canal alpha");

  let opacos = 0;
  let coloridos = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a <= 200) continue;
    opacos += 1;
    // Monocromático: todo pixel visível tem de ser branco puro.
    if (r !== 255 || g !== 255 || b !== 255) coloridos += 1;
  }

  assert.equal(
    coloridos,
    0,
    "o badge tem pixels visíveis coloridos: o Android desenha um quadrado cinza no lugar dele",
  );
  // Silhueta de fato desenhada (não é uma imagem vazia).
  assert.ok(opacos > 300, `o badge quase não tem desenho (${opacos} pixels)`);
  // E espaço sobrando em volta, para o Android não cortar o desenho.
  assert.ok(opacos < 72 * 72 * 0.6, "o badge está cheio demais: falta respiro");

  const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  for (const [x, y] of [
    [0, 0],
    [71, 0],
    [0, 71],
    [71, 71],
  ]) {
    assert.equal(alpha(x, y), 0, `o canto ${x},${y} deveria ser transparente`);
  }
});

test("o Service Worker aponta para o badge monocromático", () => {
  const sw = readFileSync("public/sw.js", "utf8");
  assert.match(sw, /const BADGE\s*=\s*"\/icons\/public\/icons\/copalinks-badge-72\.png\?v=\d+"/);
  // Sem ?v= o celular pode continuar usando o arquivo antigo em cache.
  assert.match(sw, /\/icons\/public\/icons\/copalinks-badge-72\.png\?v=\d+/);
  assert.match(sw, /badge:\s*dados\.badge \|\| BADGE/);
});
