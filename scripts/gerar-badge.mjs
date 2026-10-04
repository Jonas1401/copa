#!/usr/bin/env node
/**
 * Gera o BADGE da notificação — o ícone pequeno da barra de status, ao lado do
 * relógio (Android/Chrome).
 *
 *   node scripts/gerar-badge.mjs                                  # usa assets/caminhao-badge-fonte.png
 *   node scripts/gerar-badge.mjs caminho/da/arte.png              # outra arte
 *   node scripts/gerar-badge.mjs https://link-direto-da-arte.png  # link direto
 *
 * Opções:
 *   --saida=public          pasta onde gravar (padrão: public)
 *
 * Regra que o Android impõe (e que este script garante):
 *   - 72x72 px;
 *   - PNG monocromático: BRANCO PURO (#ffffff) sobre TRANSPARENTE. O sistema usa
 *     a imagem como MÁSCARA e pinta com a cor dele: qualquer outra cor (por ex.
 *     um desenho preto, ou branco com fundo branco) faz o Android desenhar um
 *     quadradinho cinza no lugar do desenho;
 *   - desenho com respiro nas bordas (o Android corta o que encosta no limite).
 *
 * A arte de origem precisa estar sobre FUNDO PRETO ou TRANSPARENTE (não serve
 * fundo claro): o script mede "quanto de tinta" cada pixel tem (brilho ×
 * opacidade), recorta só o desenho, reduz para caber em 66x66 (3 px de respiro
 * em cada lado), força a silhueta para branco puro e grava o arquivo que o
 * projeto usa (o mesmo nome está em public/sw.js, tests/badge.test.ts e
 * public/icons/badge.svg):
 *
 *   public/icons/copalinks-badge-72.png
 *
 * O Service Worker aponta para o arquivo com "?v=N" para o celular não
 * reaproveitar o badge antigo do cache: ao trocar a arte, aumente esse número em
 * public/sw.js e rode `npx tsx --test tests/badge.test.ts`.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ARTE_PADRAO = "assets/caminhao-badge-fonte.png";
const DESTINO = "icons";
const NOME = "copalinks-badge-72.png";

const TAMANHO = 72; // exigência do Android/Chrome
const MARGEM = 3; // respiro nas bordas: TAMANHO - 2*MARGEM = 66 de desenho
const CAIXA = TAMANHO - 2 * MARGEM;
const FOLGA = 6; // pixels de folga ao recortar a arte original
const BRILHO_RECORTE = 0.12; // acima disso o pixel já conta como desenho
const GANHO = 1.5; // engrossa de leve a silhueta: a barra de status é minúscula

async function carregar(origem) {
  if (/^https?:\/\//.test(origem)) {
    const r = await fetch(origem, { signal: AbortSignal.timeout(30000), redirect: "follow" });
    if (!r.ok) throw new Error(`Não consegui baixar a arte (HTTP ${r.status}).`);
    return Buffer.from(await r.arrayBuffer());
  }
  return origem;
}

/** "Tinta" de cada pixel: o quanto ele está visível (brilho × opacidade). */
async function extrairTinta(entrada) {
  const { data, info } = await sharp(entrada).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tinta = new Float32Array(info.width * info.height);
  for (let p = 0, i = 0; p < tinta.length; p++, i += info.channels) {
    const brilho = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    tinta[p] = (brilho * data[i + 3]) / 255;
  }
  return { tinta, largura: info.width, altura: info.height };
}

/** Recorta só o desenho (com folga) e devolve uma máscara branca RGBA. */
function recortar({ tinta, largura, altura }) {
  let x0 = largura;
  let y0 = altura;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if (tinta[y * largura + x] <= BRILHO_RECORTE) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("A arte está vazia: não encontrei nenhum desenho nela.");

  const larguraOriginal = x1 - x0 + 1;
  const alturaOriginal = y1 - y0 + 1;
  const ocupacao = (larguraOriginal * alturaOriginal) / (largura * altura);
  if (ocupacao > 0.92) {
    throw new Error(
      "A arte parece ter FUNDO CLARO. O desenho precisa estar sobre fundo preto ou transparente, " +
        "senão o script não consegue separar o caminhão do fundo (tudo vira branco).",
    );
  }

  x0 = Math.max(0, x0 - FOLGA);
  x1 = Math.min(largura - 1, x1 + FOLGA);
  y0 = Math.max(0, y0 - FOLGA);
  y1 = Math.min(altura - 1, y1 + FOLGA);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;

  // Silhueta branca sobre transparente, com a suavidade (anti-aliasing) da arte.
  const mascara = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alfa = Math.min(1, tinta[(y + y0) * largura + (x + x0)]);
      const d = (y * w + x) * 4;
      mascara[d] = 255;
      mascara[d + 1] = 255;
      mascara[d + 2] = 255;
      mascara[d + 3] = Math.round(alfa * 255);
    }
  }
  return { mascara, w, h, recorte: `${w}x${h}+${x0}+${y0}`, original: `${largura}x${altura}` };
}

