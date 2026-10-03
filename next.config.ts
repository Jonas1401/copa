import type { NextConfig } from "next";

// Imagens e ícones mudam raramente: o celular guarda por 7 dias e reaproveita
// na próxima abertura, sem baixar de novo.
const CACHE_ESTATICO = "public, max-age=604800, stale-while-revalidate=2592000";

// O Playwright carrega arquivos por caminho montado em tempo de execução (ex.: browsers.json),
// que o rastreamento automático não vê: o pacote inteiro (14 MB) viaja com as rotas do radar.
const ARQUIVOS_NAVEGADOR = [
  "./node_modules/playwright-core/**/*",
  "./node_modules/@sparticuz/chromium-min/**/*",
];

// Arquivos que o OCR (tesseract.js) precisa em tempo de execução. O Node lê o núcleo
// WebAssembly (`.js` + `.wasm`) do disco, e a variante é escolhida pelo suporte da CPU
// (relaxed-simd, simd ou comum) — por isso entram todas, e não só a LSTM.
const ARQUIVOS_OCR = [
  "./node_modules/tesseract.js/**/*",
  "./node_modules/tesseract.js-core/package.json",
  "./node_modules/tesseract.js-core/tesseract-core*.js",
  "./node_modules/tesseract.js-core/tesseract-core*.wasm",
  "./node_modules/wasm-feature-detect/**/*",
  "./node_modules/regenerator-runtime/**/*",
  "./node_modules/zlibjs/**/*",
  "./node_modules/bmp-js/**/*",
  "./node_modules/is-url/**/*",
  "./node_modules/node-fetch/**/*",
  "./node_modules/whatwg-url/**/*",
  "./node_modules/tr46/**/*",
  "./node_modules/webidl-conversions/**/*",
  "./node_modules/@tesseract.js-data/por/4.0.0_best_int/**/*",
];

const ARQUIVOS_RADAR = [...ARQUIVOS_NAVEGADOR, ...ARQUIVOS_OCR];

const nextConfig: NextConfig = {
  // Leitura do painel da APPA por OCR (tesseract.js) e navegador automático
  // (playwright-core + @sparticuz/chromium-min): só no servidor e carregados
  // do node_modules em tempo de execução, não empacotados — o worker do
  // Tesseract e o Chromium precisam dos arquivos reais no disco.
  serverExternalPackages: ["tesseract.js", "playwright-core", "@sparticuz/chromium-min", "sharp"],
  // O navegador e o OCR carregam arquivos por caminho em tempo de execução (o núcleo
  // WebAssembly e o idioma do Tesseract, o browsers.json do Playwright): o rastreamento
  // automático não os enxerga. Sem isto a Vercel publicaria as rotas do radar sem eles
  // e esses dois métodos falhariam (conferido simulando a pasta publicada de /api/cron).
  outputFileTracingIncludes: {
    "/api/cron": ARQUIVOS_RADAR,
    "/api/tempo/radar": ARQUIVOS_RADAR,
    "/api/estado": ARQUIVOS_RADAR,
    "/api/atualizar": ARQUIVOS_RADAR,
  },
  async headers() {
    return [
      { source: "/images/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
      { source: "/icons/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
    ];
  },
};

export default nextConfig;
