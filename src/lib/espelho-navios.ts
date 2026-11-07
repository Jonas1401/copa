/**
 * ESPALHAMENTO / CÓPIA do "COPALINKS — Navios Atracados" (berth-buddy-bot).
 *
 * SOMENTE SERVIDOR. O painel monitora exatamente DUAS fontes públicas:
 *
 *   1. APPA  — line-up retroativo (berço, operadoras, previsto, saldos).
 *   2. SINPRAPAR — manobras previstas (data, hora, código, berço, situação).
 *
 * As duas leituras são cruzadas pelo nome/IMO do navio: a APPA informa a
 * mercadoria e os saldos, o SINPRAPAR informa a manobra. Só navios de
 * FERTILIZANTES entram no resultado (`ehFertilizante`, em `src/lib/navios.ts`).
 * Nenhum outro site é consultado e nenhum valor é inventado: quando uma fonte
 * falha, o trecho correspondente vem da última leitura gravada em
 * `espelho-navios-referencia.json`, com o painel marcado como referência.
 */

import {
  ehFertilizante,
  parseManobrasSinprapar,
  portoDoBerco,
  toneladasDe,
  URL_LINEUP,
  URL_MANOBRAS,
} from "@/lib/navios";
import REFERENCIA from "./espelho-navios-referencia.json";

/* ------------------------------------------------------------------ tipos */

export type OperadoraEspelho = {
  nome: string;
  mercadoria: string;
  saldo: string;
  previsto: string;
  realizado: string;
  saldoToneladas: number | null;
  previstoToneladas: number | null;
};

export type AtracadoEspelho = {
  porto: string;
  berco: string;
  nome: string;
  programacao: string;
  imo: string;
  secao: string;
  sentido: string;
  agencia: string;
  atracacao: string;
  operadoras: OperadoraEspelho[];
  saldoTotal: string;
  saldoTotalToneladas: number | null;
  previstoTotalToneladas: number | null;
  /** 0–100, arredondado como na referência ("75% descarregado"). */
  descarregado: number | null;
};

export type ManobraEspelho = {
  nome: string;
  imo: string;
  mercadoria: string;
  acao: string;
  estado: string;
  aguardando: boolean;
  data: string;
  hora: string;
  codigo: string;
  titulo: string;
  berco: string;
  linha: string;
  explicacao: string;
  situacao: string;
};

export type FonteEspelho = {
  id: "appa" | "sinprapar";
  rotulo: string;
  url: string;
  estado: "ao-vivo" | "referencia";
  atualizadoFonte: string | null;
  erro: string | null;
};

export type PainelEspelho = {
  atualizadoEm: string;
  modo: "ao-vivo" | "parcial" | "referencia";
  fontes: FonteEspelho[];
  atracados: AtracadoEspelho[];
  manobras: ManobraEspelho[];
  aviso: string | null;
};

type Referencia = {
  atualizadoEm: string;
  appa: { emissao: string; periodo: string };
  sinprapar: { atualizadoEm: string };
  atracados: AtracadoEspelho[];
  manobras: ManobraEspelho[];
  cargas: { nome: string; imo: string; mercadoria: string }[];
};

const REF = REFERENCIA as Referencia;

export type EntradaEspelho = {
  appaHtml?: string | null;
  sinpraparHtml?: string | null;
  appaErro?: string | null;
  sinpraparErro?: string | null;
};

/* -------------------------------------------------------------- utilidades */

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  atilde: "ã", otilde: "õ", acirc: "â", ecirc: "ê", ocirc: "ô",
  ccedil: "ç", ordm: "º", ordf: "ª", deg: "°", mdash: "—", ndash: "–",
};

function limparHtml(x: string): string {
  return x
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (todo, nome: string) => ENTIDADES[nome.toLowerCase()] ?? todo)
    .replace(/\s+/g, " ")
    .trim();
}

function colunaChave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

export function chaveNome(s: string): string {
  return colunaChave(s.trim()).replace(/\s+/g, " ");
}

function soma(valores: (number | null)[]): number | null {
  const numeros = valores.filter((v): v is number => v !== null && Number.isFinite(v));
  return numeros.length ? numeros.reduce((a, b) => a + b, 0) : null;
}