/** Reduz para 66x66 e centraliza em 72x72, tudo branco puro sobre transparente. */
async function montar(mascara, w, h) {
  const { data, info } = await sharp(mascara, { raw: { width: w, height: h, channels: 4 } })
    .resize({ width: CAIXA, height: CAIXA, fit: "inside", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = info.width * info.height;
  const desenho = Buffer.alloc(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const alfa = Math.min(1, (data[p * info.channels + 3] / 255) * GANHO);
    desenho[p * 4] = 255;
    desenho[p * 4 + 1] = 255;
    desenho[p * 4 + 2] = 255;
    desenho[p * 4 + 3] = Math.round(alfa * 255);
  }

  return sharp({ create: { width: TAMANHO, height: TAMANHO, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: desenho,
        raw: { width: info.width, height: info.height, channels: 4 },
        left: Math.round((TAMANHO - info.width) / 2),
        top: Math.round((TAMANHO - info.height) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Confere o que o Android exige antes de comemorar. */
async function conferir(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== TAMANHO || info.height !== TAMANHO) {
    throw new Error(`O badge saiu ${info.width}x${info.height}; o Android exige ${TAMANHO}x${TAMANHO}.`);
  }
  let opacos = 0;
  let coloridos = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] <= 200) continue;
    opacos++;
    if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) coloridos++;
  }
  if (coloridos) throw new Error(`O badge tem ${coloridos} pixels visíveis coloridos: o Android desenharia um quadrado cinza.`);
  if (opacos < 300) throw new Error(`O badge quase não tem desenho (${opacos} pixels).`);
  if (opacos > TAMANHO * TAMANHO * 0.6) throw new Error("O badge está cheio demais: falta respiro nas bordas.");

  const alfa = (x, y) => data[(y * info.width + x) * info.channels + 3];
  for (const [x, y] of [
    [0, 0],
    [TAMANHO - 1, 0],
    [0, TAMANHO - 1],
    [TAMANHO - 1, TAMANHO - 1],
  ]) {
    if (alfa(x, y) !== 0) throw new Error(`O canto ${x},${y} deveria ser transparente.`);
  }
  return opacos;
}

async function main() {
  const args = process.argv.slice(2);
  const origem = args.find((a) => !a.startsWith("--")) || ARTE_PADRAO;
  const pasta = (args.find((a) => a.startsWith("--saida=")) || "--saida=public").slice("--saida=".length);

  const { tinta, largura, altura } = await extrairTinta(await carregar(origem));
  const { mascara, w, h, recorte } = recortar({ tinta, largura, altura });
  const png = await montar(mascara, w, h);
  const opacos = await conferir(png);

  await mkdir(path.join(pasta, DESTINO), { recursive: true });
  await writeFile(path.join(pasta, DESTINO, NOME), png);

  console.log(`\nArte: ${origem} (${recorte} de ${largura}x${altura})`);
  console.log(`  ✓ desenho: ${w}x${h} → ${CAIXA}x${CAIXA} dentro de ${TAMANHO}x${TAMANHO}, branco sobre transparente`);
  console.log(`  ✓ silhueta: ${opacos} pixels visíveis (${((opacos / (TAMANHO * TAMANHO)) * 100).toFixed(1)}% da imagem)`);
  console.log(`  ✓ ${`${DESTINO}/${NOME}`.padEnd(34)} ${(png.length / 1024).toFixed(1)} KB`);
  console.log(
    "\nSe trocou a arte agora, aumente o ?v=N do BADGE em public/sw.js (o celular guarda o badge antigo em cache).\n" +
      "Confira: npx tsx --test tests/badge.test.ts",
  );
}

main().catch((e) => {
  console.error("✖", e.message);
  process.exit(1);
});
