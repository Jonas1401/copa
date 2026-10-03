/**
 * Utilitários de texto da leitura do painel da APPA (puros, sem rede nem banco):
 * HTML → texto, entidades, comparação aproximada e reparo de erros típicos de OCR.
 */

/** Sem acentos e sem diacríticos ("Previsão" → "Previsao"). */
export const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ordm: "º", ordf: "ª", deg: "°", middot: "·", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä", eacute: "é", egrave: "è", ecirc: "ê",
  iacute: "í", icirc: "î", oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", uacute: "ú", ucirc: "û",
  uuml: "ü", ccedil: "ç", ntilde: "ñ",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Eacute: "É", Ecirc: "Ê", Iacute: "Í", Oacute: "Ó",
  Ocirc: "Ô", Otilde: "Õ", Uacute: "Ú", Ccedil: "Ç",
};

/** Troca `&amp;`, `&nbsp;`, `&#233;`, `&#xE9;`… pelo caractere. */
export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cod = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cod) && cod > 0 && cod < 0x110000 ? String.fromCodePoint(cod) : m;
    }
    return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** Tira as marcas HTML de um trecho (ex.: `<strong>Atenção</strong>: ...`) e junta os espaços. */
export function semHtml(s: string): string {
  return decodificarEntidades(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const BLOCOS =
  "p|div|section|article|header|footer|main|aside|nav|ul|ol|li|tr|table|thead|tbody|tfoot|h[1-6]|dl|dt|dd|form|fieldset|figure|figcaption|blockquote|pre|td|th|caption|label|option";

/**
 * HTML → texto, uma célula/bloco por linha (o mesmo formato que o parser do
 * painel espera: tabelas viram uma linha por célula). Ignora scripts, estilos,
 * `<noscript>` (a mensagem "ative o JavaScript") e SVG.
 */
export function htmlParaTexto(html: string): string {
  const t = decodificarEntidades(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|svg|noscript|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(new RegExp(`</?(?:${BLOCOS})\\b[^>]*>`, "gi"), "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return t
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Palavras (3+ letras, sem acento) de um texto, para comparar sem se prender à formatação. */
function palavras(s: string) {
  return new Set(
    semAcento(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
}

/**
 * Semelhança entre dois textos (0 a 1), por palavras em comum. Serve para não
 * tratar como "boletim revisado" o mesmo texto lido por dois métodos (o OCR e o
 * HTML nunca erram igual).
 */
export function similaridade(a: string, b: string): number {
  const A = palavras(a);
  const B = palavras(b);
  if (!A.size && !B.size) return 1;
  let comum = 0;
  for (const w of A) if (B.has(w)) comum++;
  return comum / (A.size + B.size - comum);
}

/* ------------------------------------------------------------------ OCR */
const DIGITO_OCR: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", "|": "1" };
const digito = (c: string) => DIGITO_OCR[c] ?? c;

/**
 * Corrige os erros mais comuns do OCR numa linha do painel: grau (`19ºC`,
 * `19*C`), zero lido como letra O (`O nós`, `O.2 mm`, `O8:00`), "nós" mal lido
 * e a vírgula/ponto decimal que some (`30onós` = `3.0 nós`). Só mexe em
 * contextos numéricos para não estragar palavras.
 */
export function repararOcr(linha: string): string {
  let l = linha;
  // Linhas de tabela/cartão são curtas; texto corrido (boletim) não leva os reparos de unidade.
  const curta = l.length <= 48;
  // 19ºC, 19˚C, 19*C, 19 °c  →  19°C
  l = l.replace(/(\d)\s*[º˚*°]\s*[cC]\b/g, "$1°C");
  // Horários: O8:00, 1O:30, 08:O0, l4:00
  l = l.replace(/\b([0-2OoIl])([0-9OoIl]):([0-5OoIl])([0-9OoIl])\b/g, (_m, a, b, c, d) =>
    `${digito(a)}${digito(b)}:${digito(c)}${digito(d)}`,
  );
  // Zero lido como O: entre dígitos, antes de decimal ou antes da unidade.
  l = l.replace(/(?<=\d)[Oo](?=\d)/g, "0");
  l = l.replace(/(?<=\d)[Oo](?=\s*(?:%|mm\b|°))/g, "0"); // 7O% · 1O mm · 2O°C
  l = l.replace(/(?<![\p{L}\d])[Oo](?=[.,]\d)/gu, "0");
  if (curta) {
    l = l.replace(/(?<![\p{L}\d])[Oo](?=\s*(?:mm\b|n[óo0ô6]s\b|%))/giu, "0");
    // "30onós": o ponto decimal virou "o" e colou na unidade.
    l = l.replace(/(\d)[Oo](?=\s*n[óo0ô6]s\b)/gi, "$1");
    // nós: nos, n6s, nõs, nés… quando vem logo depois de um número.
    l = l.replace(/(\d)\s*n[óo0ôõö6é]s\b/gi, "$1 nós");
    // mm: rnm, mrn, mn colados a um número.
    l = l.replace(/(\d)\s*(?:rnm|mrn|mn)\b/gi, "$1 mm");
  }
  // "<0.1 mm": o OCR cola o "<" no número; mantemos o sinal e o espaço.
  l = l.replace(/([<≤])\s*(\d)/g, "$1 $2");
  return l.replace(/\s+/g, " ").trim();
}

/** Número em português: 1,5 · 12 · 0,3 (sem zeros inúteis). */
export const fmtNum = (n: number, casas = 1) => {
  const f = Number(n.toFixed(casas));
  return String(f).replace(".", ",");
};

/** Escapa texto para uso dentro de uma RegExp. */
export const escaparRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
