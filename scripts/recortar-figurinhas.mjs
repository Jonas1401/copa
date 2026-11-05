/**
 * Recorte automático da coleção oficial de figurinhas CopaLinks.
 *
 * Entrada : scripts/figurinhas/colecao-original.jpg (grade 6 × 7 = 42 desenhos)
 * Saídas  : public/stickers/cop alinks/<slug>.png  → 42 PNGs com alpha real
 *           public/stickers/cop alinks/catalogo.json
 *           src/lib/figurinhas-pacote.ts            → base64 que semeia o banco
 *
 * Uso: node scripts/recortar-figurinhas.mjs [caminho-da-imagem]
 *
 * Não divide a imagem em quadrados: para cada célula da grade o script
 *   - descobre a cor do fundo navy,
 *   - faz um flood fill a partir da borda (só o fundo EXTERNO vira transparente;
 *     o navy dentro de "Boa Noite!" / "Bora Rodar!" fica intacto),
 *   - remove os números de índice 01..42 e respingos de JPEG,
 *   - suaviza a borda com alpha e troca a cor dos pixels de borda pela cor
 *     opaca mais próxima (não sobra franja cinza nem resíduo do fundo),
 *   - recorta pelo contorno real, centraliza com margem uniforme e amplia com
 *     Lanczos3 mantendo a proporção original.
 */

import sharp from "sharp";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const origemPadrao = path.join(raiz, "scripts", "figurinhas", "colecao-original.jpg");
const origem = process.argv[2] ? path.resolve(process.argv[2]) : origemPadrao;
const pastaSaida = path.join(raiz, "public", "stickers", "cop alinks");
const arquivoPacote = path.join(raiz, "src", "lib", "figurinhas-pacote.ts");

/* ---------------------------------------------------------------- catálogo */
/* numero = posição na grade (linha a linha, da esquerda para a direita). */

