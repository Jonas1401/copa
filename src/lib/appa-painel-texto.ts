/**
 * PAINEL METEOROLÓGICO DA APPA — partes PURAS da leitura.
 *
 * Este arquivo não acessa rede, banco, navegador nem IA: só transforma o que
 * veio de qualquer uma das fontes (API, HTML, navegador automático, OCR ou
 * Composio) no **formato único** que o resto do aplicativo consome:
 *
 *   {
 *     "fonte": "APPA",
 *     "timestamp_leitura": "...",
 *     "temperatura": "...", "chuva": "...", "chuva_forte": "...",
 *     "tempestade": "...", "vento": "...", "umidade": "...", "pressao": "...",
 *     "previsao": [...], "alertas": [...],
 *     "status": "sucesso", "metodo_leitura": "api|html|playwright|ocr|composio"
 *   }
 *
 * A leitura em si (com fallback automático entre os métodos) fica em
 * `src/lib/appa-painel.ts`. Aqui ficam os parsers testados em
 * `tests/appa-painel.test.ts`: HTML → texto, JSON embutido, endpoints da
 * página, tabelas do painel da Simport/APPA, alertas e a normalização.
 *
 * Regra desta casa: NADA aqui pode jogar erro para cima. Texto estranho vira
 * `null` (ou o objeto normalizado com "não informado"), nunca exceção — o
 * radar não pode parar por causa de uma página fora do formato.
 */

/* --------------------------------------------------------------- endereços */

/** Painel público do SIMPORT® — Dashboard Meteoceanográfico da APPA. */
export const PAINEL_APPA_URL =
  process.env.SIMPORT_PAINEL_URL?.trim() || "https://weather-appa.app.simport.com.br/";

/** API que alimenta o painel (modelo WRF, estação do porto e boletim). */
export const APPA_DADOS_API =
  process.env.APPA_DADOS_API?.trim() || "https://appa.cs.simport.com.br/api/v2/data";

/** Boletim meteorológico da APPA (calendário de eventos). */
export const APPA_BOLETIM_API =
  process.env.APPA_BOLETIM_API?.trim() || "https://wfa.app.simport.com.br/api/calendar";

/** Token que o próprio painel público envia; fica só no servidor. */
export const APPA_TOKEN = process.env.SIMPORT_AUTH_TOKEN?.trim() || "2CA5-BFD8-0F1C-597F";

/* ------------------------------------------------------------------ tipos */

/** Métodos de leitura, na ordem em que o radar tenta cada um. */
export type MetodoLeituraAppa = "api" | "html" | "playwright" | "ocr" | "composio";

/** Nome do método como aparece no cartão do administrador e nos logs. */
export const ROTULO_METODO: Record<MetodoLeituraAppa, string> = {
  api: "API/endpoint de dados",
  html: "HTTP + HTML",
  playwright: "Navegador automático",
  ocr: "OCR (captura de tela)",
  composio: "Composio",
};

/** Uma tentativa de leitura (o log de diagnóstico do radar). */
export type TentativaLeituraAppa = {
  metodo: MetodoLeituraAppa;
  rotulo: string;
  /** 1 = primeiro método tentado. */
  ordem: number;
  ok: boolean;
  /** Quando a tentativa começou (ISO). */
  em: string;
  ms: number;
  /** "ok · 1.2 mil caracteres" ou o motivo da falha. */
  motivo: string;
  caracteres: number;
  /** Detalhe extra do parser (ex.: "3 tabelas", "JSON embutido"). */
  detalhe?: string;
};

/** Números comparáveis extraídos do painel (base da detecção de mudança). */
export type NumerosPainelAppa = {
  temperatura_c: number | null;
  sensacao_c: number | null;
  umidade_pct: number | null;
  pressao_hpa: number | null;
  vento_nos: number | null;
  vento_max_nos: number | null;
  chuva_prob_max_pct: number;
  chuva_mm_24h: number;
  chuva_forte_mm: number;
  horas_com_chuva: number;
  /** 0 = céu limpo … 7 = temporal (mesma escala dos ícones do aplicativo). */
  gravidade: number;
};

export type PrevisaoHoraAppa = { hora: string; texto: string };

/**
 * FORMATO ÚNICO do painel da APPA. Todo o resto do aplicativo (radar, chat,
 * cartão do administrador) consome somente este objeto — não importa se o dado
 * veio da API, do HTML, do navegador, do OCR ou do Composio.
 */
export type DadosPainelAppa = {
  fonte: "APPA";
  timestamp_leitura: string;
  temperatura: string;
  chuva: string;
  chuva_forte: string;
  tempestade: string;
  vento: string;
  umidade: string;
  pressao: string;
  previsao: PrevisaoHoraAppa[];
  alertas: string[];
  status: "sucesso" | "falha";
  metodo_leitura: MetodoLeituraAppa | null;
  /** Data/hora da atualização informada pelo próprio painel, quando existir. */
  atualizado_em: string | null;
  numeros: NumerosPainelAppa;
};

