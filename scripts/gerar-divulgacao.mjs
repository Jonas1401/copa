#!/usr/bin/env node
/**
 * Gera as artes de compartilhamento e divulgação do CopaLinks no tema Dark Navy:
 *
 *   public/images/compartilhar.jpg        1200×630  — imagem enviada no botão Compartilhar + Open Graph
 *   public/images/divulgacao-card.jpg     1200×630  — cartão do link com QR Code (/divulgacao e /admin)
 *   public/images/divulgacao-status.jpg   1080×1920 — status do WhatsApp/Instagram
 *
 * Uso:
 *   node scripts/gerar-divulgacao.mjs
 *   node scripts/gerar-divulgacao.mjs --url=https://copa-links.vercel.app
 *
 * O script extrai automaticamente os arquivos .woff do @fontsource (Archivo e
 * Space Grotesk) para ~/.fonts em .ttf, garantindo tipografia idêntica ao app.
 */
import sharp from "sharp";
import QRCode from "qrcode";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

/* ------------------------------------------------------------- opções */

const args = process.argv.slice(2);
const argUrl = args.find((a) => a.startsWith("--url="));
const URL_APP = (argUrl ? argUrl.split("=").slice(1).join("=") : "https://copa-links.vercel.app").replace(
  /\/$/,
  "",
);
const SEM_BARRA = URL_APP.replace(/^https?:\/\//, "");

/* --------------------------------------------- paleta oficial Dark Navy */

const TEMA = {
  fundo: "#000D16",
  cartao: "#071A28",
  painel: "#002F3B",
  borda: "#183341",
  progresso: "#062330",
  ciano: "#00B8BC",
  verde: "#00C853",
  verdeEscuro: "#003D35",
  ouro: "#FFB82E",
  azul: "#129DFF",
  gelo: "#EAF4F7",
  aco: "#8FA8AC",
  discreto: "#506A75",
};

const FONTE_TITULO = "Archivo, DejaVu Sans, sans-serif";
const FONTE_TEXTO = "Space Grotesk, DejaVu Sans, sans-serif";
/*
 * Os .ttf do @fontsource registram os pesos 800 e 900 como famílias à parte
 * (“Archivo ExtraBold” e “Archivo Black”): pedir “Archivo” com peso 900 devolve
 * o Bold (700). O cartão do celular desenhado usa as duas pelo nome, para o
 * número e o valor saírem com o peso que têm no app.
 */
const FONTE_NUMERO = "Archivo Black, Archivo, DejaVu Sans, sans-serif";
const FONTE_FORTE = "Archivo ExtraBold, Archivo, DejaVu Sans, sans-serif";

/* ---------------------------------------- fontes (@fontsource -> .ttf) */

function woffParaTtf(buf) {
  if (buf.readUInt32BE(0) !== 0x774f4646) throw new Error("Arquivo não é WOFF 1.0");
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  let entrySelector = 0;
  while ((1 << (entrySelector + 1)) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;

  const tabelas = [];
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20;
    tabelas.push({
      tag: buf.subarray(p, p + 4),
      offset: buf.readUInt32BE(p + 4),
      compLen: buf.readUInt32BE(p + 8),
      origLen: buf.readUInt32BE(p + 12),
      checksum: buf.readUInt32BE(p + 16),
    });
  }

  let cursor = 12 + numTables * 16;
  const dir = Buffer.alloc(cursor);
  dir.writeUInt32BE(flavor, 0);
  dir.writeUInt16BE(numTables, 4);
  dir.writeUInt16BE(searchRange, 6);
  dir.writeUInt16BE(entrySelector, 8);
  dir.writeUInt16BE(rangeShift, 10);

  const blocos = [dir];
  tabelas.forEach((t, i) => {
    const fatia = buf.subarray(t.offset, t.offset + t.compLen);
    const dados = t.compLen < t.origLen ? zlib.inflateSync(fatia) : fatia;
    const pad = (4 - (dados.length % 4)) % 4;
    const rec = 12 + i * 16;
    t.tag.copy(dir, rec);
    dir.writeUInt32BE(t.checksum, rec + 4);
    dir.writeUInt32BE(cursor, rec + 8);
    dir.writeUInt32BE(t.origLen, rec + 12);
    blocos.push(dados);
    if (pad) blocos.push(Buffer.alloc(pad));
    cursor += dados.length + pad;
  });

  return Buffer.concat(blocos);
}

async function garantirFontes() {
  const pastaFontes = path.join(os.homedir(), ".fonts");
  await mkdir(pastaFontes, { recursive: true });
  const lista = [
    ["archivo", "archivo-latin", [500, 700, 800, 900]],
    ["space-grotesk", "space-grotesk-latin", [400, 500, 700]],
  ];
  for (const [pacote, prefixo, pesos] of lista) {
    for (const peso of pesos) {
      const origem = path.resolve(
        `node_modules/@fontsource/${pacote}/files/${prefixo}-${peso}-normal.woff`,
      );
      const destino = path.join(pastaFontes, `${prefixo}-${peso}.ttf`);
      if (existsSync(origem) && !existsSync(destino)) {
        const woff = await readFile(origem);
        await writeFile(destino, woffParaTtf(woff));
      }
    }
  }
}

/* ------------------------------------------------------------- helpers */

function esc(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function logoBase64() {
  const entrada = path.resolve("public/images/copalinks-logo.webp");
  const png = await sharp(await readFile(entrada)).png().toBuffer();
  return png.toString("base64");
}

async function bannerBase64(largura, altura) {
  const entrada = path.resolve("public/images/Interface CopaLinks em Tema Escuro(1).png");
  const png = await sharp(await readFile(entrada))
    .resize(largura, altura, { fit: "cover", position: "center" })
    .png()
    .toBuffer();
  return png.toString("base64");
}

async function qrBase64(tamanho) {
  const buf = await QRCode.toBuffer(URL_APP, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: tamanho,
    color: { dark: TEMA.fundo, light: "#ffffff" },
  });
  return buf.toString("base64");
}

/* -------------------------------------------- ícones vetoriais (Lucide) */

const ICONES_SVG = {
  ponto: (cor) =>
    `<path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="11" r="2.3" fill="${cor}"/>`,
  alerta: (cor) =>
    `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round"/>`,
  tempo: (cor) =>
    `<path d="M12 3v2M5.6 5.6l1.4 1.4M3 12h2M18.4 5.6 17 7" stroke="${cor}" stroke-width="2" stroke-linecap="round"/><path d="M9 18h8a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.5 3.5 3.5 0 0 0 9 18Z" fill="none" stroke="${cor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`,
  frete: (cor) =>
    `<rect x="5" y="3" width="14" height="18" rx="2.5" fill="none" stroke="${cor}" stroke-width="2.1"/><line x1="8" y1="7" x2="16" y2="7" stroke="${cor}" stroke-width="2.1" stroke-linecap="round"/><circle cx="9" cy="12" r="1.1" fill="${cor}"/><circle cx="12" cy="12" r="1.1" fill="${cor}"/><circle cx="15" cy="12" r="1.1" fill="${cor}"/><circle cx="9" cy="16" r="1.1" fill="${cor}"/><line x1="12" y1="16" x2="15.5" y2="16" stroke="${cor}" stroke-width="2.1" stroke-linecap="round"/>`,
  mecanico: (cor) =>
    `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" fill="none" stroke="${cor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`,
  contatos: (cor) =>
    `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" fill="none" stroke="${cor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`,
  chat: (cor) =>
    `<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="10" r="1.1" fill="${cor}"/><circle cx="12" cy="10" r="1.1" fill="${cor}"/><circle cx="15" cy="10" r="1.1" fill="${cor}"/>`,
  navios: (cor) =>
    `<path d="M2 20c2 0 3-1 5-1s3 1 5 1 3-1 5-1 3 1 5 1" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round"/><path d="M4 17 3 11l9-4 9 4-1 6" fill="none" stroke="${cor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3v4M8 9V6h8v3" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  saldo: (cor) =>
    `<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" fill="none" stroke="${cor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" fill="none" stroke="${cor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`,
  caminhao: (cor) =>
    `<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 18H9" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="18" r="2" fill="none" stroke="${cor}" stroke-width="2"/><circle cx="7" cy="18" r="2" fill="none" stroke="${cor}" stroke-width="2"/>`,
  seta: (cor) =>
    `<path d="m9 18 6-6-6-6" fill="none" stroke="${cor}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
};

/**
 * Os nove recursos, na mesma ordem da mensagem (`BENEFICIOS` em src/lib/compartilhar.ts).
 * `rotulo` vai nas artes 1200×630, `longo` na arte de status; `detalhe` aparece ao lado
 * do rótulo quando o recurso ocupa a largura das duas colunas (ver `gradeRecursosSvg`).
 */
const RECURSOS_ARTE = [
  { icone: "ponto", cor: TEMA.ciano, fundo: TEMA.painel, rotulo: "Pontos da Copadubo", longo: "Monitoramento dos pontos da Copadubo" },
  { icone: "alerta", cor: TEMA.ouro, fundo: TEMA.painel, rotulo: "Alertas de chamadas", longo: "Alertas de chamadas no celular" },
  { icone: "tempo", cor: TEMA.azul, fundo: TEMA.painel, rotulo: "Previsão do tempo", longo: "Previsão do tempo no Porto" },
  { icone: "frete", cor: TEMA.verde, fundo: TEMA.verdeEscuro, rotulo: "Cálculo de frete", longo: "Cálculo de frete rápido" },
  { icone: "mecanico", cor: TEMA.ciano, fundo: TEMA.painel, rotulo: "Mecânico com IA", longo: "Assistente mecânico inteligente com IA" },
  { icone: "contatos", cor: TEMA.verde, fundo: TEMA.verdeEscuro, rotulo: "Contatos úteis", longo: "Contatos e informações úteis" },
  { icone: "chat", cor: TEMA.ouro, fundo: TEMA.painel, rotulo: "Chat de motoristas", longo: "Chat entre motoristas do porto" },
  { icone: "navios", cor: TEMA.azul, fundo: TEMA.painel, rotulo: "Navios fertilizantes", longo: "Atracação dos navios de fertilizantes" },
  {
    icone: "saldo",
    cor: TEMA.ouro,
    fundo: TEMA.painel,
    rotulo: "Saldo de Ganhos",
    longo: "Saldo de Ganhos: quanto você vai receber",
    detalhe: "viagens da semana e quanto você vai receber",
  },
];

function iconeEm(nome, cor, x, y, escala = 1) {
  return `<g transform="translate(${x} ${y}) scale(${escala})">${ICONES_SVG[nome](cor)}</g>`;
}

/**
 * Grade dos recursos em duas colunas (artes 1200×630). Com número ímpar de recursos,
 * o último ocupa a largura das duas colunas e mostra o `detalhe` ao lado do rótulo.
 * `caixa` é o quadradinho do ícone, `icone` a posição e a escala do desenho de 24 px,
 * `texto` a posição e o tamanho do rótulo — tudo medido a partir do canto da pílula.
 */
function gradeRecursosSvg({ x, y, colW, pillH, gapX, gapY, raio, caixa, icone, texto }) {
  return RECURSOS_ARTE.map((r, i) => {
    const sozinho = i === RECURSOS_ARTE.length - 1 && RECURSOS_ARTE.length % 2 === 1;
    const largura = sozinho ? colW * 2 + gapX : colW;
    const px = x + (i % 2) * (colW + gapX);
    const py = y + Math.floor(i / 2) * (pillH + gapY);
    const detalhe =
      sozinho && r.detalhe
        ? `<tspan dx="${texto.vao}" font-weight="500" font-size="${texto.tamanho - 0.5}" fill="${TEMA.aco}">${esc(r.detalhe)}</tspan>`
        : "";
    return `<g transform="translate(${px} ${py})">
      <rect width="${largura}" height="${pillH}" rx="${raio}" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="1.5"/>
      <rect x="${caixa.x}" y="${caixa.y}" width="${caixa.lado}" height="${caixa.lado}" rx="${caixa.raio}" fill="${r.fundo}"/>
      ${iconeEm(r.icone, r.cor, icone.x, icone.y, icone.escala)}
      <text x="${texto.x}" y="${texto.y}" font-family="${FONTE_TEXTO}" font-weight="700" font-size="${texto.tamanho}" fill="${TEMA.gelo}">${esc(r.rotulo)}${detalhe}</text>
    </g>`;
  }).join("\n  ");
}

/* --------------------- mockup fiel do celular com a interface Dark Navy */

function mockupAparelhoSvg({ x, y, banner, logo }) {
  const W = 340;
  const H = 566;
  const telaX = 10;
  const telaY = 10;
  const telaW = W - 20; // 320
  const telaH = H - 20; // 546
  const bannerH = 204; // 320 × 204 ≈ proporção 85:54 do banner oficial

  return `<g transform="translate(${x} ${y})">
    <!-- brilho ambiente ciano/marinho atrás do aparelho -->
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="205" ry="285" fill="url(#haloAparelho)"/>

    <!-- chassi do celular em Dark Navy -->
    <rect x="-2" y="-2" width="${W + 4}" height="${H + 4}" rx="40" fill="${TEMA.ciano}" fill-opacity="0.22"/>
    <rect x="0" y="0" width="${W}" height="${H}" rx="38" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="2.5"/>

    <!-- tela recortada -->
    <g clip-path="url(#recorteTela)">
      <rect x="${telaX}" y="${telaY}" width="${telaW}" height="${telaH}" fill="${TEMA.fundo}"/>

      <!-- 1. Banner oficial do topo (Interface CopaLinks em Tema Escuro) -->
      <image x="${telaX}" y="${telaY}" width="${telaW}" height="${bannerH}" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,${banner}"/>
      <rect x="${telaX}" y="${telaY + bannerH - 36}" width="${telaW}" height="38" fill="url(#fusaoBanner)"/>

      <!-- Controles discretos do cabeçalho (menu ⋮, compartilhar e clima) -->
      <circle cx="${telaX + 26}" cy="${telaY + 26}" r="14" fill="${TEMA.fundo}" fill-opacity="0.55" stroke="${TEMA.gelo}" stroke-opacity="0.16" stroke-width="1"/>
      <circle cx="${telaX + 26}" cy="${telaY + 21.5}" r="1.4" fill="${TEMA.gelo}"/>
      <circle cx="${telaX + 26}" cy="${telaY + 26}" r="1.4" fill="${TEMA.gelo}"/>
      <circle cx="${telaX + 26}" cy="${telaY + 30.5}" r="1.4" fill="${TEMA.gelo}"/>

      <circle cx="${telaX + 206}" cy="${telaY + 26}" r="14" fill="${TEMA.fundo}" fill-opacity="0.55" stroke="${TEMA.gelo}" stroke-opacity="0.16" stroke-width="1"/>
      <circle cx="${telaX + 209}" cy="${telaY + 22.5}" r="1.8" fill="${TEMA.gelo}"/>
      <circle cx="${telaX + 203}" cy="${telaY + 26}" r="1.8" fill="${TEMA.gelo}"/>
      <circle cx="${telaX + 209}" cy="${telaY + 29.5}" r="1.8" fill="${TEMA.gelo}"/>
      <line x1="${telaX + 204.5}" y1="${telaY + 25}" x2="${telaX + 207.5}" y2="${telaY + 23.3}" stroke="${TEMA.gelo}" stroke-width="1.3"/>
      <line x1="${telaX + 204.5}" y1="${telaY + 27}" x2="${telaX + 207.5}" y2="${telaY + 28.7}" stroke="${TEMA.gelo}" stroke-width="1.3"/>

      <rect x="${telaX + 225}" y="${telaY + 12}" width="83" height="28" rx="14" fill="${TEMA.fundo}" fill-opacity="0.58" stroke="${TEMA.gelo}" stroke-opacity="0.16" stroke-width="1"/>
      <circle cx="${telaX + 240}" cy="${telaY + 26}" r="4.5" fill="${TEMA.ouro}"/>
      <text x="${telaX + 250}" y="${telaY + 30.5}" font-family="${FONTE_TITULO}" font-weight="800" font-size="11.5" fill="${TEMA.gelo}">24° Porto</text>

      <!-- Saudação na base do banner -->
      <rect x="${telaX}" y="${telaY + bannerH - 44}" width="220" height="36" rx="10" fill="url(#sombraSaudacao)"/>
      <image x="${telaX + 12}" y="${telaY + bannerH - 36}" width="46" height="22" xlink:href="data:image/png;base64,${logo}"/>
      <text x="${telaX + 64}" y="${telaY + bannerH - 20}" font-family="${FONTE_TITULO}" font-weight="800" font-size="14" fill="${TEMA.gelo}">Olá, <tspan fill="${TEMA.ciano}">Motorista!</tspan></text>

      <!-- 2. Cartão do número (.cartao-monitor), nas proporções da tela de 412 px (× 300/388):
              número, status ao lado e o Saldo de Ganhos (“Você vai receber”) -->
      <g transform="translate(${telaX + 10} ${telaY + bannerH - 10})">
        <rect width="300" height="152" rx="18" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="1.5"/>
        <text x="274" y="22" text-anchor="end" font-family="${FONTE_TITULO}" font-weight="700" font-size="11" fill="${TEMA.gelo}">TRUCK - LIVRO A</text>
        <path d="M280 16 l4 4 l4 -4" fill="none" stroke="${TEMA.azul}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

        <!-- Número gigante em ciano -->
        <text x="16" y="67.5" font-family="${FONTE_NUMERO}" font-weight="900" font-size="49.5" letter-spacing="-2" fill="${TEMA.ciano}">A042</text>

        <!-- Selo ATIVO com LED verde, ao lado do número -->
        <g transform="translate(156 36)">
          <rect width="92" height="36" rx="18" fill="${TEMA.fundo}" fill-opacity="0.55" stroke="${TEMA.borda}" stroke-width="1.2"/>
          <circle cx="17" cy="18" r="7.6" fill="${TEMA.verde}" fill-opacity="0.24"/>
          <circle cx="17" cy="18" r="5" fill="${TEMA.verde}"/>
          <text x="32.5" y="17" font-family="${FONTE_TITULO}" font-weight="700" font-size="13.2" fill="${TEMA.verde}">ATIVO</text>
          <text x="32.5" y="29.3" font-family="${FONTE_TEXTO}" font-weight="700" font-size="8.9" fill="${TEMA.gelo}" fill-opacity="0.75">3 na frente</text>
        </g>

        <!-- Saldo de Ganhos dentro do cartão -->
        <line x1="10" y1="83" x2="290" y2="83" stroke="${TEMA.borda}" stroke-width="1"/>
        ${iconeEm("saldo", TEMA.ouro, 13.1, 89.3, 0.775)}
        <text x="40" y="102.3" font-family="${FONTE_TEXTO}" font-weight="500" font-size="10.8" fill="${TEMA.gelo}" fill-opacity="0.85">Você vai receber</text>
        <text x="19" y="139" font-family="${FONTE_NUMERO}" font-weight="900" font-size="38.2" fill="${TEMA.ouro}">R$ 507,92</text>
      </g>

      <!-- 3. Os dois quadros da fila, cada um no seu cartão -->
      <g transform="translate(${telaX + 10} ${telaY + bannerH + 153})">
        <rect width="300" height="52" rx="18" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="1.3"/>
        <circle cx="30.2" cy="26" r="18.5" fill="${TEMA.ouro}" fill-opacity="0.1" stroke="${TEMA.ouro}" stroke-opacity="0.7" stroke-width="1"/>
        ${iconeEm("caminhao", TEMA.ouro, 20.95, 16.75, 0.77)}
        <text x="60.3" y="21.8" font-family="${FONTE_FORTE}" font-weight="800" font-size="11.2" fill="${TEMA.gelo}">Pontos no quadro <tspan fill="${TEMA.ouro}">TRUCK</tspan></text>
        <text x="60.3" y="37.9" font-family="${FONTE_TEXTO}" font-weight="400" font-size="10" fill="${TEMA.gelo}" fill-opacity="0.75">último escalado A038</text>
        <text x="261.3" y="34.5" text-anchor="end" font-family="${FONTE_FORTE}" font-weight="800" font-size="25.8" fill="${TEMA.ouro}">21</text>
        ${iconeEm("seta", TEMA.gelo, 267.6, 15.95, 0.838)}
      </g>

      <g transform="translate(${telaX + 10} ${telaY + bannerH + 215})">
        <rect width="300" height="58" rx="18" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="1.3"/>
        <circle cx="30.2" cy="29" r="18.5" fill="${TEMA.verde}" fill-opacity="0.1" stroke="${TEMA.verde}" stroke-opacity="0.7" stroke-width="1"/>
        ${iconeEm("caminhao", TEMA.verde, 20.95, 19.75, 0.77)}
        <text x="60.3" y="17.7" font-family="${FONTE_FORTE}" font-weight="800" font-size="11.2" fill="${TEMA.gelo}">Pontos no</text>
        <text x="60.3" y="31.7" font-family="${FONTE_FORTE}" font-weight="800" font-size="11.2" fill="${TEMA.gelo}">quadro <tspan fill="${TEMA.verde}">CAVALO/C</tspan></text>
        <text x="60.3" y="47.9" font-family="${FONTE_TEXTO}" font-weight="400" font-size="10" fill="${TEMA.gelo}" fill-opacity="0.75">último escalado A025</text>
        <text x="261.3" y="37.5" text-anchor="end" font-family="${FONTE_FORTE}" font-weight="800" font-size="25.8" fill="${TEMA.verde}">46</text>
        ${iconeEm("seta", TEMA.gelo, 267.6, 18.95, 0.838)}
      </g>

      <!-- 4. Barra de navegação inferior (Início · Chat · Navios) -->
      <g transform="translate(${telaX} ${telaY + telaH - 54})">
        <rect width="${telaW}" height="54" fill="${TEMA.cartao}"/>
        <line x1="0" y1="0" x2="${telaW}" y2="0" stroke="${TEMA.borda}" stroke-width="1.4"/>

        <!-- Início -->
        <g transform="translate(46 9)">
          <path d="M3 10.5 11 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H4a1 1 0 0 1-1-1v-8.5Z" fill="none" stroke="${TEMA.gelo}" stroke-width="1.9" stroke-linejoin="round"/>
          <text x="11" y="33" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="700" font-size="10.5" fill="${TEMA.gelo}">Início</text>
          <rect x="-3" y="38" width="28" height="2.5" rx="1.2" fill="${TEMA.gelo}"/>
        </g>

        <!-- Chat (botão dourado elevado) -->
        <g transform="translate(${telaW / 2} 2)">
          <circle cx="0" cy="10" r="21" fill="${TEMA.ouro}" stroke="${TEMA.cartao}" stroke-width="3"/>
          ${iconeEm("chat", TEMA.fundo, -9.6, 0.4, 0.8)}
          <text x="0" y="44" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="700" font-size="10.5" fill="${TEMA.ouro}">Chat</text>
        </g>

        <!-- Navios com selo ciano -->
        <g transform="translate(${telaW - 68} 9)">
          ${iconeEm("navios", TEMA.aco, 0, 0, 0.9)}
          <rect x="13" y="-4" width="18" height="14" rx="7" fill="${TEMA.ciano}" stroke="${TEMA.cartao}" stroke-width="1.5"/>
          <text x="22" y="6" text-anchor="middle" font-family="${FONTE_TITULO}" font-weight="900" font-size="9.5" fill="${TEMA.fundo}">4</text>
          <text x="11" y="33" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="700" font-size="10.5" fill="${TEMA.aco}">Navios</text>
        </g>
      </g>
    </g>

    <!-- alto-falante discreto no topo da moldura -->
    <rect x="${W / 2 - 28}" y="4" width="56" height="3.5" rx="1.75" fill="${TEMA.borda}"/>
  </g>`;
}

/* ------------------------------ 1. compartilhar.jpg (1200×630 Dark Navy) */

async function gerarCompartilhar() {
  const L = 1200;
  const A = 630;
  const logo = await logoBase64();
  const banner = await bannerBase64(640, 408);

  // Cinco linhas no espaço que era de quatro: 4 × 2 recursos + o Saldo de Ganhos na largura toda.
  const gradeRecursos = gradeRecursosSvg({
    x: 54,
    y: 298,
    colW: 324,
    pillH: 41,
    gapX: 14,
    gapY: 8,
    raio: 12,
    caixa: { x: 8, y: 6, lado: 29, raio: 8.5 },
    icone: { x: 13.6, y: 11.6, escala: 0.74 },
    texto: { x: 47, y: 26, tamanho: 15.5, vao: 10 },
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L}" height="${A}">
  <defs>
    <radialGradient id="luzPainel" cx="22%" cy="18%" r="72%">
      <stop offset="0%" stop-color="${TEMA.painel}" stop-opacity="0.55"/>
      <stop offset="48%" stop-color="${TEMA.cartao}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${TEMA.fundo}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haloAparelho" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${TEMA.ciano}" stop-opacity="0.22"/>
      <stop offset="52%" stop-color="${TEMA.painel}" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="${TEMA.fundo}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fusaoBanner" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${TEMA.fundo}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${TEMA.fundo}" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="sombraSaudacao" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${TEMA.fundo}" stop-opacity="0.78"/>
      <stop offset="72%" stop-color="${TEMA.fundo}" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="${TEMA.fundo}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fileteOuro" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${TEMA.ouro}"/>
      <stop offset="100%" stop-color="${TEMA.ciano}"/>
    </linearGradient>
    <clipPath id="recorteTela">
      <rect x="10" y="10" width="320" height="546" rx="30"/>
    </clipPath>
  </defs>

  <!-- Fundo sólido Dark Navy (#000D16) com atmosfera da própria paleta -->
  <rect width="${L}" height="${A}" fill="${TEMA.fundo}"/>
  <rect width="${L}" height="${A}" fill="url(#luzPainel)"/>

  <!-- Ondas discretas de radar ao redor do celular -->
  <circle cx="964" cy="315" r="250" fill="none" stroke="${TEMA.borda}" stroke-width="1.2" stroke-opacity="0.65"/>
  <circle cx="964" cy="315" r="320" fill="none" stroke="${TEMA.borda}" stroke-width="1" stroke-opacity="0.38"/>

  <!-- Topo esquerdo: Logo oficial + selo Porto de Paranaguá -->
  <image x="54" y="40" width="248" height="117" xlink:href="data:image/png;base64,${logo}"/>

  <g transform="translate(326 80)">
    <rect width="314" height="36" rx="18" fill="${TEMA.painel}" stroke="${TEMA.borda}" stroke-width="1.5"/>
    <circle cx="20" cy="18" r="5" fill="${TEMA.verde}"/>
    <text x="35" y="23" font-family="${FONTE_TITULO}" font-weight="800" font-size="12.5" fill="${TEMA.gelo}" letter-spacing="1.1">PORTO DE PARANAGUÁ · GRATUITO</text>
  </g>

  <!-- Chamada principal -->
  <text x="54" y="216" font-family="${FONTE_TITULO}" font-weight="900" font-size="48" fill="${TEMA.gelo}" letter-spacing="0.5">CONHEÇA O <tspan fill="${TEMA.ciano}">COPALINKS!</tspan></text>
  <text x="54" y="254" font-family="${FONTE_TEXTO}" font-weight="500" font-size="20.5" fill="${TEMA.aco}">Facilitando o dia a dia dos motoristas na rotina do porto.</text>

  <!-- Filete de destaque -->
  <rect x="54" y="274" width="160" height="4" rx="2" fill="url(#fileteOuro)"/>

  <!-- Grade com os 9 recursos do aplicativo -->
  ${gradeRecursos}

  <!-- Rodapé esquerdo: link oficial + assinatura alinhados às 2 colunas (a base bate com a do celular) -->
  <g transform="translate(54 552)">
    <rect width="324" height="46" rx="23" fill="${TEMA.painel}" stroke="${TEMA.ciano}" stroke-opacity="0.65" stroke-width="1.5"/>
    <circle cx="26" cy="23" r="13" fill="${TEMA.cartao}"/>
    <path d="M22.5 24.5 l3 -3 M21 26 a2.8 2.8 0 0 1 0 -4 l1.5 -1.5 a2.8 2.8 0 0 1 4 0 M27 20 a2.8 2.8 0 0 1 0 4 l-1.5 1.5 a2.8 2.8 0 0 1 -4 0" fill="none" stroke="${TEMA.ouro}" stroke-width="1.8" stroke-linecap="round"/>
    <text x="48" y="29" font-family="${FONTE_TEXTO}" font-weight="700" font-size="19.5" fill="${TEMA.ciano}">${esc(SEM_BARRA)}</text>

    <text x="338" y="21" font-family="${FONTE_TITULO}" font-weight="800" font-size="14" fill="${TEMA.ouro}" letter-spacing="0.6">CONECTAR • FACILITAR • EVOLUIR</text>
    <text x="338" y="39" font-family="${FONTE_TEXTO}" font-weight="500" font-size="13.5" fill="${TEMA.aco}">100% gratuito · instale sem loja</text>
  </g>

  <!-- Direita: Mockup realista do aplicativo em Dark Navy -->
  ${mockupAparelhoSvg({ x: 794, y: 32, banner, logo })}
</svg>`;

  const saida = path.resolve("public/images/compartilhar.jpg");
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(saida);
  console.log("✓ public/images/compartilhar.jpg (1200×630 · Dark Navy)");
}

/* ------------------------- 2. divulgacao-card.jpg (1200×630 com QR Code) */

async function gerarCard() {
  const L = 1200;
  const A = 630;
  const logo = await logoBase64();
  const qr = await qrBase64(236);

  const gradeRecursos = gradeRecursosSvg({
    x: 58,
    y: 302,
    colW: 376,
    pillH: 40,
    gapX: 14,
    gapY: 8,
    raio: 12,
    caixa: { x: 8, y: 6, lado: 28, raio: 8 },
    icone: { x: 13.4, y: 11.4, escala: 0.72 },
    texto: { x: 46, y: 25.5, tamanho: 15.5, vao: 10 },
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L}" height="${A}">
  <defs>
    <radialGradient id="luzCard" cx="25%" cy="22%" r="75%">
      <stop offset="0%" stop-color="${TEMA.painel}" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="${TEMA.cartao}" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${TEMA.fundo}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fileteCard" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${TEMA.ouro}"/>
      <stop offset="100%" stop-color="${TEMA.ciano}"/>
    </linearGradient>
  </defs>

  <rect width="${L}" height="${A}" fill="${TEMA.fundo}"/>
  <rect width="${L}" height="${A}" fill="url(#luzCard)"/>

  <image x="58" y="42" width="256" height="121" xlink:href="data:image/png;base64,${logo}"/>

  <text x="58" y="218" font-family="${FONTE_TITULO}" font-weight="900" font-size="50" fill="${TEMA.gelo}" letter-spacing="0.5">CONHEÇA O <tspan fill="${TEMA.ciano}">COPALINKS!</tspan></text>
  <text x="58" y="256" font-family="${FONTE_TEXTO}" font-weight="500" font-size="21" fill="${TEMA.aco}">Facilitando o dia a dia dos motoristas no Porto de Paranaguá.</text>
  <rect x="58" y="276" width="170" height="4" rx="2" fill="url(#fileteCard)"/>

  ${gradeRecursos}

  <text x="58" y="574" font-family="${FONTE_TEXTO}" font-weight="700" font-size="24" fill="${TEMA.ciano}">${esc(SEM_BARRA)}</text>
  <text x="390" y="574" font-family="${FONTE_TITULO}" font-weight="800" font-size="16" fill="${TEMA.ouro}" letter-spacing="0.8">CONECTAR • FACILITAR • EVOLUIR</text>

  <!-- Cartão do QR Code em Dark Navy -->
  <g transform="translate(876 112)">
    <rect width="272" height="406" rx="28" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="2"/>
    <rect x="18" y="18" width="236" height="236" rx="18" fill="#ffffff"/>
    <image x="26" y="26" width="220" height="220" xlink:href="data:image/png;base64,${qr}"/>
    <text x="136" y="296" text-anchor="middle" font-family="${FONTE_TITULO}" font-weight="800" font-size="22" fill="${TEMA.gelo}">Aponte a câmera</text>
    <text x="136" y="326" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="500" font-size="16" fill="${TEMA.aco}">Abra e instale grátis</text>
    <rect x="34" y="348" width="204" height="36" rx="18" fill="${TEMA.painel}" stroke="${TEMA.ciano}" stroke-opacity="0.55" stroke-width="1.2"/>
    <text x="136" y="371" text-anchor="middle" font-family="${FONTE_TITULO}" font-weight="800" font-size="13" fill="${TEMA.ciano}" letter-spacing="1">100% GRATUITO</text>
  </g>
</svg>`;

  const saida = path.resolve("public/images/divulgacao-card.jpg");
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(saida);
  console.log("✓ public/images/divulgacao-card.jpg (1200×630 · Dark Navy)");
}

/* --------------------- 3. divulgacao-status.jpg (1080×1920 para Status) */

async function gerarStatus() {
  const L = 1080;
  const A = 1920;
  const logo = await logoBase64();
  const qr = await qrBase64(310);

  // Nove linhas no espaço que era de oito (de 650 a 1340; o painel do QR começa em 1372).
  const listaRecursos = RECURSOS_ARTE.map((r, i) => {
    const py = 650 + i * 78;
    return `<g transform="translate(84 ${py})">
      <rect width="912" height="66" rx="17" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="1.8"/>
      <rect x="13" y="12" width="42" height="42" rx="12" fill="${r.fundo}"/>
      ${iconeEm(r.icone, r.cor, 21, 20, 1.08)}
      <text x="72" y="42" font-family="${FONTE_TEXTO}" font-weight="700" font-size="25.5" fill="${TEMA.gelo}">${esc(r.longo)}</text>
    </g>`;
  }).join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L}" height="${A}">
  <defs>
    <radialGradient id="luzStatus" cx="50%" cy="18%" r="72%">
      <stop offset="0%" stop-color="${TEMA.painel}" stop-opacity="0.6"/>
      <stop offset="52%" stop-color="${TEMA.cartao}" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="${TEMA.fundo}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fileteStatus" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${TEMA.ouro}"/>
      <stop offset="100%" stop-color="${TEMA.ciano}"/>
    </linearGradient>
  </defs>

  <rect width="${L}" height="${A}" fill="${TEMA.fundo}"/>
  <rect width="${L}" height="${A}" fill="url(#luzStatus)"/>

  <!-- Logo -->
  <image x="255" y="76" width="570" height="270" xlink:href="data:image/png;base64,${logo}"/>

  <!-- Chamada -->
  <text x="540" y="438" text-anchor="middle" font-family="${FONTE_TITULO}" font-weight="900" font-size="68" fill="${TEMA.gelo}" letter-spacing="0.8">CONHEÇA O <tspan fill="${TEMA.ciano}">COPALINKS!</tspan></text>
  <text x="540" y="502" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="500" font-size="31" fill="${TEMA.gelo}">Facilitando o dia a dia dos motoristas</text>
  <text x="540" y="546" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="500" font-size="31" fill="${TEMA.aco}">no Porto de Paranaguá.</text>

  <rect x="370" y="588" width="340" height="5" rx="2.5" fill="url(#fileteStatus)"/>

  <!-- 9 recursos em cartões Dark Navy -->
  ${listaRecursos}

  <!-- Painel QR Code + chamada -->
  <g transform="translate(84 1372)">
    <rect width="912" height="378" rx="30" fill="${TEMA.cartao}" stroke="${TEMA.borda}" stroke-width="2"/>
    <rect x="32" y="34" width="310" height="310" rx="22" fill="#ffffff"/>
    <image x="44" y="46" width="286" height="286" xlink:href="data:image/png;base64,${qr}"/>

    <text x="382" y="108" font-family="${FONTE_TITULO}" font-weight="900" font-size="44" fill="${TEMA.gelo}">Acesse e conheça</text>
    <text x="382" y="162" font-family="${FONTE_TEXTO}" font-weight="500" font-size="27" fill="${TEMA.aco}">Aponte a câmera ou abra pelo link:</text>
    <rect x="382" y="192" width="488" height="64" rx="32" fill="${TEMA.painel}" stroke="${TEMA.ciano}" stroke-opacity="0.65" stroke-width="1.8"/>
    <text x="626" y="234" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="700" font-size="30" fill="${TEMA.ciano}">${esc(SEM_BARRA)}</text>
    <text x="382" y="312" font-family="${FONTE_TITULO}" font-weight="800" font-size="24" fill="${TEMA.verde}" letter-spacing="1">100% GRATUITO PARA O MOTORISTA</text>
  </g>

  <!-- Assinatura -->
  <text x="540" y="1822" text-anchor="middle" font-family="${FONTE_TITULO}" font-weight="800" font-size="27" fill="${TEMA.ouro}" letter-spacing="1.4">COPALINKS — CONECTAR • FACILITAR • EVOLUIR</text>
  <text x="540" y="1866" text-anchor="middle" font-family="${FONTE_TEXTO}" font-weight="500" font-size="24" fill="${TEMA.aco}">Porto de Paranaguá · Copadubo</text>
</svg>`;

  const saida = path.resolve("public/images/divulgacao-status.jpg");
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(saida);
  console.log("✓ public/images/divulgacao-status.jpg (1080×1920 · Dark Navy)");
}

/* --------------------------------------------------------------- run */

await garantirFontes();
await mkdir(path.resolve("public/images"), { recursive: true });
await gerarCompartilhar();
await gerarCard();
await gerarStatus();
console.log(`\nEndereço usado nas artes: ${URL_APP}`);