export const COLECAO = [
  { numero: 1,  slug: "guindaste-porto",          nome: "Guindaste do porto",       categoria: "porto" },
  { numero: 2,  slug: "scania-113-azul",          nome: "Scania 113 azul",          categoria: "caminhoes" },
  { numero: 3,  slug: "motorista-positivo",       nome: "Motorista positivo",       categoria: "motoristas" },
  { numero: 4,  slug: "scania-113-branca",        nome: "Scania 113 branca",        categoria: "caminhoes" },
  { numero: 5,  slug: "empilhadeira",             nome: "Empilhadeira",             categoria: "porto" },
  { numero: 6,  slug: "navio-carga",              nome: "Navio de carga",           categoria: "porto" },
  { numero: 7,  slug: "scania-113-azul-lateral",  nome: "Scania 113 azul de lado",  categoria: "caminhoes" },
  { numero: 8,  slug: "navio-conteineres",        nome: "Navio de contêineres",     categoria: "porto" },
  { numero: 9,  slug: "motorista-confiante",      nome: "Motorista confiante",      categoria: "motoristas" },
  { numero: 10, slug: "motorista-cafe",           nome: "Motorista com café",       categoria: "motoristas" },
  { numero: 11, slug: "motorista-pensativo",      nome: "Motorista pensativo",      categoria: "motoristas" },
  { numero: 12, slug: "obrigado",                 nome: "Obrigado!",                categoria: "reacoes" },
  { numero: 13, slug: "motorista-comemorando",    nome: "Motorista comemorando",    categoria: "motoristas" },
  { numero: 14, slug: "motorista-feliz",          nome: "Motorista feliz",          categoria: "motoristas" },
  { numero: 15, slug: "motorista-apontando",      nome: "Motorista apontando",      categoria: "motoristas" },
  { numero: 16, slug: "bom-dia",                  nome: "Bom dia!",                 categoria: "saudacoes" },
  { numero: 17, slug: "boa-tarde",                nome: "Boa tarde!",               categoria: "saudacoes" },
  { numero: 18, slug: "boa-noite",                nome: "Boa noite!",               categoria: "saudacoes" },
  { numero: 19, slug: "show",                     nome: "Show!",                    categoria: "reacoes" },
  { numero: 20, slug: "valeu",                    nome: "Valeu!",                   categoria: "reacoes" },
  { numero: 21, slug: "beleza",                   nome: "Beleza!",                  categoria: "reacoes" },
  { numero: 22, slug: "gostei",                   nome: "Gostei!",                  categoria: "reacoes" },
  { numero: 23, slug: "amem",                     nome: "Amém!",                    categoria: "reacoes" },
  { numero: 24, slug: "top",                      nome: "Top!",                     categoria: "reacoes" },
  { numero: 25, slug: "deus-abencoe",             nome: "Deus abençoe!",            categoria: "reacoes" },
  { numero: 26, slug: "kkk",                      nome: "KKK!",                     categoria: "reacoes" },
  { numero: 27, slug: "parabens",                 nome: "Parabéns!",                categoria: "reacoes" },
  { numero: 28, slug: "nao-gostei",               nome: "Não gostei!",              categoria: "reacoes" },
  { numero: 29, slug: "pode-deixar",              nome: "Pode deixar!",             categoria: "reacoes" },
  { numero: 30, slug: "estou-chegando",           nome: "Estou chegando!",          categoria: "trabalho" },
  { numero: 31, slug: "ja-estou-indo",            nome: "Já estou indo!",           categoria: "trabalho" },
  { numero: 32, slug: "ate-mais",                 nome: "Até mais!",                categoria: "saudacoes" },
  { numero: 33, slug: "abastecendo",              nome: "Hora de abastecer",        categoria: "trabalho" },
  { numero: 34, slug: "engrenagem",               nome: "Engrenagem",               categoria: "trabalho" },
  { numero: 35, slug: "ferramentas",              nome: "Ferramentas",              categoria: "trabalho" },
  { numero: 36, slug: "cafe",                     nome: "Café quentinho",           categoria: "cafe" },
  { numero: 37, slug: "boa-noite-pessoal",        nome: "Boa noite, pessoal!",      categoria: "saudacoes" },
  { numero: 38, slug: "partiu-trabalho",          nome: "Partiu trabalho!",         categoria: "trabalho" },
  { numero: 39, slug: "hora-descansar",           nome: "Hora de descansar",        categoria: "trabalho" },
  { numero: 40, slug: "almoco",                   nome: "Hora do almoço",           categoria: "cafe" },
  { numero: 41, slug: "bora-rodar",               nome: "Bora rodar!",              categoria: "trabalho" },
  { numero: 42, slug: "cafe-e-frutas",            nome: "Café com frutas",          categoria: "cafe" },
];

/* Parâmetros do recorte (calibrados na imagem oficial 1020 × 1050). */
const COLUNAS = 6;
const LINHAS = 7;
// Distância RGB máxima para o fundo ser percorrido pelo flood fill. Mantido
// baixo de propósito: o azul-marinho da camisa do motorista e dos cenários
// noturnos fica DO LADO DE DENTRO e nunca é confundido com o fundo navy.
const LIMIAR_FUNDO = 38;
const LIMIAR_ALPHA = 18;   // alpha abaixo disso fora da figurinha = transparente
const MIN_AREA = 10;       // respingos de JPEG com menos pixels somem
const MARGEM = 8;          // margem transparente uniforme (na escala original)
const LADO_MAXIMO = 384;   // PNG final: até 384 px no maior lado, sem deformar

/* ------------------------------------------------------------- utilidades */

function mediana(valores) {
  valores.sort((a, b) => a - b);
  return valores[Math.floor(valores.length / 2)];
}

function corDoFundo(dados, largura, altura, canais) {
  const r = [], g = [], b = [];
  const amostrar = (x, y) => {
    const i = (y * largura + x) * canais;
    r.push(dados[i]); g.push(dados[i + 1]); b.push(dados[i + 2]);
  };
  for (let x = 0; x < largura; x += 3) { amostrar(x, 0); amostrar(x, altura - 1); }
  for (let y = 0; y < altura; y += 3) { amostrar(0, y); amostrar(largura - 1, y); }
  return [mediana(r), mediana(g), mediana(b)];
}

