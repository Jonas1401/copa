/**
 * Navios nos portos de Paranaguá e Antonina — SOMENTE servidor.
 *
 * Fontes:
 *  - APPA (line-up): berço, mercadoria, toneladas, chegada, ETA/ETB, atracação.
 *  - SINPRAPAR (manobras previstas da praticagem): hora da manobra, calado e
 *    se está confirmada.
 *  - Maré: Open-Meteo Marine (nível do mar hora a hora na baía de Paranaguá),
 *    usado só como referência para analisar a janela de manobra.
 *
 * Foco: navios de FERTILIZANTES (ureia, MAP, DAP, KCl, sulfato de amônio,
 * nitratos, NPK, superfosfatos, rocha fosfática…). As funções de leitura do
 * HTML são puras e testadas em tests/navios.test.ts.
 */

export const URL_LINEUP = "https://www.appaweb.appa.pr.gov.br/appaweb/pesquisa.aspx?WCI=relLineUpRetroativo";
export const URL_MANOBRAS = "https://www.sinprapar.com.br/PREV.HTM";
const URL_MARE =
  "https://marine-api.open-meteo.com/v1/marine?latitude=-25.52&longitude=-48.50&hourly=sea_level_height_msl&timezone=America%2FSao_Paulo&forecast_days=3";

export type SecaoLineup =
  | "ATRACADOS" | "PROGRAMADOS" | "AO LARGO PARA REATRACAÇÃO" | "AO LARGO" | "ESPERADOS" | "DESPACHADOS" | string;

export type NavioLineup = {
  programacao: string;
  secao: SecaoLineup;
  porto: "Paranaguá" | "Antonina";
  berco: string;
  nome: string;
  imo: string;
  dwt: string;
  sentido: string; // Imp | Exp | Imp/Exp
  mercadoria: string;
  /** Toneladas previstas da operação (null quando é contêiner/movimentos). */
  toneladas: number | null;
  /** Saldo que ainda falta operar (só atracados). */
  saldoToneladas: number | null;
  chegada: string;
  eta: string;
  etb: string;
  atracacao: string;
  agencia: string;
  operador: string;
};

export type Manobra = {
  data: string; // dd/mm
  hora: string; // hh:mm
  navio: string;
  manobra: string; // ex.: "AT: F93/AZ0304 BB"
  codigo: string; // EA | AT | EF | DS | DF | …
  descricao: string;
  calado: number | null; // metros
  imo: string;
  situacao: string; // CONFIRMADA | A CONFIRMAR | PREVISTA | PRÁTICO NA LANCHA
};

export type Mare = { hora: string; tipo: "preamar" | "baixa-mar"; alturaM: number };

/* ------------------------------------------------------------ fertilizantes */
const FERTILIZANTE = new RegExp(
  [
    "FERTILIZ", "ADUBO", "UREIA", "URÉIA",
    "SULFATO DE AMONIO", "SULFATO DE AMÔNIO", "SULFATO DE POTASSIO", "SULFATO DE POTÁSSIO",
    "NITRATO", "CLORETOS? DE POTASSIO", "CLORETOS? DE POTÁSSIO", "\\bKCL\\b", "POTASSA",
    "\\bMAP\\b", "\\bDAP\\b", "\\bTSP\\b", "\\bSSP\\b", "\\bNPK\\b",
    "SUPERFOSFATO", "FOSFATO (MONO|DI)?AM", "FOSFATOS? DE (MONO|DI)?AM", "ROCHA FOSF", "FOSFATO NATURAL",
  ].join("|"),
  "i",
);

export const ehFertilizante = (mercadoria: string) => FERTILIZANTE.test(mercadoria);

/**
 * Berço realmente definido pela APPA? ("", "-", "A DEFINIR", "?" = ainda não).
 * Só avisamos atracação programada quando existe berço de verdade.
 */
