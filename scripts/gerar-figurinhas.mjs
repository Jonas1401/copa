/**
 * Gera o pacote de figurinhas do CopaLinks a partir da folha enviada:
 *   assets/figurinhas/copalinks-bordo.png + copalinks-bordo.json
 *
 * Saídas:
 *   - public/figurinhas/png/<slug>.png  (recorte original, fundo transparente)
 *   - public/figurinhas/<slug>.webp     (versão 256×256 para o chat)
 *   - src/lib/figurinhas-pacote.ts      (base64 que semeia o catálogo central)
 *
 * Uso: node scripts/gerar-figurinhas.mjs
 *
 * A separação das figurinhas é determinística e não redesenha a arte: a lógica
 * vive em scripts/lib/segmentar-folha.mjs (fundo, componentes conexos, corte
 * geodésico dos desenhos que se encostam) e tem testes próprios em
 * tests/figurinhas-recorte.test.ts.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { contarPixels, segmentarFolha } from "./lib/segmentar-folha.mjs";

const raiz = path.resolve(import.meta.dirname, "..");
const manifestoUrl = path.join(raiz, "assets", "figurinhas", "copalinks-bordo.json");
const manifesto = JSON.parse(await readFile(manifestoUrl, "utf8"));
const fonteUrl = path.join(raiz, "assets", "figurinhas", manifesto.fonte);
const saidaPublic = path.join(raiz, "public", "figurinhas");
const saidaPng = path.join(saidaPublic, "png");
const saidaTs = path.join(raiz, "src", "lib", "figurinhas-pacote.ts");

const { data: folha, info } = await sharp(fonteUrl).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
if (W !== manifesto.tamanho[0] || H !== manifesto.tamanho[1]) {
  throw new Error(`A folha tem ${W}×${H}, mas o manifesto espera ${manifesto.tamanho.join("×")}.`);
}

const figurinhas = manifesto.figurinhas;
const { dono, alpha, separadas, sobreposicoes } = segmentarFolha({
  dados: folha,
  largura: W,
  altura: H,
  figurinhas,
});

for (const par of separadas) console.log(`✂ separadas pelo contorno: ${par.join(" + ")}`);
for (const { slug, movidos } of sobreposicoes) console.log(`↺ ${slug}: ${movidos} px de sobreposição devolvidos`);

// Nenhum pixel de desenho pode sumir no recorte.
const { contagem, desenho } = contarPixels(dono, alpha, figurinhas.length);
const atribuidos = contagem.reduce((a, b) => a + b, 0);
const perda = desenho - atribuidos;
if (perda > desenho * 0.001) {
  throw new Error(`${perda} pixels de desenho (${((perda / desenho) * 100).toFixed(2)}%) não foram atribuídos a nenhuma figurinha.`);
}
console.log(`• ${atribuidos}/${desenho} pixels de desenho atribuídos (${perda} de ruído descartado)`);

await rm(saidaPng, { recursive: true, force: true });
await mkdir(saidaPng, { recursive: true });

const slugs = new Set(figurinhas.map((f) => f.slug));
for (const arquivo of await readdir(saidaPublic)) {
  if (arquivo.endsWith(".webp") && !slugs.has(arquivo.slice(0, -5))) {
    await rm(path.join(saidaPublic, arquivo), { force: true });
  }
}

/** Recorta o retângulo que sobrou para a figurinha, com o resto transparente. */
async function recortar(indice) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (dono[i] === indice && alpha[i] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`Figurinha sem pixels: ${figurinhas[indice].slug}`);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const origem = ((minY + y) * W + (minX + x)) * 4;
      const destino = (y * w + x) * 4;
      folha.copy(px, destino, origem, origem + 4);
      const i = (minY + y) * W + (minX + x);
      px[destino + 3] = dono[i] === indice ? alpha[i] : 0;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

const pacote = [];
for (const [indice, item] of figurinhas.entries()) {
  const png = await recortar(indice);
  await writeFile(path.join(saidaPng, `${item.slug}.png`), png);
  const webp = await sharp(png)
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 86, alphaQuality: 100, effort: 4 })
    .toBuffer();
  if (webp.length > 512 * 1024) throw new Error(`${item.slug}: WebP acima de 512 KB.`);
  if (webp.length > 96 * 1024) console.warn(`⚠ ${item.slug}: ${(webp.length / 1024).toFixed(1)} KB`);
  await writeFile(path.join(saidaPublic, `${item.slug}.webp`), webp);
  pacote.push({
    slug: item.slug,
    nome: item.nome,
    categoria: item.categoria,
    mime: "image/webp",
    base64: webp.toString("base64"),
  });
  const meta = await sharp(png).metadata();
  console.log(`✓ ${item.slug} — PNG ${meta.width}×${meta.height}, WebP ${(webp.length / 1024).toFixed(1)} KB`);
}

const ts = `/**
 * Pacote de figurinhas do CopaLinks — GERADO por scripts/gerar-figurinhas.mjs.
 * Não editar à mão: altere assets/figurinhas/copalinks-bordo.json e rode o script.
 *
 * Fonte: a folha enviada (assets/figurinhas/copalinks-bordo.png), separada por
 * componentes conexos, com fundo transparente. Figurinhas WebP 256×256 gravadas
 * no catálogo central (tabela figurinhas_catalogo) para todos os motoristas.
 */

export type FigurinhaPacote = {
  slug: string;
  nome: string;
  categoria: string;
  mime: string;
  /** WebP em base64. */
  base64: string;
};

export const PACOTE_FIGURINHAS: FigurinhaPacote[] = ${JSON.stringify(pacote, null, 2)};
`;

await writeFile(saidaTs, ts);
console.log(`\nGerado ${pacote.length} figurinhas em src/lib/figurinhas-pacote.ts`);
