#!/usr/bin/env node
/**
 * Gera as artes de divulgação do Monitor Ponto CopaLinks:
 *
 *   public/images/divulgacao-status.jpg   1080×1920 — status do WhatsApp/Instagram
 *   public/images/divulgacao-card.jpg     1200×630  — prévia do link (Open Graph)
 *
 * Uso:
 *   node scripts/gerar-divulgacao.mjs
 *   node scripts/gerar-divulgacao.mjs --url=https://copa-links.vercel.app
 *
 * As artes usam a tipografia da marca (Archivo + Space Grotesk). Para o texto
 * sair com elas, converta os .woff2 do @fontsource em .ttf e instale no
 * sistema (ex.: em ~/.fonts). Sem isso o script usa a fonte padrão do sistema
 * e o resultado continua legível — as imagens já prontas ficam no repositório.
 */
import sharp from "sharp";
import QRCode from "qrcode";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/* ------------------------------------------------------------- opções */

const args = process.argv.slice(2);
const argUrl = args.find((a) => a.startsWith("--url="));
const URL_APP = (argUrl ? argUrl.split("=").slice(1).join("=") : "https://copa-links.vercel.app").replace(
  /\/$/,
  "",
);
const SEM_BARRA = URL_APP.replace(/^https?:\/\//, "");

/* ------------------------------------------------------------- cores */

const COBALTO = {
  brilho: "#0319ba",
  meio: "#021285",
  borda: "#010e5a",
  base: "#010a38",
  ouro: "#f5c518",
  gelo: "#e6edff",
  aco: "#a9b6d9",
  ciano: "#8ce7ed",
};

/* ------------------------------------------------------------- helpers */

const FONTE_TITULO = "Archivo, DejaVu Sans";
const FONTE_TEXTO = "Space Grotesk, DejaVu Sans";

/** Escapa o texto para o XML do SVG. */
function esc(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Mede o texto (em px) para centralizar/alinhar com precisão. */
async function medir(texto, { fontFamily, fontSize, fontWeight = 400 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="0" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}">${esc(texto)}</text></svg>`;
  const { width } = await sharp(Buffer.from(svg)).metadata().then(async () => {
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    return sharp(buf).metadata();
  });
  return width;
}

/** Fundo cobalto (o mesmo degradê do app) como SVG. */
function fundoSvg(largura, altura) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">
  <defs>
    <radialGradient id="brilho" cx="50%" cy="38%" r="78%">
      <stop offset="0%" stop-color="${COBALTO.brilho}"/>
      <stop offset="26%" stop-color="#0216a5"/>
      <stop offset="48%" stop-color="${COBALTO.meio}"/>
      <stop offset="70%" stop-color="${COBALTO.borda}"/>
      <stop offset="100%" stop-color="${COBALTO.base}"/>
    </radialGradient>
    <linearGradient id="rodape" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#01062e" stop-opacity="0"/>
      <stop offset="100%" stop-color="#01062e" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  <rect width="${largura}" height="${altura}" fill="url(#brilho)"/>
  <rect width="${largura}" height="${altura}" fill="url(#rodape)"/>
</svg>`;
}

/** Logo em PNG (o webp não é lido pelo renderizador de SVG). */
async function logoPng() {
  const entrada = path.resolve("public/images/copalinks-logo.webp");
  return sharp(await readFile(entrada)).png().toBuffer();
}

/** QR Code em PNG (fundo branco, silêncio na borda). */
async function qrPng(tamanho) {
  return QRCode.toBuffer(URL_APP, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: tamanho,
    color: { dark: "#0b1a5e", light: "#ffffff" },
  });
}

/* ------------------------------------------------------------- status */

async function gerarStatus() {
  const L = 1080;
  const A = 1920;
  const logo = (await logoPng()).toString("base64");
  const qr = await qrPng(300);

  const linhas = [
    "Monitoramento automático a cada 5 segundos",
    "Alertas quando o seu número é chamado",
    "Fila em tempo real: sua posição na fila",
    "Previsão do tempo no Porto de Paranaguá",
    "Cálculo de frete pela foto do ticket",
    "Assistente IA e chat dos motoristas",
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L}" height="${A}">
  <defs>
    <radialGradient id="brilho" cx="50%" cy="34%" r="80%">
      <stop offset="0%" stop-color="${COBALTO.brilho}"/>
      <stop offset="26%" stop-color="#0216a5"/>
      <stop offset="48%" stop-color="${COBALTO.meio}"/>
      <stop offset="72%" stop-color="${COBALTO.borda}"/>
      <stop offset="100%" stop-color="${COBALTO.base}"/>
    </radialGradient>
    <linearGradient id="ouro" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffdc63"/>
      <stop offset="60%" stop-color="${COBALTO.ouro}"/>
      <stop offset="100%" stop-color="#d99a00"/>
    </linearGradient>
  </defs>

  <rect width="${L}" height="${A}" fill="url(#brilho)"/>

  <!-- logo -->
  <image x="230" y="120" width="620" height="293" xlink:href="data:image/png;base64,${logo}"/>

  <!-- título -->
  <text x="540" y="545" text-anchor="middle" font-family="${FONTE_TITULO}" font-weight="900" font-size="82" fill="#ffffff" letter-spacing="1">MONITOR DO PONTO</text>

  <!-- chamada -->
  <text x="540" y="622" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="500" font-size="36" fill="${COBALTO.gelo}">Mais praticidade e tecnologia</text>
  <text x="540" y="670" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="500" font-size="36" fill="${COBALTO.aco}">para o dia a dia do motorista.</text>

  <!-- filete dourado -->
  <rect x="360" y="726" width="360" height="4" rx="2" fill="url(#ouro)"/>

  <!-- lista -->
  ${linhas
    .map(
      (linha, i) => `<g transform="translate(96 ${834 + i * 72})">
      <rect x="0" y="-20" width="18" height="18" rx="4" fill="${COBALTO.ouro}"/>
      <text x="40" y="0" font-family="${FONTE_TEXTO}" font-weight="500" font-size="32" fill="${COBALTO.gelo}">${esc(linha)}</text>
    </g>`,
    )
    .join("\n  ")}

  <!-- QR + chamada para instalar -->
  <g transform="translate(90 1290)">
    <rect x="-18" y="-18" width="376" height="376" rx="30" fill="#ffffff"/>
    <image x="0" y="0" width="340" height="340" xlink:href="data:image/png;base64,${qr.toString("base64")}"/>
  </g>
  <g transform="translate(500 1350)">
    <text x="0" y="0" font-family="${FONTE_TITULO}" font-weight="800" font-size="46" fill="#ffffff">Abra e instale</text>
    <text x="0" y="60" font-family="${FONTE_TITULO}" font-weight="800" font-size="46" fill="#ffffff">no celular</text>
    <text x="0" y="140" font-family="${FONTE_TEXTO}" font-weight="700" font-size="32" fill="${COBALTO.ciano}">${esc(SEM_BARRA)}</text>
    <text x="0" y="200" font-family="${FONTE_TEXTO}" font-weight="500" font-size="28" fill="${COBALTO.aco}">Aponte a câmera</text>
  </g>

  <!-- rodapé -->
  <text x="540" y="1800" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="500" font-size="26" fill="${COBALTO.aco}">Porto de Paranaguá · Copadubo</text>
  <text x="540" y="1846" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="700" font-size="26" fill="${COBALTO.ouro}" letter-spacing="2">GRATUITO PARA O MOTORISTA</text>
</svg>`;

  const saida = path.resolve("public/images/divulgacao-status.jpg");
  await sharp(Buffer.from(svg)).jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toFile(saida);
  console.log("✓ public/images/divulgacao-status.jpg (1080×1920)");
}

/* -------------------------------------------------------------- card */

async function gerarCard() {
  const L = 1200;
  const A = 630;
  const logo = (await logoPng()).toString("base64");
  const qr = await qrPng(220);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L}" height="${A}">
  <defs>
    <radialGradient id="brilho" cx="30%" cy="30%" r="90%">
      <stop offset="0%" stop-color="${COBALTO.brilho}"/>
      <stop offset="30%" stop-color="#0216a5"/>
      <stop offset="58%" stop-color="${COBALTO.meio}"/>
      <stop offset="100%" stop-color="${COBALTO.base}"/>
    </radialGradient>
    <linearGradient id="ouro" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffdc63"/>
      <stop offset="60%" stop-color="${COBALTO.ouro}"/>
      <stop offset="100%" stop-color="#d99a00"/>
    </linearGradient>
  </defs>

  <rect width="${L}" height="${A}" fill="url(#brilho)"/>

  <image x="70" y="70" width="330" height="156" xlink:href="data:image/png;base64,${logo}"/>

  <text x="70" y="360" font-family="${FONTE_TITULO}" font-weight="900" font-size="70" fill="#ffffff" letter-spacing="1">MONITOR DO PONTO</text>
  <text x="70" y="424" font-family="${FONTE_TEXTO}" font-weight="500" font-size="30" fill="${COBALTO.gelo}">Mais praticidade e tecnologia</text>
  <text x="70" y="466" font-family="${FONTE_TEXTO}" font-weight="500" font-size="30" fill="${COBALTO.aco}">para o dia a dia do motorista.</text>

  <rect x="70" y="508" width="200" height="4" rx="2" fill="url(#ouro)"/>
  <text x="70" y="566" font-family="${FONTE_TEXTO}" font-weight="700" font-size="30" fill="${COBALTO.ciano}">${esc(SEM_BARRA)}</text>

  <g transform="translate(960 205)">
    <rect x="-16" y="-16" width="252" height="252" rx="22" fill="#ffffff"/>
    <image x="0" y="0" width="220" height="220" xlink:href="data:image/png;base64,${qr.toString("base64")}"/>
  </g>
</svg>`;

  const saida = path.resolve("public/images/divulgacao-card.jpg");
  await sharp(Buffer.from(svg)).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toFile(saida);
  console.log("✓ public/images/divulgacao-card.jpg (1200×630)");
}

/* --------------------------------------------------------------- run */

const destino = path.resolve("public/images");
await mkdir(destino, { recursive: true });
await gerarStatus();
await gerarCard();
console.log(`\nEndereço usado nas artes: ${URL_APP}`);