/** Painel da Simport/APPA depois de lido (o que os parsers devolvem). */
export type PainelSimport = {
  boletim: { dia: string; texto: string }[];
  chuva: { hora: string; mm: number; prob: number }[];
  vento: { hora: string; nos: number; direcao: string }[];
  mares: { hora: string; altura: number; tipo: "alta" | "baixa" }[];
  nascerSol: string | null;
  porSol: string | null;
  /** Alertas meteorológicos citados no painel (texto curto, sem repetição). */
  alertas?: string[];
  agora: {
    temperatura: number | null;
    sensacao: number | null;
    umidade: number | null;
    ventoNos: number | null;
    direcao: string | null;
    pressao: number | null;
  };
};

/* ------------------------------------------------------------- utilidades */

const r1 = (n: number) => Math.round(n * 10) / 10;
const grau = (n: number) => `${r1(n).toString().replace(".", ",")}`;

const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
};

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const primeiro = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* -------------------------------------------------------- HTML → texto */

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", deg: "°",
  ordf: "ª", ordm: "º", aacute: "á", agrave: "à", acirc: "â", atilde: "ã",
  eacute: "é", ecirc: "ê", iacute: "í", oacute: "ó", ocirc: "ô", otilde: "õ",
  uacute: "ú", ccedil: "ç", Aacute: "Á", Atilde: "Ã", Ccedil: "Ç", hellip: "…",
  ndash: "–", mdash: "—", times: "×", minus: "−", sup2: "²", sup3: "³",
};

/** Decodifica as entidades mais comuns do painel (números inclusive). */
export function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (todo, nome) => ENTIDADES[nome] ?? todo);
}

/**
 * HTML → texto comparável, com uma célula de tabela por linha (é o formato que
 * o painel devolve pelo Composio e o que `parsearPainelSimport` entende).
 * Scripts, estilos e SVG saem fora: só interessa o que o motorista leria.
 */
export function extrairTextoDeHtml(html: string): string {
  if (!html) return "";
  const semRuido = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const comQuebras = semRuido
    .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|li|tr|h[1-6]|table|thead|tbody|tfoot|header|footer|label|span|strong|b|em)\s*>/gi, "\n")
    .replace(/<\/(?:td|th)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodificarEntidades(comQuebras)
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t\u00a0\u200b]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Quantas tabelas HTML a página traz (diagnóstico do método HTTP + HTML). */
export function contarTabelas(html: string): number {
  return (html.match(/<table\b/gi) ?? []).length;
}

/* -------------------------------------------------- JSON embutido / API */

const semEspacos = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);

/**
 * Procura JSON já embutido na página (padrão dos painéis modernos):
 * `<script type="application/json">`, `__NEXT_DATA__`, `window.__DADOS__ = {...}`.
 * É o "MÉTODO 1" da leitura: quando existe, é mais confiável que raspar HTML.
 */
export function extrairJsonEmbutido(html: string): unknown[] {
  if (!html) return [];
  const achados: unknown[] = [];
  const vistos = new Set<string>();
  const tentar = (bruto: string | undefined) => {
    const texto = (bruto ?? "").trim();
    if (texto.length < 20 || texto.length > 900_000) return;
    if (vistos.has(texto)) return; // o mesmo bloco casa em mais de um padrão
    if (!/^[[{]/.test(texto)) return;
    vistos.add(texto);
    try {
      achados.push(JSON.parse(texto));
    } catch {
      /* não era JSON válido: segue o jogo */
    }
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    tentar(m[1]);
  }
  for (const m of html.matchAll(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/gi)) tentar(m[1]);
  for (const m of html.matchAll(/__NUXT__[^>]*>([\s\S]*?)<\/script>/gi)) tentar(m[1]);
  for (const m of html.matchAll(
    /(?:window|self|globalThis)\s*\.\s*[A-Za-z_$][\w$]*\s*=\s*(\{[\s\S]{20,900000}?\}|\[[\s\S]{20,900000}?\])\s*[;<]/g,
  )) {
    tentar(m[1]);
  }
  return achados;
}

/**
 * Endpoints internos citados na página (`/api/...`, `algo.json`), sempre no
 * mesmo endereço do painel. Serve para o MÉTODO 1 tentar a fonte de dados
 * antes de raspar o HTML.
 */
export function endpointsDoHtml(html: string, base: string = PAINEL_APPA_URL): string[] {
  if (!html) return [];
  let origem: URL;
  try {
    origem = new URL(base);
  } catch {
    return [];
  }
  const achados = new Set<string>();
  const re = /["'`]((?:https?:\/\/|\/)?[A-Za-z0-9_\-./]*(?:\/api\/|\.json)[A-Za-z0-9_\-./?=&%:]*|(?:https?:\/\/)[A-Za-z0-9_\-.]+\/api\/[A-Za-z0-9_\-./?=&%:]*)[^"'`\s]*["'`]/g;
  for (const m of html.matchAll(re)) {
    const bruto = m[1].replace(/["'`\s]+$/, "");
    if (!bruto || /\.(?:js|css|png|jpe?g|svg|woff2?|ico)(?:\?|$)/i.test(bruto)) continue;
    let url: URL;
    try {
      url = new URL(bruto, origem);
    } catch {
      continue;
    }
    if (url.hostname !== origem.hostname) continue;
    if (!/\/api\/|\.json(?:$|\?)/i.test(url.pathname + url.search)) continue;
    achados.add(url.toString());
    if (achados.size >= 6) break;
  }
  return [...achados];
}

/* ----------------------------------------- números soltos em qualquer JSON */

const dentro = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