function fmtTons(n: number | null): string {
  if (n === null) return "";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Tons.`;
}

/* --------------------------------------------------------- leitura da APPA */

type LinhaAppa = {
  secao: string;
  programacao: string;
  berco: string;
  nome: string;
  imo: string;
  sentido: string;
  agencia: string;
  atracacao: string;
  operador: string;
  mercadoria: string;
  previsto: string;
  realizado: string;
  saldo: string;
  saldoTotal: string;
  continuacao: boolean;
};

function valor(cab: string[], cel: string[], nomes: string[], offset: number): string {
  const i = cab.findIndex((c) => nomes.includes(colunaChave(c)));
  if (i < 0) return "";
  return cel[i - offset] ?? "";
}

/**
 * Parser do HTML da APPA. As linhas de um navio com várias operadoras usam
 * `rowspan`: só a primeira traz berço/navio/IMO e "Saldo Total"; as seguintes
 * começam em "Bordo"/"Sentido" e terminam em "Saldo Operador". Alinhamos as
 * colunas pelo cabeçalho para não misturar operadora com mercadoria.
 */
export function linhasAppa(html: string): LinhaAppa[] {
  const linhas: LinhaAppa[] = [];
  for (const tabela of html.match(/<table\b[\s\S]*?<\/table>/gi) ?? []) {
    let secao = "";
    let cab: string[] | null = null;
    let atual: LinhaAppa | null = null;
    for (const tr of tabela.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
      const cel = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => limparHtml(m[1]));
      const th = (tr.match(/<th\b/gi) ?? []).length;
      if (cel.length === 1 && th === 1) {
        secao = cel[0].toUpperCase();
        cab = null;
        atual = null;
        continue;
      }
      if (th > 3) {
        cab = cel;
        continue;
      }
      if (!cab || !cel.length || secao === "LEGENDA") continue;

      const ehAtracados = secao === "ATRACADOS";
      const novoNavio = cel.length >= cab.length - 1 && Boolean(valor(cab, cel, ["embarcacao"], 0));
      // Na seção ATRACADOS a linha de continuação também omite a última
      // coluna ("Saldo Total"), além das colunas do navio.
      const offset = novoNavio ? 0 : Math.max(0, cab.length - cel.length - (ehAtracados ? 1 : 0));
      const comum = {
        secao,
        programacao: novoNavio ? valor(cab, cel, ["programacao"], offset) : (atual?.programacao ?? ""),
        berco: novoNavio ? valor(cab, cel, ["berco"], offset) : (atual?.berco ?? ""),
        nome: novoNavio ? valor(cab, cel, ["embarcacao"], offset) : (atual?.nome ?? ""),
        imo: novoNavio ? valor(cab, cel, ["imo"], offset) : (atual?.imo ?? ""),
        sentido: valor(cab, cel, ["sentido", "tipodeoperacao"], offset),
        agencia: valor(cab, cel, ["agencia"], offset),
        atracacao: valor(cab, cel, ["atracacao"], offset),
      };
      if (!comum.nome) continue;
      const linha: LinhaAppa = {
        ...comum,
        operador: valor(cab, cel, ["operador"], offset),
        mercadoria: valor(cab, cel, ["mercadoria"], offset),
        previsto: valor(cab, cel, ["previsto"], offset),
        realizado: valor(cab, cel, ["realizado"], offset),
        saldo: valor(cab, cel, ["saldooperador", "saldo"], offset),
        saldoTotal: novoNavio ? valor(cab, cel, ["saldototal"], offset) : "",
        continuacao: !novoNavio,
      };
      linhas.push(linha);
      if (novoNavio) atual = linha;
    }
  }
  return linhas;
}

/** Só os navios ATRACADOS cuja mercadoria é fertilizante, com os saldos. */
export function montarAtracados(linhas: LinhaAppa[]): AtracadoEspelho[] {
  const grupos = new Map<string, LinhaAppa[]>();
  for (const l of linhas) {
    if (l.secao !== "ATRACADOS" || !l.nome) continue;
    const chave = `${l.programacao}:${chaveNome(l.nome)}`;
    const g = grupos.get(chave) ?? [];
    g.push(l);
    grupos.set(chave, g);
  }
  const navios: AtracadoEspelho[] = [];
  for (const g of grupos.values()) {
    if (!g.some((l) => ehFertilizante(l.mercadoria))) continue;
    const principal = g.find((l) => !l.continuacao) ?? g[0];
    const operadoras: OperadoraEspelho[] = g
      .filter((l) => ehFertilizante(l.mercadoria))
      .map((l) => ({
        nome: l.operador,
        mercadoria: l.mercadoria,
        saldo: l.saldo,
        previsto: l.previsto,
        realizado: l.realizado,
        saldoToneladas: toneladasDe(l.saldo),
        previstoToneladas: toneladasDe(l.previsto),
      }));
    const previstoTotalToneladas = soma(g.map((l) => toneladasDe(l.previsto)));
    const saldoTotalToneladas =
      toneladasDe(principal.saldoTotal) ?? soma(operadoras.map((o) => o.saldoToneladas));
    const descarregado =
      previstoTotalToneladas && previstoTotalToneladas > 0 && saldoTotalToneladas !== null
        ? Math.max(0, Math.min(100, Math.round((1 - saldoTotalToneladas / previstoTotalToneladas) * 100)))
        : null;
    navios.push({
      porto: portoDoBerco(principal.berco).toUpperCase(),
      berco: principal.berco,
      nome: principal.nome,
      programacao: principal.programacao,
      imo: principal.imo,
      secao: principal.secao,
      sentido: principal.sentido,
      agencia: principal.agencia,
      atracacao: principal.atracacao,
      operadoras,
      saldoTotal: principal.saldoTotal || fmtTons(saldoTotalToneladas),
      saldoTotalToneladas,
      previstoTotalToneladas,
      descarregado,
    });
  }
  return navios;
}

/* ------------------------------------------------------ cruzamento / cargas */

const PRIORIDADE_SECAO: Record<string, number> = {
  ATRACADOS: 0,
  PROGRAMADOS: 1,
  "AO LARGO PARA REATRACAÇÃO": 2,
  "AO LARGO": 3,
  ESPERADOS: 4,
  DESPACHADOS: 5,
};

export function mapaDeCargas(linhas: LinhaAppa[]): Map<string, string> {
  const mapa = new Map<string, string>();
  const ordenadas = [...linhas].sort(
    (a, b) => (PRIORIDADE_SECAO[a.secao] ?? 9) - (PRIORIDADE_SECAO[b.secao] ?? 9),
  );
  for (const l of ordenadas) {
    if (!ehFertilizante(l.mercadoria)) continue;
    const chaves = [l.imo ? `imo:${l.imo}` : "", l.nome ? `nome:${chaveNome(l.nome)}` : ""].filter(Boolean);
    for (const c of chaves) if (!mapa.has(c)) mapa.set(c, l.mercadoria);
  }
  return mapa;
}

function mapaDeCargasReferencia(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const c of REF.cargas) {
    if (!ehFertilizante(c.mercadoria)) continue;
    if (c.imo && !mapa.has(`imo:${c.imo}`)) mapa.set(`imo:${c.imo}`, c.mercadoria);
    if (c.nome && !mapa.has(`nome:${chaveNome(c.nome)}`)) mapa.set(`nome:${chaveNome(c.nome)}`, c.mercadoria);
  }
  for (const a of REF.atracados) {
    for (const o of a.operadoras) {
      if (!ehFertilizante(o.mercadoria)) continue;
      if (a.imo && !mapa.has(`imo:${a.imo}`)) mapa.set(`imo:${a.imo}`, o.mercadoria);
      if (!mapa.has(`nome:${chaveNome(a.nome)}`)) mapa.set(`nome:${chaveNome(a.nome)}`, o.mercadoria);
    }
  }
  return mapa;
}

const TITULOS: Record<string, string> = {
  EA: "Entrada e Atracação",
  EF: "Entrada e Fundeio",
  DF: "Desfundeio",
  DS: "Desatracação e Saída",
  AT: "Atracação",
  MB: "Mudança de Berço",
};

const EXPLICACOES: Record<string, string> = {
  EA: "Navio entra no porto e encosta no berço para operar.",
  EF: "Navio entra na área de fundeio e lança a âncora.",
  DF: "Navio suspende a âncora e deixa o fundeio.",
  DS: "Navio solta as amarras do berço e deixa o porto.",
  AT: "Navio deixa o fundeio e encosta no berço para operar.",
  MB: "Navio muda de um berço para outro dentro do porto.",
};

/** Só as manobras de navios que a APPA identifica como fertilizantes. */
export function montarManobras(
  htmlSinprapar: string,
  cargas: Map<string, string>,
  atracados: AtracadoEspelho[],
): ManobraEspelho[] {
  const nomesAtracados = new Set(atracados.map((a) => chaveNome(a.nome)));
  return parseManobrasSinprapar(htmlSinprapar).flatMap((m): ManobraEspelho[] => {
    const mercadoria =
      (m.imo && cargas.get(`imo:${m.imo}`)) || cargas.get(`nome:${chaveNome(m.navio)}`) || "";
    if (!mercadoria || !ehFertilizante(mercadoria)) return [];
    const codigo = (m.codigo || "").toUpperCase();
    const titulo = TITULOS[codigo] ?? "Manobra";
    const explicacao = EXPLICACOES[codigo] ?? "Manobra prevista pela praticagem.";
    const berco = m.manobra.replace(/^[A-Z]{2}\s*:\s*/i, "").trim();
    const linha = `${m.data} ${m.hora}·${codigo}— ${titulo}${berco ? `: ${berco}` : ""}`;
    const situacao = m.situacao.trim().toUpperCase();
    const estado =
      situacao === "EM ANDAMENTO" ? "Em manobra" : nomesAtracados.has(chaveNome(m.navio)) ? "Atracado" : "";
    const acao = codigo === "MB" ? "Mudar de berço" : ["DS", "DF"].includes(codigo) ? "Desatracar" : "Atracar";
    return [{
      nome: m.navio,
      imo: m.imo,
      mercadoria,
      acao,
      estado,
      aguardando: estado === "",
      data: m.data,
      hora: m.hora,
      codigo,
      titulo,
      berco,
      linha,
      explicacao,
      situacao,
    }];
  });
}

/* ------------------------------------------------------ carimbos das fontes */

function textoVisivel(html: string): string {
  return limparHtml(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));
}

export function emissaoAppa(html: string): string | null {
  const m = textoVisivel(html).match(/Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i);
  return m?.[1] ?? null;
}

export function atualizacaoSinprapar(html: string): string | null {
  const m = textoVisivel(html).match(
    /[UÚ]ltima\s+Atualiza[çc][aã]o\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i,
  );
  return m?.[1] ?? null;
}

const AVISO_REFERENCIA = `Sem conexão com as fontes oficiais: exibindo a leitura gravada em ${REF.appa.emissao}.`;

/** Monta o painel a partir de HTML já baixado (puro, usado pelos testes). */
export function montarPainelEspelho(entrada: EntradaEspelho, agora: number = Date.now()): PainelEspelho {
  let appaOk = false;
  let linhas: LinhaAppa[] = [];
  if (entrada.appaHtml) {
    const lidas = linhasAppa(entrada.appaHtml);
    if (lidas.length && lidas.some((l) => l.secao === "ATRACADOS" && l.nome)) {
      linhas = lidas;
      appaOk = true;
    }
  }
  let sinpraparOk = false;
  if (entrada.sinpraparHtml) {
    sinpraparOk = parseManobrasSinprapar(entrada.sinpraparHtml).length > 0;
  }

  const atracados = appaOk ? montarAtracados(linhas) : REF.atracados;
  const cargas = appaOk ? mapaDeCargas(linhas) : mapaDeCargasReferencia();
  const manobras = sinpraparOk
    ? montarManobras(entrada.sinpraparHtml as string, cargas, atracados)
    : REF.manobras;

  const modo: PainelEspelho["modo"] =
    appaOk && sinpraparOk ? "ao-vivo" : appaOk || sinpraparOk ? "parcial" : "referencia";
  const fontes: FonteEspelho[] = [
    {
      id: "appa",
      rotulo: "APPA · Line-up",
      url: URL_LINEUP,
      estado: appaOk ? "ao-vivo" : "referencia",
      atualizadoFonte: appaOk ? emissaoAppa(entrada.appaHtml as string) : REF.appa.emissao,
      erro: appaOk ? null : (entrada.appaErro ?? "Leitura indisponível."),
    },
    {
      id: "sinprapar",
      rotulo: "SINPRAPAR · Manobras",
      url: URL_MANOBRAS,
      estado: sinpraparOk ? "ao-vivo" : "referencia",
      atualizadoFonte: sinpraparOk
        ? atualizacaoSinprapar(entrada.sinpraparHtml as string)
        : REF.sinprapar.atualizadoEm,
      erro: sinpraparOk ? null : (entrada.sinpraparErro ?? "Leitura indisponível."),
    },
  ];
  return {
    atualizadoEm: modo === "referencia" ? REF.atualizadoEm : new Date(agora).toISOString(),
    modo,
    fontes,
    atracados,
    manobras,
    aviso:
      modo === "referencia"
        ? AVISO_REFERENCIA
        : modo === "parcial"
          ? "Uma das fontes não respondeu: esse trecho usa a última leitura gravada."
          : null,
  };
}

/** Painel inicial (SSR) — a tela atualiza sozinha ao abrir. */
export function painelReferencia(aviso: string | null = "Conectando às fontes oficiais…"): PainelEspelho {
  return {
    atualizadoEm: REF.atualizadoEm,
    modo: "referencia",
    fontes: [
      {
        id: "appa",
        rotulo: "APPA · Line-up",
        url: URL_LINEUP,
        estado: "referencia",
        atualizadoFonte: REF.appa.emissao,
        erro: null,
      },
      {
        id: "sinprapar",
        rotulo: "SINPRAPAR · Manobras",
        url: URL_MANOBRAS,
        estado: "referencia",
        atualizadoFonte: REF.sinprapar.atualizadoEm,
        erro: null,
      },
    ],
    atracados: REF.atracados,
    manobras: REF.manobras,
    aviso: aviso ?? AVISO_REFERENCIA,
  };
}

/* --------------------------------------------------------------- rede/cache */

const CABECALHOS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};
const PRAZO = 9_000;
const VIDA_CACHE = 30_000;

async function baixarTexto(url: string): Promise<string> {
  const r = await fetch(url, { headers: CABECALHOS, cache: "no-store", signal: AbortSignal.timeout(PRAZO) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buffer = await r.arrayBuffer();
  const tipo = r.headers.get("content-type") ?? "";
  let texto = new TextDecoder("utf-8").decode(buffer);
  // APPA e SINPRAPAR podem responder em ISO-8859-1: sem isso os acentos viram
  // "?" e o filtro de fertilizantes perde mercadorias como "CLORETOS DE POTÁSSIO".
  if (texto.includes("\ufffd") || /charset\s*=\s*(iso-8859-1|windows-1252|latin1)/i.test(tipo)) {
    texto = new TextDecoder("windows-1252").decode(buffer);
  }
  return texto;
}

async function tentarFonte(url: string): Promise<{ html: string | null; erro: string | null }> {
  try {
    return { html: await baixarTexto(url), erro: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { html: null, erro: msg.slice(0, 160) };
  }
}

let cache: { em: number; painel: PainelEspelho } | null = null;

/** Leitura das DUAS fontes com cache curto; nunca lança erro para o navegador. */
export async function lerPainelEspelho(): Promise<PainelEspelho> {
  if (cache && Date.now() - cache.em < VIDA_CACHE) return cache.painel;
  const [appa, sinprapar] = await Promise.all([tentarFonte(URL_LINEUP), tentarFonte(URL_MANOBRAS)]);
  if (!appa.html && !sinprapar.html && cache) return cache.painel;
  const painel = montarPainelEspelho({
    appaHtml: appa.html,
    appaErro: appa.erro,
    sinpraparHtml: sinprapar.html,
    sinpraparErro: sinprapar.erro,
  });
  if (painel.modo !== "referencia") cache = { em: Date.now(), painel };
  return painel;
}

/** Só para os testes. */
export function limparCacheEspelho() {
  cache = null;
}
