/**
 * Arte das figurinhas oficiais do CopaLinks (fonte do pacote inicial).
 *
 * Cada figurinha é um SVG flat desenhado aqui — fundo transparente, contorno
 * navy e a paleta do app. O script `scripts/gerar-figurinhas.mjs` rasteriza
 * para WebP transparente e gera `src/lib/figurinhas-pacote.ts` (base64) que
 * semeia o banco central. Novos pacotes futuros entram pelo painel admin.
 */

const svg = (conteudo) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${conteudo}</svg>`;

const G = (conteudo, largura = 9) =>
  `<g fill="none" stroke="#0b1440" stroke-width="${largura}" stroke-linecap="round" stroke-linejoin="round">${conteudo}</g>`;

export const FIGURINHAS_ARTE = [
  /* ---------------------------------------------------------- CAMINHÕES */
  {
    slug: "caminhao-feliz",
    nome: "Caminhão feliz",
    categoria: "caminhoes",
    svg: svg(`
      <circle cx="36" cy="52" r="12" fill="#8ce7ed" stroke="#0b1440" stroke-width="8"/>
      <circle cx="218" cy="44" r="9" fill="#ffc83d" stroke="#0b1440" stroke-width="8"/>
      ${G(`
        <path d="M52 132 h152 a14 14 0 0 1 14 14 v38 a12 12 0 0 1 -12 12 H50 a12 12 0 0 1 -12 -12 v-38 a14 14 0 0 1 14 -14 z" fill="#5376f4"/>
        <rect x="68" y="72" width="120" height="64" rx="20" fill="#3c56e0"/>
        <rect x="82" y="86" width="92" height="44" rx="15" fill="#8ce7ed"/>
        <circle cx="112" cy="108" r="7" fill="#0b1440" stroke="none"/>
        <circle cx="146" cy="108" r="7" fill="#0b1440" stroke="none"/>
        <path d="M112 122 q15 12 32 0" stroke-width="7"/>
        <rect x="92" y="150" width="72" height="24" rx="9" fill="#ffc83d"/>
        <circle cx="60" cy="158" r="11" fill="#fff4d6" stroke-width="7"/>
        <circle cx="196" cy="158" r="11" fill="#fff4d6" stroke-width="7"/>
        <circle cx="74" cy="202" r="24" fill="#0b1440"/>
        <circle cx="74" cy="202" r="10" fill="#fff4d6" stroke="none"/>
        <circle cx="182" cy="202" r="24" fill="#0b1440"/>
        <circle cx="182" cy="202" r="10" fill="#fff4d6" stroke="none"/>
      `)}
    `),
  },
  {
    slug: "caminhao-carregado",
    nome: "Carregado!",
    categoria: "caminhoes",
    svg: svg(`
      ${G(`
        <rect x="34" y="86" width="140" height="74" rx="12" fill="#ff9f43"/>
        <path d="M34 108 h140" stroke-width="7"/>
        <path d="M34 134 h140" stroke-width="7"/>
        <path d="M60 86 v74" stroke-width="7" opacity=".55"/>
        <path d="M112 86 v74" stroke-width="7" opacity=".55"/>
        <path d="M148 86 v74" stroke-width="7" opacity=".55"/>
        <path d="M174 160 v-58 a10 10 0 0 1 10 -10 h22 l24 30 v38 z" fill="#5376f4"/>
        <rect x="186" y="104" width="30" height="26" rx="8" fill="#8ce7ed" stroke-width="7"/>
        <circle cx="74" cy="182" r="22" fill="#0b1440"/>
        <circle cx="74" cy="182" r="9" fill="#fff4d6" stroke="none"/>
        <circle cx="196" cy="182" r="22" fill="#0b1440"/>
        <circle cx="196" cy="182" r="9" fill="#fff4d6" stroke="none"/>
        <path d="M28 172 h16 M22 150 h14" stroke-width="8"/>
      `)}
    `),
  },
  {
    slug: "caminhao-veloz",
    nome: "Saindo pra estrada",
    categoria: "caminhoes",
    svg: svg(`
      ${G(`
        <path d="M18 96 h34 M10 128 h40 M22 160 h30" stroke="#8ce7ed" stroke-width="10"/>
        <path d="M84 122 h84 a12 12 0 0 1 12 12 v28 a10 10 0 0 1 -10 10 H82 a10 10 0 0 1 -10 -10 v-28 a12 12 0 0 1 12 -12 z" fill="#5376f4"/>
        <path d="M168 122 v-30 a10 10 0 0 1 10 -10 h20 l22 26 v14 z" fill="#3c56e0"/>
        <rect x="182" y="94" width="26" height="22" rx="7" fill="#8ce7ed" stroke-width="7"/>
        <circle cx="104" cy="188" r="21" fill="#0b1440"/>
        <circle cx="104" cy="188" r="8" fill="#fff4d6" stroke="none"/>
        <circle cx="196" cy="188" r="21" fill="#0b1440"/>
        <circle cx="196" cy="188" r="8" fill="#fff4d6" stroke="none"/>
        <rect x="90" y="134" width="42" height="18" rx="8" fill="#ffc83d" stroke-width="7"/>
      `)}
    `),
  },
  {
    slug: "caminhao-chuva",
    nome: "Chuva na estrada",
    categoria: "caminhoes",
    svg: svg(`
      ${G(`
        <path d="M78 74 a30 30 0 0 1 56 -12 a26 26 0 0 1 44 22 a20 20 0 0 1 -6 40 H82 a24 24 0 0 1 -4 -50 z" fill="#8ba4ff"/>
        <path d="M92 142 l-8 18 M128 142 l-8 18 M164 142 l-8 18 M196 142 l-8 18" stroke="#3fb6c9" stroke-width="9"/>
        <path d="M52 176 h152 a12 12 0 0 1 12 12 v14 a10 10 0 0 1 -10 10 H50 a10 10 0 0 1 -10 -10 v-14 a12 12 0 0 1 12 -12 z" fill="#5376f4"/>
        <rect x="66" y="146" width="70" height="32" rx="11" fill="#3c56e0"/>
        <rect x="76" y="152" width="30" height="18" rx="6" fill="#8ce7ed" stroke-width="6"/>
        <circle cx="78" cy="218" r="16" fill="#0b1440"/>
        <circle cx="182" cy="218" r="16" fill="#0b1440"/>
      `)}
    `),
  },
  {
    slug: "caminhao-luz-verde",
    nome: "Luz verde, pode ir!",
    categoria: "caminhoes",
    svg: svg(`
      ${G(`
        <rect x="158" y="24" width="64" height="104" rx="22" fill="#0b1440" stroke-width="8"/>
        <circle cx="190" cy="52" r="13" fill="#3a2540" stroke="none"/>
        <circle cx="190" cy="84" r="13" fill="#3a2540" stroke="none"/>
        <circle cx="190" cy="116" r="13" fill="#35e08a" stroke="none"/>
        <path d="M118 132 h-58 a12 12 0 0 1 -12 -12 v-28 a12 12 0 0 1 12 -12 h20 l16 -18 h22 a12 12 0 0 1 12 12 v46 a12 12 0 0 1 -12 12 z" fill="#5376f4"/>
        <rect x="58" y="94" width="28" height="22" rx="7" fill="#8ce7ed" stroke-width="6"/>
        <circle cx="72" cy="152" r="18" fill="#0b1440"/>
        <circle cx="72" cy="152" r="7" fill="#fff4d6" stroke="none"/>
        <path d="M30 200 h128" stroke="#8ce7ed" stroke-width="10"/>
      `)}
    `),
  },

  /* ---------------------------------------------------------- MOTORISTAS */
  {
    slug: "cafezinho",
    nome: "Cafézinho!",
    categoria: "motoristas",
    svg: svg(`
      ${G(`
        <path d="M88 58 q10 -12 0 -24 M128 58 q10 -12 0 -24 M168 58 q10 -12 0 -24" stroke="#8ce7ed" stroke-width="9"/>
        <path d="M62 96 h132 v58 a44 44 0 0 1 -44 44 h-44 a44 44 0 0 1 -44 -44 z" fill="#fff4d6"/>
        <path d="M194 110 h18 a24 24 0 0 1 0 48 h-18" fill="#ffc83d"/>
        <path d="M84 132 q22 18 44 0 q22 -18 44 0" stroke="#ff7a90" stroke-width="8"/>
        <rect x="48" y="206" width="160" height="22" rx="11" fill="#5376f4"/>
      `)}
    `),
  },
  {
    slug: "bom-dia",
    nome: "Bom dia, motorista!",
    categoria: "motoristas",
    svg: svg(`
      ${G(`
        <circle cx="128" cy="104" r="52" fill="#ffc83d"/>
        <path d="M128 22 v-0.5 M128 186 v0.5 M46 104 h-0.5 M210 104 h0.5 M70 46 l-10 -10 M186 46 l10 -10 M70 162 l-10 10 M186 162 l10 10" stroke="#ffc83d" stroke-width="11"/>
        <circle cx="110" cy="96" r="7" fill="#0b1440" stroke="none"/>
        <circle cx="146" cy="96" r="7" fill="#0b1440" stroke="none"/>
        <path d="M108 120 q20 16 40 0" stroke-width="8"/>
        <path d="M64 208 h128 a10 10 0 0 1 10 10 v10 a8 8 0 0 1 -8 8 H62 a8 8 0 0 1 -8 -8 v-10 a10 10 0 0 1 10 -10 z" fill="#5376f4"/>
      `)}
    `),
  },
  {
    slug: "joinha",
    nome: "Show de bola!",
    categoria: "motoristas",
    svg: svg(`
      ${G(`
        <path d="M84 112 h26 v88 H84 a12 12 0 0 1 -12 -12 v-64 a12 12 0 0 1 12 -12 z" fill="#5376f4"/>
        <path d="M110 116 l28 -56 a16 16 0 0 1 30 12 l-12 30 h44 a16 16 0 0 1 15.5 20 l-14 62 a18 18 0 0 1 -17.5 14 H110 z" fill="#ffc83d"/>
        <path d="M146 78 q10 -8 20 0" stroke-width="7"/>
        <path d="M30 88 l14 10 M22 128 l16 2 M36 168 l12 -8" stroke="#8ce7ed" stroke-width="8"/>
      `)}
    `),
  },
  {
    slug: "motorista-top",
    nome: "Motorista top",
    categoria: "motoristas",
    svg: svg(`
      ${G(`
        <path d="M64 210 a64 58 0 0 1 128 0 z" fill="#5376f4"/>
        <circle cx="128" cy="118" r="58" fill="#ffd9b8"/>
        <path d="M70 108 a58 58 0 0 1 116 0 q-58 -30 -116 0 z" fill="#e8455f"/>
        <path d="M196 108 h10 a12 12 0 0 1 0 24 h-8" fill="#e8455f" stroke-width="7"/>
        <rect x="86" y="112" width="38" height="26" rx="12" fill="#0b1440" stroke-width="7"/>
        <rect x="132" y="112" width="38" height="26" rx="12" fill="#0b1440" stroke-width="7"/>
        <path d="M124 124 h8" stroke-width="7"/>
        <path d="M108 162 q20 18 40 0" stroke-width="8"/>
      `)}
    `),
  },
  {
    slug: "tamo-junto",
    nome: "Tamo junto!",
    categoria: "motoristas",
    svg: svg(`
      ${G(`
        <circle cx="74" cy="112" r="44" fill="#ffd9b8"/>
        <path d="M30 106 a44 44 0 0 1 88 0 q-44 -22 -88 0 z" fill="#3c56e0"/>
        <circle cx="60" cy="116" r="6" fill="#0b1440" stroke="none"/>
        <circle cx="88" cy="116" r="6" fill="#0b1440" stroke="none"/>
        <path d="M62 134 q12 10 24 0" stroke-width="7"/>
        <circle cx="182" cy="112" r="44" fill="#ffc49e"/>
        <path d="M138 106 a44 44 0 0 1 88 0 q-44 -22 -88 0 z" fill="#e8455f"/>
        <circle cx="168" cy="116" r="6" fill="#0b1440" stroke="none"/>
        <circle cx="196" cy="116" r="6" fill="#0b1440" stroke="none"/>
        <path d="M170 134 q12 10 24 0" stroke-width="7"/>
        <path d="M128 186 C 88 158 82 136 94 122 a20 20 0 0 1 34 -6 a20 20 0 0 1 34 6 c12 14 6 36 -34 64 z" fill="#ff7a90" stroke-width="8"/>
      `)}
    `),
  },
  {
    slug: "acenando",
    nome: "Valeu, falou!",
    categoria: "motoristas",
    svg: svg(`
      ${G(`
        <path d="M92 214 v-52 l-24 -30 a12 12 0 0 1 18 -16 l22 22 v-74 a13 13 0 0 1 26 0 v40 a13 13 0 0 1 26 0 v10 a13 13 0 0 1 26 0 v14 a13 13 0 0 1 26 0 v34 a62 62 0 0 1 -62 62 z" fill="#ffd9b8"/>
        <path d="M92 162 v-18 M126 140 v-24 M158 132 v-14" stroke-width="7"/>
        <path d="M214 74 q10 -12 22 -12 M222 104 h22 M210 132 q12 10 24 8" stroke="#8ce7ed" stroke-width="8"/>
      `)}
    `),
  },
  {
    slug: "descanso",
    nome: "Hora do descanso",
    categoria: "motoristas",
    svg: svg(`
      ${G(`
        <circle cx="118" cy="132" r="62" fill="#ffd9b8"/>
        <path d="M56 118 a62 62 0 0 1 124 0 q-62 -26 -124 0 z" fill="#3c56e0"/>
        <path d="M88 136 q10 10 20 0 M128 136 q10 10 20 0" stroke-width="8"/>
        <path d="M108 168 q12 8 24 0" stroke-width="8"/>
        <path d="M196 44 h30 l-30 32 h30" stroke="#8ba4ff" stroke-width="9"/>
        <path d="M168 82 h22 l-22 24 h22" stroke="#8ba4ff" stroke-width="8"/>
      `)}
    `),
  },

  /* --------------------------------------------------------------- PORTO */
  {
    slug: "navio",
    nome: "Navio no porto",
    categoria: "porto",
    svg: svg(`
      ${G(`
        <path d="M28 168 h200 l-24 42 a12 12 0 0 1 -10 6 H62 a12 12 0 0 1 -10 -6 z" fill="#5376f4"/>
        <rect x="72" y="118" width="44" height="46" rx="6" fill="#ff9f43" stroke-width="8"/>
        <rect x="122" y="118" width="44" height="46" rx="6" fill="#35e08a" stroke-width="8"/>
        <path d="M176 164 v-42 h-32 v42" fill="#ffc83d" stroke-width="8"/>
        <rect x="182" y="88" width="26" height="26" rx="6" fill="#8ce7ed" stroke-width="7"/>
        <path d="M196 88 v-22" stroke-width="8"/>
        <path d="M22 236 q16 -14 32 0 q16 14 32 0 q16 -14 32 0 q16 14 32 0 q16 -14 32 0 q16 14 32 0" stroke="#3fb6c9" stroke-width="9"/>
      `)}
    `),
  },
  {
    slug: "guindaste",
    nome: "Guindaste do porto",
    categoria: "porto",
    svg: svg(`
      ${G(`
        <path d="M52 220 V64 h20 v156 z" fill="#ffc83d"/>
        <path d="M52 80 h150" stroke-width="10"/>
        <path d="M52 64 l75 -28 75 28" stroke-width="10"/>
        <path d="M170 80 v26" stroke-width="8"/>
        <rect x="132" y="106" width="76" height="52" rx="8" fill="#ff9f43" stroke-width="8"/>
        <path d="M132 128 h76" stroke-width="6"/>
        <rect x="34" y="204" width="56" height="24" rx="8" fill="#5376f4" stroke-width="8"/>
        <path d="M20 236 h216" stroke="#3fb6c9" stroke-width="9"/>
      `)}
    `),
  },
  {
    slug: "fila-porto",
    nome: "Fila do porto",
    categoria: "porto",
    svg: svg(`
      ${G(`
        <path d="M36 148 h52 a8 8 0 0 1 8 8 v18 a8 8 0 0 1 -8 8 H36 a8 8 0 0 1 -8 -8 v-18 a8 8 0 0 1 8 -8 z" fill="#5376f4" stroke-width="7"/>
        <path d="M74 148 v-16 a6 6 0 0 1 6 -6 h14 l12 14 v8" fill="#3c56e0" stroke-width="7"/>
        <path d="M112 148 h52 a8 8 0 0 1 8 8 v18 a8 8 0 0 1 -8 8 h-52 a8 8 0 0 1 -8 -8 v-18 a8 8 0 0 1 8 -8 z" fill="#8ba4ff" stroke-width="7"/>
        <path d="M150 148 v-16 a6 6 0 0 1 6 -6 h14 l12 14 v8" fill="#5376f4" stroke-width="7"/>
        <path d="M188 148 h28 a8 8 0 0 1 8 8 v18 a8 8 0 0 1 -8 8 h-28" fill="#8ce7ed" stroke-width="7"/>
        <circle cx="52" cy="196" r="10" fill="#0b1440" stroke-width="6"/>
        <circle cx="128" cy="196" r="10" fill="#0b1440" stroke-width="6"/>
        <circle cx="204" cy="196" r="10" fill="#0b1440" stroke-width="6"/>
        <circle cx="128" cy="80" r="40" fill="#fff4d6"/>
        <path d="M128 56 v26 l18 12" stroke-width="9"/>
      `)}
    `),
  },
  {
    slug: "balanca",
    nome: "Na balança",
    categoria: "porto",
    svg: svg(`
      ${G(`
        <path d="M128 42 v150" stroke-width="10"/>
        <path d="M44 76 h168" stroke-width="10"/>
        <path d="M44 76 l-22 44 a26 26 0 0 0 44 0 z" fill="#8ce7ed"/>
        <path d="M212 76 l-22 44 a26 26 0 0 0 44 0 z" fill="#8ce7ed"/>
        <circle cx="128" cy="52" r="12" fill="#ffc83d" stroke-width="7"/>
        <rect x="88" y="192" width="80" height="26" rx="10" fill="#5376f4"/>
        <path d="M64 228 h128" stroke-width="10"/>
      `)}
    `),
  },
  {
    slug: "containers",
    nome: "Containers",
    categoria: "porto",
    svg: svg(`
      ${G(`
        <rect x="42" y="120" width="80" height="56" rx="8" fill="#ff9f43" stroke-width="8"/>
        <path d="M42 142 h80 M42 156 h80" stroke-width="5" opacity=".5"/>
        <rect x="128" y="120" width="86" height="56" rx="8" fill="#35e08a" stroke-width="8"/>
        <path d="M128 142 h86 M128 156 h86" stroke-width="5" opacity=".5"/>
        <rect x="86" y="58" width="86" height="56" rx="8" fill="#5376f4" stroke-width="8"/>
        <path d="M86 80 h86 M86 94 h86" stroke-width="5" opacity=".5"/>
        <path d="M22 192 h212" stroke-width="10"/>
      `)}
    `),
  },
  {
    slug: "porto-noite",
    nome: "Porto à noite",
    categoria: "porto",
    svg: svg(`
      ${G(`
        <path d="M186 44 a34 34 0 1 0 26 56 a28 28 0 0 1 -26 -56 z" fill="#fff4d6"/>
        <circle cx="72" cy="52" r="6" fill="#8ce7ed" stroke="none"/>
        <circle cx="112" cy="34" r="5" fill="#8ce7ed" stroke="none"/>
        <circle cx="48" cy="92" r="5" fill="#8ce7ed" stroke="none"/>
        <path d="M36 168 h184 l-22 38 a12 12 0 0 1 -10 6 H68 a12 12 0 0 1 -10 -6 z" fill="#3c56e0"/>
        <rect x="76" y="128" width="40" height="38" rx="6" fill="#8ba4ff" stroke-width="7"/>
        <rect x="122" y="128" width="40" height="38" rx="6" fill="#ffc83d" stroke-width="7"/>
        <path d="M18 232 q16 -14 32 0 q16 14 32 0 q16 -14 32 0 q16 14 32 0 q16 -14 32 0 q16 14 32 0" stroke="#3fb6c9" stroke-width="9"/>
      `)}
    `),
  },

  /* ------------------------------------------------------------ COPALINKS */
  {
    slug: "estrela-copa",
    nome: "Estrela CopaLinks",
    categoria: "copalinks",
    svg: svg(`
      ${G(`
        <path d="M128 26 l28 58 64 8 -46 46 12 64 -58 -30 -58 30 12 -64 -46 -46 64 -8 z" fill="#ffc83d"/>
        <path d="M128 88 l10 22 24 3 -17 17 4 24 -21 -11 -21 11 4 -24 -17 -17 24 -3 z" fill="#5376f4" stroke-width="7"/>
      `)}
    `),
  },
  {
    slug: "coracao-caminhao",
    nome: "Coração na estrada",
    categoria: "copalinks",
    svg: svg(`
      ${G(`
        <path d="M128 218 C 44 160 34 112 58 84 a44 44 0 0 1 70 -12 a44 44 0 0 1 70 12 c24 28 14 76 -70 134 z" fill="#ff7a90"/>
        <g stroke="none">
          <rect x="64" y="118" width="64" height="34" rx="8" fill="#fff4d6"/>
          <path d="M128 126 v-14 a6 6 0 0 1 6 -6 h18 l16 18 v16 a4 4 0 0 1 -4 4 h-36 z" fill="#fff4d6"/>
          <rect x="136" y="112" width="18" height="12" rx="3" fill="#ff7a90"/>
          <circle cx="86" cy="158" r="11" fill="#0b1440"/>
          <circle cx="140" cy="158" r="11" fill="#0b1440"/>
          <circle cx="86" cy="158" r="4.5" fill="#fff4d6"/>
          <circle cx="140" cy="158" r="4.5" fill="#fff4d6"/>
        </g>
      `)}
    `),
  },
  {
    slug: "show-bola",
    nome: "Aêêê!",
    categoria: "copalinks",
    svg: svg(`
      ${G(`
        <path d="M36 224 l52 -96 44 44 z" fill="#5376f4"/>
        <path d="M88 128 l22 -22 22 22" fill="#8ce7ed" stroke-width="7"/>
        <circle cx="168" cy="64" r="10" fill="#ffc83d" stroke-width="6"/>
        <circle cx="204" cy="104" r="8" fill="#ff7a90" stroke-width="6"/>
        <circle cx="140" cy="44" r="7" fill="#35e08a" stroke-width="6"/>
        <path d="M120 84 q14 -18 34 -26 M152 122 q22 -6 36 -22 M112 60 q-4 -18 2 -32" stroke="#8ba4ff" stroke-width="8"/>
        <path d="M206 44 l8 -14 M228 72 l14 -8 M188 22 l2 -16" stroke="#ffc83d" stroke-width="7"/>
      `)}
    `),
  },
  {
    slug: "valeu",
    nome: "Valeu!",
    categoria: "copalinks",
    svg: svg(`
      ${G(`
        <path d="M42 60 h172 a22 22 0 0 1 22 22 v66 a22 22 0 0 1 -22 22 H116 l-34 32 v-32 H42 a22 22 0 0 1 -22 -22 V82 a22 22 0 0 1 22 -22 z" fill="#8ce7ed"/>
      `)}
      <text x="128" y="132" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="46" font-weight="800" fill="#0b1440" textLength="128" lengthAdjust="spacingAndGlyphs">VALEU!</text>
    `),
  },
];