/** Rotula componentes conectados (8 vizinhos) e devolve o rótulo de cada pixel. */
function componentes(mascara, largura, altura) {
  const rotulos = new Int32Array(mascara.length).fill(-1);
  const tamanhos = [0];
  const fila = new Int32Array(mascara.length);
  for (let inicio = 0; inicio < mascara.length; inicio += 1) {
    if (!mascara[inicio] || rotulos[inicio] !== -1) continue;
    const id = tamanhos.length;
    let conta = 0, cabeca = 0, fim = 0;
    fila[fim++] = inicio;
    rotulos[inicio] = id;
    while (cabeca < fim) {
      const i = fila[cabeca++];
      conta += 1;
      const x = i % largura, y = (i / largura) | 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= altura) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= largura || (!dx && !dy)) continue;
          const j = ny * largura + nx;
          if (mascara[j] && rotulos[j] === -1) { rotulos[j] = id; fila[fim++] = j; }
        }
      }
    }
    tamanhos.push(conta);
  }
  return { rotulos, tamanhos };
}

/** Blur gaussiano aproximado [1,2,1]/4, separável, sem depender de biblioteca. */
function suavizar(entrada, largura, altura) {
  const tmp = new Float32Array(entrada.length);
  const saida = new Float32Array(entrada.length);
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const i = y * largura + x;
      const e = x > 0 ? entrada[i - 1] : entrada[i];
      const d = x < largura - 1 ? entrada[i + 1] : entrada[i];
      tmp[i] = (e + 2 * entrada[i] + d) / 4;
    }
  }
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const i = y * largura + x;
      const c = y > 0 ? tmp[i - largura] : tmp[i];
      const b = y < altura - 1 ? tmp[i + largura] : tmp[i];
      saida[i] = (c + 2 * tmp[i] + b) / 4;
    }
  }
  return saida;
}

/** Cor opaca mais próxima de cada pixel (BFS a partir do miolo da figurinha). */
function coresVizinhas(nucleo, largura, altura) {
  const total = nucleo.length;
  const origem = new Int32Array(total).fill(-1);
  const fila = new Int32Array(total);
  let fim = 0;
  for (let i = 0; i < total; i += 1) {
    if (!nucleo[i]) continue;
    origem[i] = i;
    fila[fim++] = i;
  }
  let cabeca = 0;
  while (cabeca < fim) {
    const i = fila[cabeca++];
    const x = i % largura, y = (i / largura) | 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= altura) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= largura || (!dx && !dy)) continue;
        const j = ny * largura + nx;
        if (origem[j] !== -1 || nucleo[j]) continue;
        origem[j] = origem[i];
        fila[fim++] = j;
      }
    }
  }
  return origem;
}

