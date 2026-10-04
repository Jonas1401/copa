#!/usr/bin/env node
/**
 * Gera o badge da notificação — o ícone pequeno da barra de status, ao lado
 * do relógio — e CONFERE as regras do Android antes de gravar.
 *
 * Como o Android desenha o badge: ele **ignora as cores** do arquivo e usa o
 * PNG como máscara, pintando tudo com a cor do sistema. Por isso o arquivo
 * precisa ser:
 *
 *   - 72x72, com canal alpha;
 *   - BRANCO PURO (#ffffff) nos pixels visíveis — qualquer outra cor vira
 *     "sujeira": o caminhão preto, por exemplo, é mascarado ao contrário e
 *     aparece como um quadrado cinza;
 *   - transparente no fundo e nas bordas (o Android recorta a imagem e
 *     encosta o desenho nas laterais).
 *
 * Uso:
 *   node scripts/gerar-badge.mjs                  # usa public/icons/badge.svg
 *   node scripts/gerar-badge.mjs --saida=public   # pasta public do projeto
 *   node scripts/gerar-badge.mjs --fonte=assets/badge-mask.png
 *
 * `--fonte` serve para uma máscara vinda de fora (design/Print) que já esteja
 * branca sobre transparente. Arte colorida, com fundo opaco ou preta é
 * recusada com aviso — converter "no automático" foi o que estragou o badge
 * das notificações antes.
 *
 * Depois de gerar: se o arquivo mudou, aumente o `?v=` do BADGE em
 * `public/sw.js`. Sem isso o celular que já recebeu notificação continua
 * usando o PNG antigo que está no cache do Service Worker.
 */
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LADO = 72;

/** Regras do Android — as mesmas conferidas por tests/badge.test.ts. */
export const LIMITES = {
  /** Abaixo disso o badge quase não tem desenho (imagem vazia). */
  opacosMin: 300,
  /** Acima disso falta respiro: o Android corta o desenho. */
  opacosMax: Math.round(LADO * LADO * 0.6),
  /** Alpha acima disso conta como pixel visível. */
  alphaVisivel: 200,
  /** Canal mais claro abaixo disso = pixel escuro (desenho preto/cinza). */
  brilhoMinimo: 200,
  /** Fração de pixels escuros tolerada antes de recusar a arte. */
  proporcaoEscura: 0.05,
};

/* ------------------------------------------------- 1. carregar a máscara */

/** Renderiza o vetor (ou lê a máscara pronta) em RGBA cru, 72x72. */
async function carregarMascara(origem) {
  const bruto = origem.endsWith(".svg")
    ? await readFile(origem).then((svg) =>
        sharp(svg, { density: 384 })
          .resize(LADO, LADO, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer(),
      )
    : await readFile(origem);

  const { data, info } = await sharp(bruto).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== LADO || info.height !== LADO) {
    throw new Error(`a fonte precisa ter ${LADO}x${LADO} px (tem ${info.width}x${info.height}).`);
  }

  // Só o alpha interessa: o Android pinta a imagem de uma cor só. O RGB vira
  // branco puro para o arquivo já sair no formato que o sistema espera.
  const rgba = Buffer.alloc(data.length);
  let opacos = 0;
  let coloridos = 0;
  let escuros = 0;
  for (let i = 0; i < data.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
    rgba[i + 3] = data[i + 3];
    if (data[i + 3] <= LIMITES.alphaVisivel) continue;
    opacos += 1;
    if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) coloridos += 1;
    const maisClaro = Math.max(data[i], data[i + 1], data[i + 2]);
    if (maisClaro < LIMITES.brilhoMinimo) escuros += 1;
  }

  // 1) Máscara "cheia": quase todo o quadro é visível. É arte com fundo opaco
  //    (não dá para separar o desenho do fundo). Foi assim que o badge virou
  //    um quadrado cinza: o PNG inteiro entrava como parte visível.
  if (opacos > LIMITES.opacosMax) {
    throw new Error(
      `a fonte tem ${opacos} dos ${LADO * LADO} pixels visíveis (o limite é ${LIMITES.opacosMax}): ` +
        "isso é uma arte com FUNDO OPACO, não uma máscara. Recorte o caminhão e deixe só a silhueta branca sobre transparente.",
    );
  }

  // 2) Desenho escuro: o alpha até existe, mas vem do desenho ser escuro (arte
  //    preta/cinza). O Android pinta a máscara com a cor do sistema, então o
  //    resultado seria uma mancha no lugar do caminhão.
  if (escuros > opacos * LIMITES.proporcaoEscura) {
    throw new Error(
      `a fonte tem ${escuros} de ${opacos} pixels visíveis escuros/coloridos ` +
        `(bom é branco puro em todos): com desenho escuro o Android desenha uma mancha. ` +
        "Use public/icons/badge.svg ou deixe a silhueta branca sobre transparente.",
    );
  }

  if (coloridos > 0) {
    // Casos leves (quase-branco, bordas acinzentadas): o recorte é aproveitável
    // e as cores são descartadas mesmo — só avisa.
    console.warn(`⚠ a fonte tem ${coloridos} pixels visíveis não totalmente brancos: virarão branco puro.`);
  }
  return { rgba, opacos };
}