function numeroPor(o: Record<string, unknown>, re: RegExp): number | null {
  for (const [k, v] of Object.entries(o)) {
    if (!re.test(k)) continue;
    const n = typeof v === "number" ? v : typeof v === "string" ? num(v) : Number.NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function textoPor(o: Record<string, unknown>, re: RegExp): string | null {
  for (const [k, v] of Object.entries(o)) {
    if (!re.test(k)) continue;
    if (typeof v === "string" && v.trim()) return semEspacos(v);
  }
  return null;
}

const RE_CHAVE_HORA = /(hora|hour|horario|time|date|data|periodo)/i;

function horaDoObjeto(o: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(o)) {
    if (!RE_CHAVE_HORA.test(k)) continue;
    if (typeof v === "number" && v > 1_000_000_000) {
      // epoch em segundos → hora local de Brasília
      try {
        return new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(v * 1000));
      } catch {
        continue;
      }
    }
    if (typeof v === "string") {
      const hhmm = v.match(/(\d{1,2}:\d{2})/);
      if (hhmm) return hhmm[1].padStart(5, "0");
      const iso = v.match(/T(\d{2}:\d{2})/);
      if (iso) return iso[1];
    }
  }
  return null;
}

/**
 * Converte um JSON qualquer (API do painel, XHR capturado, `__NEXT_DATA__`)
 * no mesmo `PainelSimport` dos outros métodos. Só aceita número dentro de
 * faixas plausíveis — dado absurdo não vira previsão.
 */
export function painelDeJson(dados: unknown): PainelSimport | null {
  const chuva: PainelSimport["chuva"] = [];
  const vento: PainelSimport["vento"] = [];
  const alertas = new Set<string>();
  const agora: PainelSimport["agora"] = {
    temperatura: null,
    sensacao: null,
    umidade: null,
    ventoNos: null,
    direcao: null,
    pressao: null,
  };

  const anotarNumero = (chave: string, valor: number) => {
    const k = semAcento(chave);
    if (/(sensacao|feels?|apparent)/.test(k)) {
      if (dentro(valor, -15, 60) && agora.sensacao == null) agora.sensacao = valor;
      return;
    }
    if (/(temperatura|temp|temperature)/.test(k)) {
      if (dentro(valor, -15, 60) && agora.temperatura == null) agora.temperatura = valor;
      return;
    }
    if (/(umidade|humidity|umid)/.test(k)) {
      if (dentro(valor, 0, 100) && agora.umidade == null) agora.umidade = valor;
      return;
    }
    if (/(pressao|pressure|barom)/.test(k)) {
      if (dentro(valor, 850, 1100) && agora.pressao == null) agora.pressao = valor;
      return;
    }
    if (/(rajada|gust)/.test(k)) {
      if (dentro(valor, 0, 200) && (agora.ventoNos == null || valor > agora.ventoNos)) agora.ventoNos = valor;
      return;
    }
    if (/(vento|wind|nos|knot)/.test(k)) {
      if (dentro(valor, 0, 200) && agora.ventoNos == null) agora.ventoNos = valor;
    }
  };

  const visitar = (no: unknown, chave: string, profundidade: number) => {
    if (profundidade > 9 || no == null) return;
    if (Array.isArray(no)) {
      for (const item of no.slice(0, 400)) visitar(item, chave, profundidade + 1);
      return;
    }
    if (typeof no === "object") {
      const o = no as Record<string, unknown>;
      const hora = horaDoObjeto(o);
      if (hora) {
        const mm = numeroPor(o, /(precip|chuva|rain|mm)/i);
        const prob = numeroPor(o, /(prob|chance|percent|%)/i);
        const nos = numeroPor(o, /(vento|wind|nos|knot)/i);
        const direcao = textoPor(o, /(direcao|direction|dir)/i);
        if (dentro(mm ?? Number.NaN, 0, 500) || dentro(prob ?? Number.NaN, 0, 100)) {
          chuva.push({ hora, mm: dentro(mm ?? Number.NaN, 0, 500) ? (mm as number) : 0, prob: dentro(prob ?? Number.NaN, 0, 100) ? (prob as number) : 0 });
        }
        if (dentro(nos ?? Number.NaN, 0, 200)) {
          vento.push({ hora, nos: nos as number, direcao: (direcao ?? "").toUpperCase().slice(0, 3) });
        }
        if (chuva.length > 200 && vento.length > 200) return;
      }
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "number") anotarNumero(k, v);
        else if (typeof v === "string") {
          if (/(alerta|aviso|warning|advertencia)/i.test(k) && v.trim().length > 6) alertas.add(semEspacos(v));
        }
        visitar(v, k, profundidade + 1);
      }
      return;
    }
    if (typeof no === "number") anotarNumero(chave, no);
    if (typeof no === "string" && /(alerta|aviso|warning)/i.test(chave) && no.trim().length > 6) {
      alertas.add(semEspacos(no));
    }
  };

  visitar(dados, "", 0);

  const temAlgo =
    chuva.length > 0 ||
    vento.length > 0 ||
    agora.temperatura != null ||
    agora.umidade != null ||
    agora.pressao != null ||
    alertas.size > 0;
  if (!temAlgo) return null;

  return {
    boletim: [],
    chuva: chuva.slice(0, 48),
    vento: vento.slice(0, 48),
    mares: [],
    nascerSol: null,
    porSol: null,
    alertas: [...alertas].slice(0, 6),
    agora,
  };
}

