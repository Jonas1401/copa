/**
 * Gera o pacote inicial de figurinhas do CopaLinks:
 *   - public/figurinhas/<slug>.webp  (prévia/backup, fundo transparente)
 *   - src/lib/figurinhas-pacote.ts   (base64 que semeia o banco central)
 *
 * Uso: node scripts/gerar-figurinhas.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { FIGURINHAS_ARTE } from "./figurinhas-arte.mjs";

const raiz = path.resolve(import.meta.dirname, "..");
const saidaPublic = path.join(raiz, "public", "figurinhas");
const saidaTs = path.join(raiz, "src", "lib", "figurinhas-pacote.ts");

await mkdir(saidaPublic, { recursive: true });

const pacote = [];
for (const item of FIGURINHAS_ARTE) {
  const webp = await sharp(Buffer.from(item.svg), { density: 192 })
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82, alphaQuality: 100, effort: 6 })
    .toBuffer();
  if (webp.length > 96 * 1024) {
    console.warn(`⚠ ${item.slug}: ${(webp.length / 1024).toFixed(1)} KB (grande para figurinha)`);
  }
  await writeFile(path.join(saidaPublic, `${item.slug}.webp`), webp);
  pacote.push({
    slug: item.slug,
    nome: item.nome,
    categoria: item.categoria,
    mime: "image/webp",
    base64: webp.toString("base64"),
  });
  console.log(`✓ ${item.slug}.webp ${(webp.length / 1024).toFixed(1)} KB`);
}

const ts = `/**
 * Pacote inicial de figurinhas do CopaLinks — GERADO por scripts/gerar-figurinhas.mjs.
 * Não editar à mão: altere scripts/figurinhas-arte.mjs e rode o script novamente.
 *
 * Figurinhas WebP 256×256 com fundo transparente, gravadas no catálogo central
 * (tabela figurinhas_catalogo) na primeira abertura — todos os motoristas veem
 * exatamente as mesmas figurinhas.
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