/* ------------------------------------------------------- 2. conferir tudo */

function conferir(rgba) {
  const alpha = (x, y) => rgba[(y * LADO + x) * 4 + 3];
  const problemas = [];

  let opacos = 0;
  let coloridos = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] <= LIMITES.alphaVisivel) continue;
    opacos += 1;
    if (rgba[i] !== 255 || rgba[i + 1] !== 255 || rgba[i + 2] !== 255) coloridos += 1;
  }

  if (coloridos > 0) problemas.push(`${coloridos} pixels visíveis não são branco puro`);
  if (opacos < LIMITES.opacosMin) problemas.push(`quase sem desenho (${opacos} pixels visíveis)`);
  if (opacos > LIMITES.opacosMax) problemas.push(`cheio demais, falta respiro (${opacos} pixels visíveis)`);
  for (const [x, y] of [[0, 0], [LADO - 1, 0], [0, LADO - 1], [LADO - 1, LADO - 1]]) {
    if (alpha(x, y) !== 0) problemas.push(`o canto ${x},${y} não está transparente`);
  }
  if (problemas.length > 0) {
    throw new Error("o badge não passaria no teste do Android:\n  - " + problemas.join("\n  - "));
  }
  return { opacos };
}

/* --------------------------------------------------------------- 3. main */

async function main() {
  const args = process.argv.slice(2);
  const opcao = (nome, padrao) => {
    const a = args.find((x) => x.startsWith(`--${nome}=`));
    return a === undefined ? padrao : a.slice(nome.length + 3);
  };
  const pasta = opcao("saida", "public");
  const fonte = opcao("fonte", "public/icons/badge.svg");
  const destino = path.join(pasta, "icons", "copalinks-badge-72.png");

  const { rgba } = await carregarMascara(fonte);
  const { opacos } = conferir(rgba);
  // RGBA 8-bit puro, igual aos outros ícones de public/icons: é o formato que
  // os leitores de notificação do Android/Chrome entendem sem surpresa.
  const png = await sharp(rgba, { raw: { width: LADO, height: LADO, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const anterior = await readFile(destino).catch(() => null);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, png);

  const mudou = anterior === null || !anterior.equals(png);
  console.log(`\nFonte:  ${fonte}`);
  console.log(`Arquivo: ${destino}  ${LADO}x${LADO} · ${opacos} pixels de desenho · ${(png.length / 1024).toFixed(1)} KB`);
  console.log("  ✓ branco puro sobre transparente, cantos vazios, com respiro nas bordas");
  if (mudou) {
    console.log("\nO arquivo MUDOU: aumente o ?v= do BADGE em public/sw.js para os celulares");
    console.log("que já receberam notificação baixarem este badge (o Service Worker fica em cache).");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error("✖", e.message);
    process.exit(1);
  });
}
