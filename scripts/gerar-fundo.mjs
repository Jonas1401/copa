#!/usr/bin/env node
/**
 * Troca a FOTO DE FUNDO do CopaLinks (início, boas-vindas, frete e contatos).
 *
 *   node scripts/gerar-fundo.mjs caminho/da/foto.jpg
 *   node scripts/gerar-fundo.mjs https://link-direto-da-foto.jpg
 *
 * Opções:
 *   --saida=public          pasta onde gravar (padrão: public)
 *   --ts=src/lib/fundo.ts   arquivo com endereço e medidas usados pelas telas ("" = não grava)
 *
 * O que o script faz:
 *   - respeita a orientação de fotos tiradas no celular (EXIF);
 *   - reduz para no máximo 1600 px no lado maior: nítida no celular e leve para carregar;
 *   - grava public/images/fundo-app.webp;
 *   - atualiza src/lib/fundo.ts com as medidas e uma versão no endereço (?v=...),
 *     para o celular não continuar mostrando a foto antiga guardada no cache.
 * As telas já colocam uma camada escura por cima da foto, para o texto ficar legível.
 */
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const LADO_MAX = 1600;
const DESTINO = "images/fundo-app.webp";
const FORMATOS = new Set(["jpeg", "png", "webp", "gif", "tiff", "avif"]);

async function baixar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  if (!r.ok) throw new Error(`Não consegui baixar a foto (HTTP ${r.status}).`);
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
  const arquivoTs = opcao("ts", "src/lib/fundo.ts");
  if (!origem) {
    console.error("Uso: node scripts/gerar-fundo.mjs <arquivo-ou-url-da-foto> [--saida=public] [--ts=src/lib/fundo.ts]");
    process.exit(1);
  }

  const bruto = /^https?:\/\//i.test(origem) ? await baixar(origem) : await readFile(origem);
  const original = await sharp(bruto).metadata();
  if (!FORMATOS.has(original.format)) {
    throw new Error(
      `Formato "${original.format}" não suportado. Use JPG, PNG ou WEBP ` +
        "(no iPhone, fotos HEIC precisam ser enviadas como JPG).",
    );
  }

  const webp = await sharp(bruto)
    .rotate() // aplica a orientação EXIF (foto de celular "deitada")
    .resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .flatten({ background: "#01101e" }) // PNG com transparência: fundo azul-marinho do app
    .webp({ quality: 80, effort: 6 })
    .toBuffer();
  const m = await sharp(webp).metadata();

  await mkdir(path.join(pasta, path.dirname(DESTINO)), { recursive: true });
  await writeFile(path.join(pasta, DESTINO), webp);

  let versao = "";
  if (arquivoTs) {
    versao = createHash("sha1").update(webp).digest("hex").slice(0, 8);
    await writeFile(
      arquivoTs,
      `// Gerado por scripts/gerar-fundo.mjs — não edite à mão.\n` +
        `// Foto de fundo das telas (início, boas-vindas, frete e contatos).\n` +
        `// Para trocar: node scripts/gerar-fundo.mjs caminho/da/foto.jpg\n` +
        `export const FUNDO = {\n` +
        `  src: "/${DESTINO}?v=${versao}",\n` +
        `  largura: ${m.width},\n` +
        `  altura: ${m.height},\n` +
        `} as const;\n`,
    );
  }

  const girada = original.orientation && original.orientation > 1 ? ` (girada pelo EXIF: ${original.orientation})` : "";
  console.log(`\nOrigem: ${original.width}x${original.height} ${original.format}${girada}`);
  console.log(`  ✓ ${DESTINO.padEnd(28)} ${m.width}x${m.height}  ${(webp.length / 1024).toFixed(1)} KB`);
  if (arquivoTs) console.log(`  ✓ ${arquivoTs} (versão ${versao})`);
  if (Math.min(m.width, m.height) < 700) {
    console.warn("⚠ A foto é pequena: pode ficar sem nitidez em telas grandes. Se tiver uma versão maior, prefira ela.");
  }
}

main().catch((e) => {
  console.error("✖", e.message);
  process.exit(1);
});
