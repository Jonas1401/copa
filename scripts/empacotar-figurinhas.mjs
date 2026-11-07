/**
 * Empacota as figurinhas já geradas para download:
 *   - public/figurinhas/previa.jpg               (folha de prévia com os nomes)
 *   - public/figurinhas/LEIA-ME.txt
 *   - public/figurinhas/figurinhas-copalinks.zip (png/ + webp/ + prévia + manifesto)
 *
 * Uso: node scripts/empacotar-figurinhas.mjs
 * (rode antes: node scripts/gerar-figurinhas.mjs — ou use `npm run figurinhas`)
 *
 * Sem dependências novas: a prévia sai pelo sharp e o ZIP é montado na mão
 * (deflate do zlib + cabeçalhos do formato ZIP), o que mantém tudo determinístico.
 */

import { deflateRawSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const raiz = path.resolve(import.meta.dirname, "..");
const manifestoUrl = path.join(raiz, "assets", "figurinhas", "copalinks-bordo.json");
const manifesto = JSON.parse(await readFile(manifestoUrl, "utf8"));
const saida = path.join(raiz, "public", "figurinhas");
const figurinhas = manifesto.figurinhas;

/* ------------------------------------------------------------- prévia visual */

const COLUNAS = 7;
const CELULA = 230;
const ROTULO = 26;
const TOPO = 40;
const linhas = Math.ceil(figurinhas.length / COLUNAS);
const largura = COLUNAS * CELULA;
const altura = linhas * CELULA + TOPO;

const escapar = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let textos = "";
for (const [i, item] of figurinhas.entries()) {
  const x = (i % COLUNAS) * CELULA + 8;
  const y = Math.floor(i / COLUNAS) * CELULA + TOPO + 17;
  textos += `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="13" fill="#EAF4F7">${escapar(`${String(i + 1).padStart(2, "0")} ${item.nome}`)}</text>`;
}
const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">
  <defs>
    <pattern id="xadrez" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect width="24" height="24" fill="#1C222C"/>
      <rect width="12" height="12" fill="#262D3A"/>
      <rect x="12" y="12" width="12" height="12" fill="#262D3A"/>
    </pattern>
  </defs>
  <rect width="${largura}" height="${altura}" fill="#0D1117"/>
  <rect y="${TOPO}" width="${largura}" height="${altura - TOPO}" fill="url(#xadrez)"/>
  <text x="8" y="26" font-family="DejaVu Sans, sans-serif" font-size="16" fill="#FFD640">CopaLinks — ${figurinhas.length} figurinhas recortadas (fundo transparente)</text>
  ${textos}
</svg>`;

const camadas = [];
for (const [i, item] of figurinhas.entries()) {
  const png = await readFile(path.join(saida, "png", `${item.slug}.png`));
  const meta = await sharp(png).metadata();
  const maxW = CELULA - 18;
  const maxH = CELULA - ROTULO - 14;
  const escala = Math.min(maxW / meta.width, maxH / meta.height, 1);
  const w = Math.max(1, Math.round(meta.width * escala));
  const h = Math.max(1, Math.round(meta.height * escala));
  const reduzido = await sharp(png).resize(w, h, { fit: "fill" }).toBuffer();
  const cx = (i % COLUNAS) * CELULA;
  const cy = Math.floor(i / COLUNAS) * CELULA + TOPO;
  camadas.push({
    input: reduzido,
    left: cx + Math.round((CELULA - w) / 2),
    top: cy + ROTULO + Math.round((CELULA - ROTULO - h) / 2),
  });
}

await sharp(Buffer.from(baseSvg)).composite(camadas).jpeg({ quality: 92 }).toFile(path.join(saida, "previa.jpg"));
console.log("✓ previa.jpg");

/* ------------------------------------------------------------------ LEIA-ME */

const porCategoria = {};
for (const item of figurinhas) porCategoria[item.categoria] = (porCategoria[item.categoria] ?? 0) + 1;
const nomesCategoria = { caminhoes: "Caminhões", motoristas: "Motoristas", porto: "Porto", copalinks: "CopaLinks" };

const leia = `CopaLinks — ${figurinhas.length} figurinhas recortadas da folha Caminhões e Bordo

CONTEÚDO
  png/            recortes no tamanho original, fundo transparente (PNG)
  webp/           versões 256×256 com fundo transparente para o chat (WebP)
  previa.jpg      folha de prévia com os nomes
  manifesto.json  nomes, categorias e caixas de referência

CATEGORIAS
${Object.entries(porCategoria).map(([c, n]) => `  ${(nomesCategoria[c] ?? c).padEnd(16)}${n} figurinhas`).join("\n")}

COMO FOI FEITO
  As figurinhas foram separadas da folha enviada sem redesenhar a arte. O fundo
  preto/preto-azulado foi removido e cada desenho saiu completo — incluindo as
  pontas que ultrapassavam a área de referência (a estrela do "Top!", o dedo do
  "Gostei!") e os detalhes soltos (vapor do café, riscos de movimento).
  Os desenhos que se encostavam na folha foram divididos acompanhando o
  contorno, não por uma linha reta.

LISTA
${figurinhas.map((f, i) => `  ${String(i + 1).padStart(2, "0")}. ${f.nome}  (${f.slug})`).join("\n")}
`;
await writeFile(path.join(saida, "LEIA-ME.txt"), leia, "utf8");
console.log("✓ LEIA-ME.txt");

/* ---------------------------------------------------------------------- ZIP */

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Data fixa (07/11/2026) para o pacote ser reprodutível byte a byte.
const DOS_DATA = ((2026 - 1980) << 9) | (11 << 5) | 7;
const DOS_HORA = 0;

const arquivos = [];
for (const item of figurinhas) {
  arquivos.push({ nome: `png/${item.slug}.png`, dados: await readFile(path.join(saida, "png", `${item.slug}.png`)) });
}
for (const item of figurinhas) {
  arquivos.push({ nome: `webp/${item.slug}.webp`, dados: await readFile(path.join(saida, `${item.slug}.webp`)) });
}
arquivos.push({ nome: "previa.jpg", dados: await readFile(path.join(saida, "previa.jpg")) });
arquivos.push({ nome: "LEIA-ME.txt", dados: await readFile(path.join(saida, "LEIA-ME.txt")) });
arquivos.push({ nome: "manifesto.json", dados: await readFile(manifestoUrl) });

const locais = [];
const centrais = [];
let deslocamento = 0;
for (const { nome, dados } of arquivos) {
  const nomeBuf = Buffer.from(nome, "utf8");
  const comprimido = deflateRawSync(dados, { level: 9 });
  const usarDeflate = comprimido.length < dados.length;
  const payload = usarDeflate ? comprimido : dados;
  const metodo = usarDeflate ? 8 : 0;
  const crc = crc32(dados);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(metodo, 8);
  local.writeUInt16LE(DOS_HORA, 10);
  local.writeUInt16LE(DOS_DATA, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(dados.length, 22);
  local.writeUInt16LE(nomeBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locais.push(local, nomeBuf, payload);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(metodo, 10);
  central.writeUInt16LE(DOS_HORA, 12);
  central.writeUInt16LE(DOS_DATA, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(dados.length, 24);
  central.writeUInt16LE(nomeBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(deslocamento, 42);
  centrais.push(central, nomeBuf);

  deslocamento += local.length + nomeBuf.length + payload.length;
}

const diretorio = Buffer.concat(centrais);
const fim = Buffer.alloc(22);
fim.writeUInt32LE(0x06054b50, 0);
fim.writeUInt16LE(0, 4);
fim.writeUInt16LE(0, 6);
fim.writeUInt16LE(arquivos.length, 8);
fim.writeUInt16LE(arquivos.length, 10);
fim.writeUInt32LE(diretorio.length, 12);
fim.writeUInt32LE(deslocamento, 16);
fim.writeUInt16LE(0, 20);

const zip = Buffer.concat([...locais, diretorio, fim]);
const zipUrl = path.join(saida, "figurinhas-copalinks.zip");
await writeFile(zipUrl, zip);
console.log(`✓ figurinhas-copalinks.zip — ${arquivos.length} arquivos, ${(zip.length / 1024 / 1024).toFixed(2)} MB`);