export function bercoDefinido(berco: string | null | undefined): boolean {
  const b = (berco ?? "").trim();
  if (!b || /^[-?.]+$/.test(b) || /A\s*DEF|INDEF|N[ÃA]O\s*DEF/i.test(b)) return false;
  return /\d/.test(b);
}

/** Porto pelo número do berço (APPA: 4xx = Antonina). */
export const portoDoBerco = (berco: string): "Paranaguá" | "Antonina" => (/^4\d\d$/.test(berco.trim()) ? "Antonina" : "Paranaguá");

/* ----------------------------------------------------------------- leitura */
const limpar = (x: string) =>
  x.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();

/** "60.000,000 Tons." → 60000 ; "900 Movs." → null */
export function toneladasDe(texto: string | undefined): number | null {
  if (!texto || !/ton/i.test(texto)) return null;
  const m = texto.match(/[\d.]+(?:,\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Line-up da APPA (HTML) → lista de navios de todas as seções. */
export function parseLineupAppa(html: string): NavioLineup[] {
  const navios: NavioLineup[] = [];
  for (const tabela of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    let secao = "";
    let cab: string[] | null = null;
    for (const linha of tabela.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const ths = [...linha.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => limpar(m[1]));
      const tds = [...linha.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => limpar(m[1]));
      if (ths.length === 1) { secao = ths[0].toUpperCase(); cab = null; continue; }
      if (ths.length > 3) { cab = ths; continue; }
      if (!cab || !tds.length || secao === "LEGENDA") continue;
      const d: Record<string, string> = {};
      cab.forEach((c, i) => { d[c] = tds[i] ?? ""; });
      const nome = d["Embarcação"] ?? "";
      if (!nome) continue;
      const berco = d["Berço"] ?? "";
      navios.push({
        programacao: d["Programação"] ?? "",
        secao,
        porto: portoDoBerco(berco),
        berco,
        nome,
        imo: d["IMO"] ?? "",
        dwt: d["DWT"] ?? "",
        sentido: d["Sentido"] ?? d["Tipo de Operação"] ?? "",
        mercadoria: d["Mercadoria"] ?? "",
        toneladas: toneladasDe(d["Previsto"]),
        saldoToneladas: toneladasDe(d["Saldo Total"] ?? d["Saldo"]),
        chegada: d["Chegada"] ?? "",
        eta: d["ETA"] ?? "",
        etb: d["ETB"] ?? "",
        atracacao: d["Atracação"] ?? "",
        agencia: d["Agência"] ?? "",
        operador: d["Operador"] ?? "",
      });
    }
  }
  return navios;
}

const MANOBRAS: Record<string, string> = {
  EA: "entrada e atracação",
  AT: "atracação (do fundeio para o berço)",
  EF: "entrada para fundear",
  DS: "desatracação e saída",
  DF: "desatracação para fundear",
  MB: "mudança de berço",
};

/** Manobras previstas do SINPRAPAR (HTML) → lista. */
export function parseManobrasSinprapar(html: string): Manobra[] {
  const lista: Manobra[] = [];
  for (const linha of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const c = [...linha.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => limpar(m[1]));
    if (c.length < 18 || !/^\d{2}\/\d{2}$/.test(c[0]) || !/^\d{2}:\d{2}$/.test(c[1])) continue;
    const codigo = (c[3].match(/^([A-Z]{2}):/) ?? [])[1] ?? "";
    const calado = Number(c[7].replace(",", "."));
    lista.push({
      data: c[0], hora: c[1], navio: c[2], manobra: c[3], codigo,
      descricao: MANOBRAS[codigo] ?? "manobra",
      calado: Number.isFinite(calado) && calado > 0 ? calado : null,
      imo: c[10], situacao: c[17],
    });
  }
  return lista;
}

/** Nível do mar hora a hora → preamares e baixa-mares (máximos/mínimos locais). */
export function extremosDaMare(horas: string[], niveis: (number | null)[]): Mare[] {
  const out: Mare[] = [];
  for (let i = 1; i < niveis.length - 1; i++) {
    const a = niveis[i - 1], b = niveis[i], c = niveis[i + 1];
    if (a == null || b == null || c == null) continue;
    if (b > a && b >= c) out.push({ hora: horas[i], tipo: "preamar", alturaM: b });
    else if (b < a && b <= c) out.push({ hora: horas[i], tipo: "baixa-mar", alturaM: b });
  }
  return out;
}

/* ------------------------------------------------------------ rede (cache) */
const NAVEGADOR = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};
const VIDA_CACHE = 3 * 60_000;
const cache = new Map<string, { em: number; valor: unknown }>();

async function comCache<T>(chave: string, ler: () => Promise<T>): Promise<T> {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < VIDA_CACHE) return c.valor as T;
  const valor = await ler();
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}

async function baixar(url: string) {
  const r = await fetch(url, { headers: NAVEGADOR, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString("utf8");
}

export function lerLineup(): Promise<NavioLineup[]> {
  return comCache("lineup", async () => parseLineupAppa(await baixar(URL_LINEUP)));
}

export function lerManobras(): Promise<Manobra[]> {
  return comCache("manobras", async () => parseManobrasSinprapar(await baixar(URL_MANOBRAS)));
}

export function lerMares(): Promise<Mare[]> {
  return comCache("mare", async () => {
    const r = await fetch(URL_MARE, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    const j = (await r.json()) as { hourly?: { time: string[]; sea_level_height_msl: (number | null)[] } };
    if (!j.hourly) return [];
    const agora = Date.now() - 60 * 60_000;
    return extremosDaMare(j.hourly.time, j.hourly.sea_level_height_msl)
      .filter((m) => new Date(`${m.hora}:00-03:00`).getTime() >= agora);
  });
}

/** Só para os testes. */
export function limparCacheNavios() {
  cache.clear();
}

/* ----------------------------------------------------------- apresentação */
export const fmtTon = (t: number | null) =>
  t == null ? "" : `${Math.round(t).toLocaleString("pt-BR")} t`;

export const nomeIgual = (a: string, b: string) =>
  a.trim().toUpperCase().replace(/\s+/g, " ") === b.trim().toUpperCase().replace(/\s+/g, " ");

export function manobraDo(navio: Pick<NavioLineup, "nome" | "imo">, manobras: Manobra[]) {
  return manobras.find((m) => (navio.imo && m.imo === navio.imo) || nomeIgual(m.navio, navio.nome)) ?? null;
}

export function linhaNavio(n: NavioLineup, manobras: Manobra[] = []) {
  const m = manobraDo(n, manobras);
  const partes = [
    `${n.nome} (IMO ${n.imo || "?"})`,
    n.secao.toLowerCase(),
    `${n.porto}, berço ${n.berco || "?"}`,
    n.mercadoria,
    n.toneladas != null ? `${fmtTon(n.toneladas)} previstas` : "",
    n.saldoToneladas != null && n.secao === "ATRACADOS" ? `saldo ${fmtTon(n.saldoToneladas)}` : "",
    n.sentido ? (n.sentido.startsWith("Imp") ? "importação" : n.sentido.startsWith("Exp") ? "exportação" : n.sentido) : "",
    n.chegada ? `chegou ${n.chegada}` : n.eta ? `ETA ${n.eta}` : "",
    n.etb ? `ETB ${n.etb}` : "",
    n.atracacao ? `atracou ${n.atracacao}` : "",
    m ? `manobra ${m.descricao} ${m.data} ${m.hora} (${m.situacao.toLowerCase()})${m.calado ? `, calado ${m.calado.toFixed(2)} m` : ""}` : "",
  ];
  return partes.filter(Boolean).join(" · ");
}

export function resumoMares(mares: Mare[], max = 6) {
  return mares.slice(0, max)
    .map((m) => `${m.tipo} ${m.hora.slice(8, 10)}/${m.hora.slice(5, 7)} ${m.hora.slice(11, 16)} (${m.alturaM.toFixed(2)} m)`)
    .join("; ");
}
