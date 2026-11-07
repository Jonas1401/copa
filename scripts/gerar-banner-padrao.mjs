#!/usr/bin/env node
/**
 * Troca a IMAGEM PADRÃO do topo da tela inicial do CopaLinks — o mesmo lugar
 * onde o motorista manda a foto que ele quiser (ver "Personalizar imagem").
 *
 *   node scripts/gerar-banner-padrao.mjs caminho/da/arte.png
 *   node scripts/gerar-banner-padrao.mjs https://link-direto-da-arte.png
 *
 * Opções:
 *   --saida=public                 pasta onde gravar (padrão: public)
 *   --ts=src/lib/banner-padrao.ts  arquivo com endereço e medidas ("" = não grava)
 *   --margem=6                     px (ou "1.2%") cortados de cada lado antes do
 *                                  ajuste — para tirar a moldura fina da arte
 *
 * O que o script faz:
 *   - respeita a orientação de fotos tiradas no celular (EXIF);
 *   - recorta no centro (sem deformar) para o MESMO formato do banner que o
 *     servidor gera para as fotos dos motoristas: 1536×1024 (3:2);
 *   - grava public/images/inicio/banner-padrao.webp;
 *   - atualiza src/lib/banner-padrao.ts com as medidas e uma versão no
 *     endereço (?v=...), para o celular não continuar mostrando a arte antiga
 *     guardada no cache.
 *
 * O padrão e as fotos personalizadas passam a ter exatamente a mesma moldura
 * (1536×1024), então nada é deformado nem sobra faixa azul sob a imagem: o
 * cartão do número começa sempre nos últimos 5% da altura.
 */
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/** Mesmo formato de `paraBanner` (src/lib/banner.ts) — é a moldura do topo. */
const LARGURA = 1536;
const ALTURA = 1024;
const DESTINO = "images/inicio/banner-padrao.webp";
const FORMATOS = new Set(["jpeg", "png", "webp", "gif", "tiff", "avif"]);

async function baixar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  if (!r.ok) throw new Error(`Não consegui baixar a imagem (HTTP ${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const args = process.argv.slice(2);
  const origem = args.find((a) => !a.startsWith("--"));
  const opcao = (nome, padrao) => {
    const a = args.find((x) => x.startsWith(`--${nome}=`));
    return a === undefined ? padrao : a.slice(nome.length + 3);
  };
  const pasta = opcao("saida", "public");
  const arquivoTs = opcao("ts", "src/lib/banner-padrao.ts");
  const margem = opcao("margem", "6");

  const bruto = /^https?:\/\//i.test(origem) ? await baixar(origem) : await readFile(origem);
  const original = await sharp(bruto).metadata();
  if (!FORMATOS.has(original.format)) {
    throw new Error(
      `Formato "${original.format}" não suportado. Use JPG, PNG ou WEBP ` +
        "(no iPhone, fotos HEIC precisam ser enviadas como JPG).",
    );
  }

  // Moldura fina da arte (borda de 1-2% em volta): sai antes do ajuste para a
  // faixa não aparecer esticada nas laterais do banner.
  let margemPx = 0;
  if (margem.endsWith("%")) {
    const pct = Number.parseFloat(margem);
    if (Number.isFinite(pct) && pct > 0) {
      margemPx = Math.round((Math.min(original.width, original.height) * pct) / 100);
    }
  } else {
    const px = Number.parseInt(margem, 10);
    if (Number.isFinite(px) && px > 0) margemPx = px;
  }
  let entrada = sharp(bruto).rotate();
  if (margemPx > 0) {
    const largura = original.width - margemPx * 2;
    const altura = original.height - margemPx * 2;
    if (largura > 64 && altura > 64) entrada = entrada.extract({ left: margemPx, top: margemPx, width: largura, height: altura });
    else console.warn("⚠ Margem grande demais para esta arte — seguindo sem cortar a moldura.");
  }

  const webp = await entrada
    .resize({ width: LARGURA, height: ALTURA, fit: "cover", position: "centre", kernel: "lanczos3" })
    .flatten({ background: "#000D16" }) // PNG com transparência: fundo Dark Navy do app
    .sharpen({ sigma: 0.6 }) // arte vetorial reduzida/ampliada não fica mole
    .webp({ quality: 86, effort: 6 })
    .toBuffer();
  const m = await sharp(webp).metadata();

  await mkdir(path.join(pasta, path.dirname(DESTINO)), { recursive: true });
  await writeFile(path.join(pasta, DESTINO), webp);

  let versao = "";
  if (arquivoTs) {
    versao = createHash("sha1").update(webp).digest("hex").slice(0, 8);
    await writeFile(
      arquivoTs,
      `// Gerado por scripts/gerar-banner-padrao.mjs — não edite à mão.\n` +
        `// Imagem PADRÃO do topo da tela inicial: é ela que aparece enquanto o\n` +
        `// motorista não manda a foto dele (o mesmo lugar do "Personalizar imagem").\n` +
        `// Mesma moldura 1536×1024 das fotos personalizadas — nada é deformado.\n` +
        `// Para trocar: node scripts/gerar-banner-padrao.mjs caminho/da/arte.png\n` +
        `export const BANNER_PADRAO = {\n` +
        `  src: "/${DESTINO}?v=${versao}",\n` +
        `  largura: ${m.width},\n` +
        `  altura: ${m.height},\n` +
        `} as const;\n`,
    );
  }

  const girada = original.orientation && original.orientation > 1 ? ` (girada pelo EXIF: ${original.orientation})` : "";
  console.log(`\nOrigem: ${original.width}x${original.height} ${original.format}${girada}`);
  console.log(`  ✓ ${DESTINO.padEnd(34)} ${m.width}x${m.height}  ${(webp.length / 1024).toFixed(1)} KB`);
  if (arquivoTs) console.log(`  ✓ ${arquivoTs} (versão ${versao})`);
  if (original.width < LARGURA) {
    console.warn(
      `⚠ A arte tem ${original.width} px de largura e foi ampliada para ${LARGURA} px. ` +
        "Em desenho de traço limpo não aparece; se tiver uma versão maior, prefira ela.",
    );
  }
}

main().catch((e) => {
  console.error("✖", e.message);
  process.exit(1);
});