/* ------------------------------------------------- texto do painel (Simport) */

const RE_HORA = /^\d{1,2}:\d{2}$/;
const RE_DIRECAO =
  /^(N|NNE|NNO|NE|ENE|E|ESE|SE|SSE|S|SSO|SSW|SO|SW|WSW|OSO|OSW|W|O|ONO|WNW|NW|NNW|L)$/i;

const PALAVRAS_ALERTA =
  /(alerta|aviso|aten[çc][ãa]o|perigo|risco|tempestade|trovoada|trov[ãa]o|descarga|raio|granizo|vendaval|rajada forte|chuva forte|temporal|ventania|ressaca|mar grosso|neblina densa)/i;

/**
 * Alerta que merece notificação que FICA NA TELA até o motorista tocar
 * (chuva forte, tempestade, vendaval). Usado pelo radar ao comparar leituras.
 */
export const ALERTA_GRAVE =
  /(tempestade|trovoada|trov[ãa]o|descarga|granizo|vendaval|temporal|chuva forte|rajada forte|ressaca|mar grosso)/i;

const PALAVRAS_GRAVES = ALERTA_GRAVE;

/** Extrai alertas meteorológicos citados no texto (frases curtas, sem repetir). */
export function extrairAlertas(texto: string, limite = 6): string[] {
  if (!texto) return [];
  const achados: string[] = [];
  const vistos = new Set<string>();
  const frases = texto
    .split(/\r?\n|(?<=[.!?])\s+/g)
    .map((f) => f.replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim())
    .filter((f) => f.length >= 12 && f.length <= 220);
  for (const frase of frases) {
    if (!PALAVRAS_ALERTA.test(frase)) continue;
    const chave = semAcento(frase);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    achados.push(frase.replace(/[.;\s]+$/, ""));
    if (achados.length >= limite) break;
  }
  return achados;
}

/** Data/hora de atualização informada pelo painel (texto cru), quando existir. */
export function extrairAtualizacao(texto: string): string | null {
  if (!texto) return null;
  const comData = texto.match(
    /(?:atualizad[oa]|atualiza[çc][ãa]o|[úu]ltima leitura|leitura de)[^\d]{0,24}(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s*(?:[àa]s?|,)?\s*\d{1,2}:\d{2})?)/i,
  );
  if (comData) return comData[1];
  const soHora = texto.match(/(?:atualizad[oa]|atualiza[çc][ãa]o)[^\d]{0,24}(\d{1,2}:\d{2}(?::\d{2})?)/i);
  return soHora ? soHora[1] : null;
}

/**
 * Texto (markdown/HTML já convertido em linhas) do painel da Simport → dados
 * comparáveis. O painel separa cada célula em uma linha e às vezes cola tudo
 * ("02:001.2mAlta"), então a leitura é por seção e tolerante a layout.
 */
