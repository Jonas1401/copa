#!/usr/bin/env node
/**
 * Gera TODAS as versões da logo do CopaLinks a partir da arte original com
 * FUNDO PRETO — o fundo vira transparente.
 *
 *   node scripts/gerar-logo.mjs caminho/da/logo.png
 *   node scripts/gerar-logo.mjs https://raw.githubusercontent.com/<usuario>/<repo>/main/logo.png
 *
 * Opções:
 *   --saida=public           pasta onde gravar (padrão: public)
 *   --ts=src/lib/logo.ts     arquivo com as medidas usadas pelas telas ("" = não grava)
 *
 * Arquivos gerados (os mesmos nomes que o app já usa — nada fica quebrado):
 *   images/copalinks-logo.webp e .png            cabeçalho e boas-vindas (transparente)
 *   icons/copalinks-{24,32,48,96,128,144,192,384,512}.png  favicon, app instalado, notificação
 *   icons/copalinks-maskable-{192,512}.png       Android (logo dentro da área segura)
 *   icons/copalinks-apple-180.png                iPhone
 *   images/compartilhar.jpg                      prévia no WhatsApp/redes (1200x630)
 *
 * Como o fundo sai sem deixar borda escura: cada pixel ganha transparência de
 * acordo com o próprio brilho e a cor é "desmisturada" do preto. O contorno
 * suave (anti-aliasing) continua suave sobre qualquer fundo escuro. Detalhes
 * pretos DENTRO do desenho também ficam transparentes — a logo (branca e azul)
 * é feita para fundos escuros, como o do app.
 *
 * Ícones de tela inicial precisam de fundo sólido: o iPhone pinta a parte
 * transparente de preto e o Android de branco (a parte branca da logo
 * sumiria). Neles a logo vai sobre o azul-marinho do tema do app.
 */
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Mesmo azul-marinho do theme_color/background_color do manifest. */
export const FUNDO_APP = "#01101e";

/* ------------------------------------------------------ 1. tirar o fundo */

/** Remove o fundo preto. Devolve os pixels RGBA crus + largura/altura. */
export async function tirarFundoPreto(entrada) {
  const { data, info } = await sharp(entrada)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const brilho = (i) => Math.max(data[i], data[i + 1], data[i + 2]);

  // Mede o "preto" do fundo na moldura da imagem (tolera ruído de JPEG).
  const margem = Math.max(2, Math.round(Math.min(W, H) * 0.02));
  const amostras = [];
  let jaTransparentes = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dentro = x >= margem && x < W - margem && y >= margem && y < H - margem;
      if (dentro) {
        x = W - margem - 1; // pula o miolo da linha
        continue;
      }
      const i = (y * W + x) * 4;
      if (data[i + 3] < 16) jaTransparentes++;
      amostras.push(brilho(i));
    }
  }

  if (jaTransparentes / amostras.length > 0.9) {
    console.log("• A imagem já tem fundo transparente — usada como está.");
    return { data, width: W, height: H, fundo: 0 };
  }

  amostras.sort((a, b) => a - b);
  const mediana = amostras[Math.floor(amostras.length / 2)] ?? 0;
  if (mediana > 80) {
    // Num fundo branco, as partes brancas da logo (ex.: "COPA") têm a mesma cor
    // do fundo: não há como separar sem estragar as letras.
    throw new Error(
      `A logo não tem fundo preto nem transparente (brilho do fundo ${mediana}/255). ` +
        "Use a versão com fundo preto ou um PNG com fundo transparente.",
    );
  }
  const fundo = amostras[Math.floor(amostras.length * 0.95)] ?? 0;
  const piso = Math.min(80, fundo + 12); // até aqui é fundo
  const GANHO = 1.18; // branco e azul da logo ficam 100% opacos

  const out = Buffer.alloc(W * H * 4); // começa tudo transparente
  for (let i = 0; i < data.length; i += 4) {
    const v = brilho(i);
    if (v <= piso || data[i + 3] === 0) continue;
    const a = Math.min(1, (GANHO * (v - piso)) / (255 - piso));
    out[i] = Math.min(255, Math.round(data[i] / a));
    out[i + 1] = Math.min(255, Math.round(data[i + 1] / a));
    out[i + 2] = Math.min(255, Math.round(data[i + 2] / a));
    out[i + 3] = Math.round(a * data[i + 3]);
  }
  return { data: out, width: W, height: H, fundo };
}

/** Retângulo com o desenho (ignora pontinhos soltos), com uma folga pequena. */
export function areaUtil({ data, width: W, height: H }, limiar = 24) {
  const col = new Uint32Array(W);
  const lin = new Uint32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > limiar) {
        col[x]++;
        lin[y]++;
      }
    }
  }
  const minimo = 2;
  let x0 = col.findIndex((n) => n >= minimo);
  let y0 = lin.findIndex((n) => n >= minimo);
  if (x0 < 0 || y0 < 0) throw new Error("Não sobrou nada da imagem depois de tirar o fundo.");
  let x1 = W - 1;
  while (x1 > x0 && col[x1] < minimo) x1--;
  let y1 = H - 1;
  while (y1 > y0 && lin[y1] < minimo) y1--;
  const folga = Math.round((x1 - x0 + 1) * 0.015);
  x0 = Math.max(0, x0 - folga);
  y0 = Math.max(0, y0 - folga);
  x1 = Math.min(W - 1, x1 + folga);
  y1 = Math.min(H - 1, y1 + folga);
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/* -------------------------------------------------- 2. peças derivadas */