/** Recorta UMA figurinha e devolve RGBA já com margem (sem redimensionar). */
function recortar(dados, larguraFonte, x0Fonte, y0Fonte, celulaL, celulaA, canais, fundo) {
  const total = celulaL * celulaA;
  const perto = new Uint8Array(total);
  for (let y = 0; y < celulaA; y += 1) {
    for (let x = 0; x < celulaL; x += 1) {
      const i = (y0Fonte + y) * larguraFonte + x0Fonte + x;
      const p = i * canais;
      const dr = dados[p] - fundo[0], dg = dados[p + 1] - fundo[1], db = dados[p + 2] - fundo[2];
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      perto[y * celulaL + x] = d < LIMIAR_FUNDO ? 1 : 0;
    }
  }

  /* Flood fill: só o fundo que encosta na borda da célula é removido. */
  const exterior = new Uint8Array(total);
  const fila = new Int32Array(total);
  let fim = 0;
  const semear = (i) => { if (perto[i] && !exterior[i]) { exterior[i] = 1; fila[fim++] = i; } };
  for (let x = 0; x < celulaL; x += 1) { semear(x); semear((celulaA - 1) * celulaL + x); }
  for (let y = 0; y < celulaA; y += 1) { semear(y * celulaL); semear(y * celulaL + celulaL - 1); }
  let cabeca = 0;
  while (cabeca < fim) {
    const i = fila[cabeca++];
    const x = i % celulaL, y = (i / celulaL) | 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= celulaA) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= celulaL || (!dx && !dy)) continue;
        semear(ny * celulaL + nx);
      }
    }
  }

  /* Silhueta opaca = tudo que não é fundo externo. */
  const opaco = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) opaco[i] = exterior[i] ? 0 : 1;
  /* Números 01..42 ficam no canto inferior esquerdo de cada célula. */
  for (let y = Math.max(0, celulaA - 24); y < celulaA; y += 1) {
    for (let x = 0; x < Math.min(26, celulaL); x += 1) opaco[y * celulaL + x] = 0;
  }
  /* Remove respingos isolados de compressão JPEG. */
  const { rotulos, tamanhos } = componentes(opaco, celulaL, celulaA);
  for (let i = 0; i < total; i += 1) {
    if (rotulos[i] > 0 && tamanhos[rotulos[i]] < MIN_AREA) opaco[i] = 0;
  }

  /* Alpha suave na borda; pixels externos escuros não viram franja. */
  const binario = new Float32Array(total);
  for (let i = 0; i < total; i += 1) binario[i] = opaco[i] ? 255 : 0;
  const borrado = suavizar(binario, celulaL, celulaA);
  const alpha = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    let a = borrado[i];
    if (!opaco[i] && a < LIMIAR_ALPHA) a = 0;
    alpha[i] = Math.max(0, Math.min(255, Math.round(a)));
  }
  for (let y = Math.max(0, celulaA - 24); y < celulaA; y += 1) {
    for (let x = 0; x < Math.min(26, celulaL); x += 1) alpha[y * celulaL + x] = 0;
  }

  /* Miolo da silhueta → cor de referência para a borda sem contaminação navy. */
  const nucleo = new Uint8Array(total);
  let temNucleo = false;
  for (let y = 1; y < celulaA - 1; y += 1) {
    for (let x = 1; x < celulaL - 1; x += 1) {
      const i = y * celulaL + x;
      let inteiro = true;
      for (let dy = -1; dy <= 1 && inteiro; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!opaco[(y + dy) * celulaL + x + dx]) { inteiro = false; break; }
        }
      }
      if (inteiro) { nucleo[i] = 1; temNucleo = true; }
    }
  }
  if (!temNucleo) nucleo.set(opaco);
  const referencia = coresVizinhas(nucleo, celulaL, celulaA);

  /* RGBA: pixels de borda usam a cor opaca mais próxima (contorno branco intacto). */
  let minX = celulaL, maxX = -1, minY = celulaA, maxY = -1;
  for (let y = 0; y < celulaA; y += 1) {
    for (let x = 0; x < celulaL; x += 1) {
      const i = y * celulaL + x;
      if (alpha[i] <= 4) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("célula sem figurinha detectada");
  minX = Math.max(0, minX - MARGEM); minY = Math.max(0, minY - MARGEM);
  maxX = Math.min(celulaL - 1, maxX + MARGEM); maxY = Math.min(celulaA - 1, maxY + MARGEM);
  const recL = maxX - minX + 1, recA = maxY - minY + 1;
  const rgba = Buffer.alloc(recL * recA * 4);
  for (let y = 0; y < recA; y += 1) {
    for (let x = 0; x < recL; x += 1) {
      const i = (minY + y) * celulaL + minX + x;
      const orig = referencia[i] >= 0 && !opaco[i] ? referencia[i] : i;
      const ox = orig % celulaL, oy = (orig / celulaL) | 0;
      const op = (y0Fonte + oy) * larguraFonte + x0Fonte + ox;
      const o = (y * recL + x) * 4;
      rgba[o] = dados[op * canais];
      rgba[o + 1] = dados[op * canais + 1];
      rgba[o + 2] = dados[op * canais + 2];
      rgba[o + 3] = alpha[i];
    }
  }
  return { rgba, largura: recL, altura: recA };
}

/* ------------------------------------------------------------------ execução */

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const entrada = await stat(origem).catch(() => null);
  if (!entrada) {
    console.error(`Imagem de origem não encontrada: ${origem}`);
    process.exit(1);
  }
  await mkdir(pastaSaida, { recursive: true });
  if (origem !== origemPadrao) await copyFile(origem, origemPadrao);

  const { data, info } = await sharp(origem).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const celulaL = Math.round(info.width / COLUNAS);
  const celulaA = Math.round(info.height / LINHAS);
  if (info.width !== celulaL * COLUNAS || info.height !== celulaA * LINHAS) {
    throw new Error(`Grade 6 × 7 esperada; imagem ${info.width} × ${info.height} não fecha células inteiras.`);
  }
  const fundo = corDoFundo(data, info.width, info.height, info.channels);
  console.log(`Origem ${info.width}×${info.height}, célula ${celulaL}×${celulaA}, fundo RGB(${fundo.join(",")})`);

  const pacote = [];
  const catalogo = [];
  for (const item of COLECAO) {
    const indice = item.numero - 1;
    const coluna = indice % COLUNAS, linha = (indice / COLUNAS) | 0;
    const recorte = recortar(data, info.width, coluna * celulaL, linha * celulaA, celulaL, celulaA, info.channels, fundo);
    const escala = LADO_MAXIMO / Math.max(recorte.largura, recorte.altura);
    const larguraFinal = Math.round(recorte.largura * escala);
    const alturaFinal = Math.round(recorte.altura * escala);
    const png = await sharp(recorte.rgba, { raw: { width: recorte.largura, height: recorte.altura, channels: 4 } })
      .resize(larguraFinal, alturaFinal, { kernel: sharp.kernel.lanczos3, fit: "fill" })
      // PNG8 com paleta + alpha por entrada: ~3× menor no celular, sem perda
      // visível (comparado com PNG truecolor) e ainda com borda suavizada.
      .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10, dither: 1 })
      .toBuffer();
    if (png.length > 512 * 1024) throw new Error(`${item.slug}: PNG passou de 512 KB`);
    const arquivo = `${item.slug}.png`;
    await writeFile(path.join(pastaSaida, arquivo), png);
    pacote.push({ slug: item.slug, nome: item.nome, categoria: item.categoria, mime: "image/png", arquivo, base64: png.toString("base64") });
    catalogo.push({ numero: item.numero, arquivo: `/stickers/${encodeURIComponent("cop alinks")}/${arquivo}`, nome: item.nome, categoria: item.categoria });
    console.log(`✓ ${String(item.numero).padStart(2, "0")} ${arquivo.padEnd(30)} ${larguraFinal}×${alturaFinal} ${(png.length / 1024).toFixed(0)} KB`);
  }

  await writeFile(
    path.join(pastaSaida, "catalogo.json"),
    `${JSON.stringify({ colecao: "CopaLinks 2026", total: catalogo.length, categorias: ["caminhoes", "porto", "motoristas", "saudacoes", "reacoes", "cafe", "trabalho"], figurinhas: catalogo }, null, 2)}\n`,
  );

  const ts = `/**
 * Coleção oficial de figurinhas CopaLinks — GERADA por scripts/recortar-figurinhas.mjs.
 * Não editar à mão: rode "npm run figurinhas:recortar" depois de trocar a arte.
 *
 * 42 PNGs transparentes recortados individualmente da imagem oficial e gravados
 * no catálogo central (tabela figurinhas_catalogo) — o mesmo pacote chega ao
 * app, PWA e Android. Os arquivos servidos ficam em public/stickers/cop alinks/.
 */

export type FigurinhaPacote = {
  slug: string;
  nome: string;
  categoria: string;
  mime: string;
  /** Nome do arquivo PNG correspondente em public/stickers/. */
  arquivo: string;
  /** PNG em base64. */
  base64: string;
};

export const PACOTE_FIGURINHAS: FigurinhaPacote[] = ${JSON.stringify(pacote, null, 2)};
`;
  await writeFile(arquivoPacote, ts);

  const totalKb = pacote.reduce((n, f) => n + Buffer.from(f.base64, "base64").length, 0) / 1024;
  const nomes = pacote.map((f) => f.nome), slugs = pacote.map((f) => f.slug);
  if (new Set(nomes).size !== nomes.length || new Set(slugs).size !== slugs.length) throw new Error("nomes ou slugs repetidos");
  if (pacote.length !== 42) throw new Error("a coleção precisa ter 42 figurinhas");
  console.log(`\n${pacote.length} figurinhas, ${totalKb.toFixed(0)} KB de PNG, 0 duplicadas.`);
}