export function parsearPainelSimport(bruto: string): PainelSimport | null {
  if (!bruto || bruto.trim().length < 60) return null;
  const linhas = bruto
    .split(/\r?\n/)
    .map((l) => l.replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (linhas.length < 5) return null;

  const acha = (re: RegExp) => linhas.findIndex((l) => re.test(l));
  const fimDaSecao = (inicio: number, ...marcos: number[]) => {
    const proximos = marcos.filter((m) => m > inicio);
    return proximos.length ? Math.min(...proximos) : linhas.length;
  };

  const iChuva = acha(/previs[ãa]o de chuvas/i);
  const iVento = acha(/previs[ãa]o de ventos/i);
  const iMares = acha(/previs[ãa]o de mar[ée]s/i);
  const iLua = acha(/fases da lua/i);
  const iMapa = acha(/mapa de localiza/i);
  const iDiaVento = acha(/dire[çc][ãa]o do vento durante o dia/i);

  /* ------------------------------------------ tabela de chuva (24 h) */
  const chuva: PainelSimport["chuva"] = [];
  if (iChuva >= 0) {
    const ate = fimDaSecao(iChuva, iVento, iMares, iLua, iMapa);
    for (let i = iChuva + 1; i < ate; i++) {
      if (!RE_HORA.test(linhas[i])) continue;
      let mm = Number.NaN;
      let prob = Number.NaN;
      for (let j = i + 1; j < Math.min(i + 5, ate); j++) {
        if (RE_HORA.test(linhas[j])) break;
        const m = linhas[j].match(/([\d.,]+)\s*mm/i);
        if (m && Number.isNaN(mm)) mm = num(m[1]);
        const p = linhas[j].match(/(\d+)\s*%/);
        if (p && Number.isNaN(prob)) prob = Number(p[1]);
      }
      if (Number.isFinite(mm) || Number.isFinite(prob)) {
        chuva.push({ hora: linhas[i], mm: Number.isFinite(mm) ? mm : 0, prob: Number.isFinite(prob) ? prob : 0 });
      }
    }
  }

  /* ------------------------------------------ tabela de vento (24 h) */
  const vento: PainelSimport["vento"] = [];
  if (iVento >= 0) {
    const ate = fimDaSecao(iVento, iDiaVento, iMares, iLua, iMapa);
    for (let i = iVento + 1; i < ate; i++) {
      if (!RE_HORA.test(linhas[i])) continue;
      let nos = Number.NaN;
      let direcao = "";
      for (let j = i + 1; j < Math.min(i + 4, ate); j++) {
        if (RE_HORA.test(linhas[j])) break;
        const n = linhas[j].match(/([\d.,]+)\s*n[óo]s/i);
        if (n && Number.isNaN(nos)) nos = num(n[1]);
        const d = linhas[j].trim().match(RE_DIRECAO);
        if (d && !direcao) direcao = d[1].toUpperCase();
      }
      if (Number.isFinite(nos)) vento.push({ hora: linhas[i], nos, direcao });
    }
  }

  /* ------------------------------------------------------ marés */
  const mares: PainelSimport["mares"] = [];
  if (iMares >= 0) {
    const ate = fimDaSecao(iMares, iLua, iMapa);
    for (let i = iMares + 1; i < ate; i++) {
      // Formato colado do painel: "02:001.2mAlta".
      const cola = linhas[i].match(/(\d{1,2}:\d{2})\s*([\d.,]+)\s*m\s*(alta|baixa)/i);
      if (cola) {
        mares.push({
          hora: cola[1],
          altura: num(cola[2]),
          tipo: cola[3].toLowerCase() === "alta" ? "alta" : "baixa",
        });
        continue;
      }
      if (!RE_HORA.test(linhas[i])) continue;
      let altura = Number.NaN;
      let tipo = "";
      for (let j = i + 1; j < Math.min(i + 4, ate); j++) {
        if (RE_HORA.test(linhas[j])) break;
        const a = linhas[j].match(/([\d.,]+)\s*m\b/i);
        if (a && Number.isNaN(altura)) altura = num(a[1]);
        const t = linhas[j].match(/\b(alta|baixa)\b/i);
        if (t && !tipo) tipo = t[1].toLowerCase();
      }
      if (Number.isFinite(altura) && tipo) {
        mares.push({ hora: linhas[i], altura, tipo: tipo === "alta" ? "alta" : "baixa" });
      }
    }
  }

  /* ------------------------------------- nascer/pôr do sol e boletim */
  const horaPerto = (re: RegExp) => {
    const i = acha(re);
    if (i < 0) return null;
    const naLinha = linhas[i].match(/(\d{1,2}:\d{2})/);
    if (naLinha) return naLinha[1];
    for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
      if (RE_HORA.test(linhas[j])) return linhas[j];
    }
    return null;
  };
  const nascerSol = horaPerto(/nascer do sol/i);
  const porSol = horaPerto(/p[ôo]r do sol/i);

  const boletim: PainelSimport["boletim"] = [];
  const reBoletim =
    /^(seg|ter|qua|qui|sex|s[áa]b|sab|dom)[a-zçã]*\.?\s*\((\d{1,2}\/\d{1,2})\)\s*:?\s*(.*)$/i;
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(reBoletim);
    if (!m) continue;
    const texto = (m[3] ?? "").trim() || (linhas[i + 1] ?? "").trim();
    if (texto.length > 15) boletim.push({ dia: `${m[2]}`, texto });
  }

  /* --------------------------------------- medições do topo do painel */
  const valorPerto = (rotulo: RegExp, extrai: RegExp): number | null => {
    const i = acha(rotulo);
    if (i < 0) return null;
    for (const c of [linhas[i], linhas[i - 1], linhas[i + 1], linhas[i - 2], linhas[i + 2]]) {
      const m = c?.match(extrai);
      if (m) {
        const n = num(m[1]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };
  const linhaGraus = linhas.slice(0, 20).find((l) => /^-?[\d.,]+\s*°\s*C$/.test(l));
  const temperatura = linhaGraus ? num(linhaGraus) : null;
  // Vento atual: o primeiro "nós" antes da tabela de previsão de ventos.
  const iVentoAtual = linhas.findIndex(
    (l, i) => (iVento < 0 || i < iVento) && /[\d.,]+\s*n[óo]s/i.test(l),
  );
  const ventoAtual =
    iVentoAtual >= 0 ? num((linhas[iVentoAtual].match(/([\d.,]+)\s*n[óo]s/i) ?? [])[1] ?? "") : null;
  const direcaoAtual =
    iVentoAtual >= 0
      ? (linhas
          .slice(iVentoAtual + 1, iVentoAtual + 3)
          .find((l) => RE_DIRECAO.test(l.trim())) ?? null)
      : null;

  return {
    boletim,
    chuva,
    vento,
    mares,
    nascerSol,
    porSol,
    alertas: extrairAlertas(bruto),
    agora: {
      temperatura: Number.isFinite(temperatura ?? Number.NaN) ? temperatura : null,
      sensacao: valorPerto(/sensa[çc][ãa]o t[ée]rmica/i, /(-?[\d.,]+)\s*°?\s*C/i),
      umidade: valorPerto(/^umidade\b|umidade\s*:/i, /([\d.,]+)\s*%/),
      ventoNos: Number.isFinite(ventoAtual ?? Number.NaN) ? ventoAtual : null,
      direcao: direcaoAtual ? direcaoAtual.toUpperCase() : null,
      pressao: valorPerto(/^press[ãa]o\b|press[ãa]o\s*:/i, /([\d.,]+)/),
    },
  };
}

/**
 * Garimpa rótulos soltos ("Umidade 90%", "Vento 12 nós", "14:00 … 6,4 mm … 92%").
 * É o plano B do texto que não tem o layout completo do painel: OCR, HTML
 * parcial, API pequena ou página com o conteúdo principal fora das tabelas.
 */
export function extrairCamposSoltos(bruto: string): PainelSimport | null {
  const texto = (bruto ?? "").replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim();
  if (texto.length < 12) return null;

  const perto = (re: RegExp, extrai: RegExp): number | null => {
    const janela = texto.match(re);
    if (!janela) return null;
    const m = janela[0].match(extrai);
    if (!m) return null;
    const n = num(m[1]);
    return Number.isFinite(n) ? n : null;
  };
  const temperatura = perto(/(?:temperatura|temp\.?)\D{0,12}?-?\d{1,2}(?:[.,]\d)?\s*°?\s*C/i, /(-?\d{1,2}(?:[.,]\d)?)/);
  const umidade = perto(/umidade\D{0,12}?\d{1,3}\s*%/i, /(\d{1,3})\s*%/);
  const pressao = perto(/press[ãa]o\D{0,12}?\d{3,4}/i, /(\d{3,4})/);
  const ventoNos = perto(/(?:vento|rajada)\D{0,12}?\d{1,3}(?:[.,]\d)?\s*n[óo]s/i, /(\d{1,3}(?:[.,]\d)?)/);
  const direcao = (texto.match(/\b(NNE|NNO|ENE|ESE|SSE|SSO|WSW|WNW|OSO|ONO|NNW|SW|NE|SE|NW|NW|SSW|N|S|E|W|O|L)\b/i) ?? [])[0] ?? null;
  const alertas = extrairAlertas(bruto);

  // Horas com chuva/vento soltas: "14:00 ... 6,4 mm ... 92%".
  const chuva: PainelSimport["chuva"] = [];
  const vento: PainelSimport["vento"] = [];
  for (const m of bruto.matchAll(/(\d{1,2}:\d{2})[\s\S]{0,24}?([\d.,]+)\s*mm([\s\S]{0,20}?(\d{1,3})\s*%)?/g)) {
    chuva.push({
      hora: m[1],
      mm: Number.isFinite(num(m[2])) ? num(m[2]) : 0,
      prob: m[4] ? Number(m[4]) : 0,
    });
    if (chuva.length >= 24) break;
  }
  for (const m of bruto.matchAll(/(\d{1,2}:\d{2})[\s\S]{0,24}?([\d.,]+)\s*n[óo]s([\s\S]{0,16}?([A-Za-z]{1,3})\b)?/g)) {
    const d = (m[4] ?? "").toUpperCase();
    vento.push({ hora: m[1], nos: num(m[2]), direcao: RE_DIRECAO.test(d) ? d : "" });
    if (vento.length >= 24) break;
  }

  const temAlgo =
    temperatura != null ||
    umidade != null ||
    pressao != null ||
    ventoNos != null ||
    chuva.length > 0 ||
    vento.length > 0 ||
    alertas.length > 0;
  if (!temAlgo) return null;

  return {
    boletim: [],
    chuva,
    vento,
    mares: [],
    nascerSol: null,
    porSol: null,
    alertas,
    agora: {
      temperatura,
      sensacao: null,
      umidade,
      ventoNos,
      direcao: direcao ? direcao.toUpperCase() : null,
      pressao,
    },
  };
}

/**
 * Leitura tolerante, para quando o texto NÃO é o do painel completo (OCR de
 * captura de tela, HTML parcial, API pequena): usa o parser completo e
 * completa o que faltar com os campos soltos — o painel muda de layout sem
 * derrubar o radar.
 */
export function parsearPainelLivre(bruto: string): PainelSimport | null {
  const completo = parsearPainelSimport(bruto);
  const solto = extrairCamposSoltos(bruto);
  if (!completo) return solto;
  if (!solto) return completo;
  const juntar = <T>(a: T[], b: T[]) => (a.length ? a : b);
  return {
    ...completo,
    chuva: juntar(completo.chuva, solto.chuva),
    vento: juntar(completo.vento, solto.vento),
    alertas: [...new Set([...(completo.alertas ?? []), ...(solto.alertas ?? [])])].slice(0, 6),
    agora: {
      temperatura: completo.agora.temperatura ?? solto.agora.temperatura,
      sensacao: completo.agora.sensacao ?? solto.agora.sensacao,
      umidade: completo.agora.umidade ?? solto.agora.umidade,
      ventoNos: completo.agora.ventoNos ?? solto.agora.ventoNos,
      direcao: completo.agora.direcao ?? solto.agora.direcao,
      pressao: completo.agora.pressao ?? solto.agora.pressao,
    },
  };
}

/* ---------------------------------------------------------- normalização */

const VAZIO: DadosPainelAppa = {
  fonte: "APPA",
  timestamp_leitura: new Date(0).toISOString(),
  temperatura: "não informado",
  chuva: "não informado",
  chuva_forte: "não informado",
  tempestade: "não informado",
  vento: "não informado",
  umidade: "não informado",
  pressao: "não informado",
  previsao: [],
  alertas: [],
  status: "falha",
  metodo_leitura: null,
  atualizado_em: null,
  numeros: {
    temperatura_c: null,
    sensacao_c: null,
    umidade_pct: null,
    pressao_hpa: null,
    vento_nos: null,
    vento_max_nos: null,
    chuva_prob_max_pct: 0,
    chuva_mm_24h: 0,
    chuva_forte_mm: 0,
    horas_com_chuva: 0,
    gravidade: 0,
  },
};

/** Objeto normalizado de uma leitura que falhou (todos os métodos). */
export function leituraFalha(em: number = Date.now()): DadosPainelAppa {
  return { ...VAZIO, timestamp_leitura: new Date(em).toISOString() };
}

/** O painel trouxe alguma informação útil? */
export function temDadosPainel(p: PainelSimport | null | undefined): boolean {
  if (!p) return false;
  return Boolean(
    p.chuva.length ||
      p.vento.length ||
      p.mares.length ||
      p.boletim.length ||
      (p.alertas?.length ?? 0) ||
      p.agora.temperatura != null ||
      p.agora.umidade != null ||
      p.agora.pressao != null ||
      p.agora.ventoNos != null,
  );
}

/** Gravidade do painel (0 céu limpo … 7 temporal), na escala dos ícones. */
export function gravidadeDoPainel(p: PainelSimport, alertas: string[]): number {
  const texto = [...alertas, ...p.boletim.map((b) => b.texto)].join(" ").toLowerCase();
  if (/temporal|tempestade|trovoada|trov[ãa]o|descarga|granizo/.test(texto)) return 7;
  const forte = Math.max(0, ...p.chuva.map((c) => c.mm));
  if (forte >= 4) return 6;
  const alguma = Math.max(0, ...p.chuva.map((c) => c.mm));
  const prob = Math.max(0, ...p.chuva.map((c) => c.prob));
  if (alguma >= 1 || prob >= 60) return 5;
  if (alguma >= 0.1 || prob >= 30) return 4;
  if (p.chuva.length || p.agora.umidade != null) return 2;
  return 1;
}

/**
 * Primeiro horário com chuva prevista no painel (`null` quando não há).
 * É o "início da chuva" que o radar compara para avisar quando o horário muda.
 */
export function inicioDaChuva(p: PainelSimport | null | undefined): string | null {
  if (!p) return null;
  const comChuva = p.chuva
    .filter((c) => c.mm >= 0.1 || c.prob >= 50)
    .map((c) => c.hora)
    .sort((a, b) => a.localeCompare(b));
  return comChuva[0] ?? null;
}

/** Primeiro horário de chuva FORTE (≥ 4 mm) no painel, se houver. */
export function horaDaChuvaForte(p: PainelSimport | null | undefined): string | null {
  if (!p) return null;
  const forte = p.chuva.filter((c) => c.mm >= 4).map((c) => c.hora).sort((a, b) => a.localeCompare(b));
  return forte[0] ?? null;
}

/** Condição resumida do painel, em texto curto (usada na detecção de mudança). */
export function condicaoDoPainel(p: PainelSimport, alertas: string[]): string {
  const g = gravidadeDoPainel(p, alertas);
  if (g >= 7) return "tempestade";
  if (g === 6) return "chuva forte";
  if (g === 5) return "chuva";
  if (g === 4) return "garoa/chuva fraca";
  if (!p.chuva.length) return "sem previsão de chuva";
  return "sem chuva relevante";
}

function numerosDoPainel(p: PainelSimport, alertas: string[]): NumerosPainelAppa {
  const comChuva = p.chuva.filter((c) => c.mm >= 0.1 || c.prob >= 30);
  return {
    temperatura_c: p.agora.temperatura,
    sensacao_c: p.agora.sensacao,
    umidade_pct: p.agora.umidade,
    pressao_hpa: p.agora.pressao,
    vento_nos: p.agora.ventoNos,
    vento_max_nos: p.vento.length ? r1(Math.max(...p.vento.map((v) => v.nos))) : null,
    chuva_prob_max_pct: p.chuva.length ? Math.round(Math.max(...p.chuva.map((c) => c.prob))) : 0,
    chuva_mm_24h: r1(p.chuva.reduce((s, c) => s + c.mm, 0)),
    chuva_forte_mm: r1(Math.max(0, ...p.chuva.map((c) => c.mm))),
    horas_com_chuva: comChuva.length,
    gravidade: gravidadeDoPainel(p, alertas),
  };
}

const mm = (n: number) => `${grau(n)} mm`;

function textoDaChuva(p: PainelSimport): string {
  const comChuva = p.chuva.filter((c) => c.mm >= 0.1 || c.prob >= 30);
  if (!comChuva.length) {
    const prob = p.chuva.length ? Math.round(Math.max(...p.chuva.map((c) => c.prob))) : 0;
    return `sem chuva prevista nas próximas 24 h (máx ${prob}%)`;
  }
  const prob = Math.round(Math.max(...comChuva.map((c) => c.prob)));
  const total = r1(p.chuva.reduce((s, c) => s + c.mm, 0));
  return `chuva prevista entre ${comChuva[0].hora} e ${comChuva[comChuva.length - 1].hora} (máx ${prob}% · ${mm(total)} em 24 h)`;
}

function textoDaChuvaForte(p: PainelSimport): string {
  const forte = p.chuva.filter((c) => c.mm >= 4);
  if (!forte.length) return "sem chuva forte prevista";
  const pior = forte.reduce((a, b) => (b.mm > a.mm ? b : a), forte[0]);
  return `chuva forte às ${pior.hora} (${mm(pior.mm)} · ${Math.round(pior.prob)}%)`;
}

function textoDaTempestade(p: PainelSimport, alertas: string[]): string {
  const noAlerta = alertas.find((a) => /temporal|tempestade|trovoada|trov[ãa]o|descarga|granizo|vendaval/i.test(a));
  if (noAlerta) return `risco citado no painel: ${noAlerta.slice(0, 160)}`;
  const noBoletim = p.boletim.find((b) => /temporal|tempestade|trovoada|trov[ãa]o|descarga|granizo/i.test(b.texto));
  if (noBoletim) return `boletim da APPA (${noBoletim.dia}): ${noBoletim.texto.slice(0, 160)}`;
  return "sem tempestade prevista";
}

function textoDoVento(p: PainelSimport): string {
  if (p.vento.length) {
    const pior = p.vento.reduce((a, b) => (b.nos > a.nos ? b : a), p.vento[0]);
    const direcao = pior.direcao ? `${pior.direcao} ` : "";
    const agora = p.agora.ventoNos != null ? ` · agora ${grau(p.agora.ventoNos)} nós` : "";
    return `${direcao}até ${grau(pior.nos)} nós em 24 h${agora}`;
  }
  if (p.agora.ventoNos != null) {
    return `${p.agora.direcao ? `${p.agora.direcao} ` : ""}${grau(p.agora.ventoNos)} nós agora`;
  }
  return "não informado";
}

function textoDaTemperatura(p: PainelSimport): string {
  if (p.agora.temperatura == null) return "não informado";
  const sensacao =
    p.agora.sensacao != null && Math.abs(p.agora.sensacao - p.agora.temperatura) >= 1
      ? ` (sensação ${grau(p.agora.sensacao)} °C)`
      : "";
  return `${grau(p.agora.temperatura)} °C${sensacao}`;
}

function previsaoDoPainel(p: PainelSimport): PrevisaoHoraAppa[] {
  const itens: PrevisaoHoraAppa[] = [
    ...p.chuva.map((c) => ({
      hora: c.hora,
      texto: `chuva ${mm(c.mm)} · ${Math.round(c.prob)}%`,
    })),
    ...p.vento.map((v) => ({
      hora: v.hora,
      texto: `vento ${grau(v.nos)} nós${v.direcao ? ` ${v.direcao}` : ""}`,
    })),
  ];
  const vistos = new Set<string>();
  return itens
    .filter((i) => {
      const k = `${i.hora}|${i.texto}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .sort((a, b) => a.hora.localeCompare(b.hora))
    .slice(0, 24);
}

/**
 * Painel lido → FORMATO ÚNICO. É esta função que o radar, o chat e o cartão
 * do administrador consomem, independentemente do método que leu o painel.
 */
export function normalizarPainelAppa(
  p: PainelSimport | null,
  opcoes: {
    metodo: MetodoLeituraAppa | null;
    agora?: number;
    textoBruto?: string;
    alertasExtras?: string[];
  },
): DadosPainelAppa {
  const em = opcoes.agora ?? Date.now();
  const bruto = opcoes.textoBruto ?? "";
  const alertas = [
    ...new Set([...(p?.alertas ?? []), ...(opcoes.alertasExtras ?? [])].map((a) => a.trim()).filter(Boolean)),
  ].slice(0, 8);
  if (!p || !temDadosPainel(p)) {
    // O método até pode ter lido a página, mas sem dado meteorológico útil a
    // leitura NÃO conta como sucesso: o radar tenta o próximo método.
    return {
      ...VAZIO,
      timestamp_leitura: new Date(em).toISOString(),
      alertas,
      status: "falha",
      metodo_leitura: opcoes.metodo,
      atualizado_em: extrairAtualizacao(bruto),
    };
  }
  return {
    fonte: "APPA",
    timestamp_leitura: new Date(em).toISOString(),
    temperatura: textoDaTemperatura(p),
    chuva: textoDaChuva(p),
    chuva_forte: textoDaChuvaForte(p),
    tempestade: textoDaTempestade(p, alertas),
    vento: textoDoVento(p),
    umidade: p.agora.umidade != null ? `${Math.round(p.agora.umidade)}%` : "não informado",
    pressao: p.agora.pressao != null ? `${Math.round(p.agora.pressao)} hPa` : "não informado",
    previsao: previsaoDoPainel(p),
    alertas,
    // Chegou aqui com dado meteorológico útil: a leitura vale, mesmo quando o
    // método não é informado (ex.: painel guardado antes desta versão).
    status: "sucesso",
    metodo_leitura: opcoes.metodo,
    atualizado_em: extrairAtualizacao(bruto),
    numeros: numerosDoPainel(p, alertas),
  };
}

/** Uma linha curta com o essencial da leitura (aparece no chat e no cartão). */
export function resumoLeituraAppa(d: DadosPainelAppa): string {
  // Esta frase só existe para uma leitura em que TODOS os métodos falharam:
  // o cartão mostra "Painel APPA: conectado" em qualquer outro caso.
  if (d.status !== "sucesso") return "painel da APPA não lido por nenhum método";
  const partes = [primeiro(d.chuva), `vento ${d.vento}`, `temp. ${d.temperatura}`];
  if (d.alertas.length) partes.push(`${d.alertas.length} alerta(s) no painel`);
  return partes.join(" · ");
}