const fundoSvg = (w, h) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs><radialGradient id="g" cx="50%" cy="42%" r="72%">` +
      `<stop offset="0" stop-color="#0c2b5e"/><stop offset="1" stop-color="${FUNDO_APP}"/>` +
      `</radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );

async function logoCentralizada(logoPng, W, H, caixaW, caixaH) {
  const logo = await sharp(logoPng)
    .resize({ width: caixaW, height: caixaH, fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const m = await sharp(logo).metadata();
  return sharp(fundoSvg(W, H)).composite([
    { input: logo, left: Math.round((W - m.width) / 2), top: Math.round((H - m.height) / 2) },
  ]);
}

/** Ícone quadrado: logo sobre o azul-marinho do app (cantos arredondados opcionais). */
async function icone(logoPng, S, { ocupa, raio = 0 }) {
  const lado = Math.round(S * ocupa);
  let img = await (await logoCentralizada(logoPng, S, S, lado, lado)).png().toBuffer();
  if (raio > 0) {
    const r = Math.round(S * raio);
    const mascara = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">` +
        `<rect width="${S}" height="${S}" rx="${r}" ry="${r}"/></svg>`,
    );
    img = await sharp(img).composite([{ input: mascara, blend: "dest-in" }]).png().toBuffer();
  }
  return sharp(img).png({ compressionLevel: 9 }).toBuffer();
}

async function baixar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Não consegui baixar a logo (HTTP ${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

/* ------------------------------------------------------------- 3. main */

async function main() {
  const args = process.argv.slice(2);
  const origem = args.find((a) => !a.startsWith("--"));
  const opcao = (nome, padrao) => {
    const a = args.find((x) => x.startsWith(`--${nome}=`));
    return a === undefined ? padrao : a.slice(nome.length + 3);
  };
  const pasta = opcao("saida", "public");
  const arquivoTs = opcao("ts", "src/lib/logo.ts");
  if (!origem) {
    console.error("Uso: node scripts/gerar-logo.mjs <arquivo-ou-url-da-logo> [--saida=public] [--ts=src/lib/logo.ts]");
    process.exit(1);
  }

  const bruto = /^https?:\/\//i.test(origem) ? await baixar(origem) : await readFile(origem);
  const original = await sharp(bruto).metadata();
  const semFundo = await tirarFundoPreto(bruto);
  const area = areaUtil(semFundo);
  const logoPng = await sharp(semFundo.data, {
    raw: { width: semFundo.width, height: semFundo.height, channels: 4 },
  })
    .extract(area)
    .png()
    .toBuffer();

  await mkdir(path.join(pasta, "images"), { recursive: true });
  await mkdir(path.join(pasta, "icons"), { recursive: true });
  const gerados = [];
  const grava = async (rel, buf) => {
    await writeFile(path.join(pasta, rel), buf);
    const m = await sharp(buf).metadata();
    gerados.push(`${rel.padEnd(36)} ${String(m.width).padStart(4)}x${String(m.height).padEnd(4)} ${(buf.length / 1024).toFixed(1)} KB`);
  };

  // Logo das telas (cabeçalho e boas-vindas): transparente.
  const tela = sharp(logoPng).resize({ width: Math.min(900, area.width), kernel: "lanczos3" });
  const webp = await tela.clone().webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
  const png = await tela.clone().png({ compressionLevel: 9 }).toBuffer();
  const medidas = await sharp(webp).metadata();
  await grava("images/copalinks-logo.webp", webp);
  await grava("images/copalinks-logo.png", png);

  // Ícones do app instalado, favicon e notificação.
  for (const S of [24, 32, 48, 96, 128, 144, 192, 384, 512]) {
    const pequeno = S <= 48;
    await grava(`icons/copalinks-${S}.png`, await icone(logoPng, S, { ocupa: pequeno ? 0.94 : 0.84, raio: pequeno ? 0.16 : 0.2 }));
  }
  // Maskable: o Android recorta em círculo/squircle — logo dentro dos 80% centrais.
  for (const S of [192, 512]) {
    await grava(`icons/copalinks-maskable-${S}.png`, await icone(logoPng, S, { ocupa: 0.7 }));
  }
  // iPhone arredonda sozinho: fundo cheio, sem transparência.
  await grava("icons/copalinks-apple-180.png", await icone(logoPng, 180, { ocupa: 0.82 }));

  // Prévia de compartilhamento (WhatsApp, Facebook...).
  const og = await (await logoCentralizada(logoPng, 1200, 630, 880, 440)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  await grava("images/compartilhar.jpg", og);

  if (arquivoTs) {
    const versao = createHash("sha1").update(webp).digest("hex").slice(0, 8);
    await writeFile(
      arquivoTs,
      `// Gerado por scripts/gerar-logo.mjs — não edite à mão.\n` +
        `// Para trocar a logo, rode o script de novo: as telas pegam as medidas daqui.\n` +
        `export const LOGO = {\n` +
        `  src: "/images/copalinks-logo.webp?v=${versao}",\n` +
        `  largura: ${medidas.width},\n` +
        `  altura: ${medidas.height},\n` +
        `} as const;\n`,
    );
    gerados.push(`${arquivoTs} (medidas ${medidas.width}x${medidas.height}, versão ${versao})`);
  }

  console.log(`\nOrigem: ${original.width}x${original.height} ${original.format} · fundo medido: ${semFundo.fundo}/255 · desenho: ${area.width}x${area.height}`);
  console.log(gerados.map((g) => `  ✓ ${g}`).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error("✖", e.message);
    process.exit(1);
  });
}
