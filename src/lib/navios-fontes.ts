import { POLITICA_AUTOMACAO } from "@/lib/politica-automacao";

/** Parsers determinísticos do TEXTO VISÍVEL devolvido pelo Composio.
 * Sem LLM para reescrever valores e sem consultar outra fonte silenciosamente.
 * Campos literais são usados nos avisos; números servem somente à comparação.
 */
export type OperadoraFonte = { nome: string; mercadoria: string; saldo: string; toneladas: number };
export type AtracadoFonte = {
  identidade: string; nome: string; porto: string; berco: string;
  operadoras: OperadoraFonte[]; saldoTotal: string; saldoToneladas: number; texto: string;
};
export type ManobraFonte = {
  identidade: string; nome: string; mercadoria: string; estado: string;
  acao: string; data: string; hora: string; codigo: string; berco: string;
  situacao: string; linha: string; texto: string;
};
export type NovidadeFonte = { navio: string; tipo: "atracado" | "saldo" | "berco" | "manobra"; texto: string };

export class LeituraNaviosInvalida extends Error {}
const nomeChave = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

/** Remove só apresentação HTML/Markdown, nunca altera caixa ou precisão. */
export function linhasVisiveis(bruto: string): string[] {
  return bruto
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(?:div|p|h[1-6]|section|article|li|tr)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\r/g, "")
    // Alguns leitores juntam o rótulo e o saldo; explicita as fronteiras.
    .replace(/(Saldo\s+(?:da\s+Operadora|Total\s+do\s+Navio))\s*/gi, "\n$1 ")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:#{1,6}\s*|[-*]\s+)/, "").replace(/\*\*|__/g, "").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

/** Formato brasileiro da fonte: 1.999,990 Tons. = 1999.99 (sem arredondar). */
export function saldoEmToneladas(literal: string): number | null {
  const m = literal.trim().match(/^(\d+(?:\.\d{3})*)(?:,(\d+))?\s*(?:Tons?\.?|toneladas?|t)\s*$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "") + (m[2] ? `.${m[2]}` : ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function valorSaldo(linha: string, rotulo: string) {
  const literal = linha.slice(rotulo.length).trim();
  const toneladas = saldoEmToneladas(literal);
  if (toneladas === null) throw new LeituraNaviosInvalida(`Saldo inválido ou incompleto: ${rotulo}.`);
  return { literal, toneladas };
}

function contextoLocal(linhas: string[], anterior = { porto: "", berco: "" }) {
  let { porto, berco } = anterior;
  for (const l of linhas) {
    if (/^(PARANAGU[ÁA]|ANTONINA)$/i.test(l)) { porto = l; berco = ""; }
    else if (/^Ber[cç]o\s+\S+/i.test(l) || /^FOSPAR(?:\s+(?:EXT|INT))?$/i.test(l)) berco = l;
  }
  return { porto, berco };
}

export function parseAtracadosComposio(bruto: string): AtracadoFonte[] {
  const linhas = linhasVisiveis(bruto);
  const inicios = linhas.flatMap((l, i) => /^\d+\s+operadoras?$/i.test(l) ? [i] : []);
  if (!inicios.length || !linhas.some((l) => /^Saldo Total do Navio\b/i.test(l))) {
    // Ausência de dados não é uma lista vazia confiável: preservar última leitura.
    throw new LeituraNaviosInvalida("Página de atracados sem cartões e saldos completos.");
  }
  const navios: AtracadoFonte[] = [];
  const identidades = new Set<string>();
  let local = { porto: "", berco: "" }, fimAnterior = 0;
  for (let k = 0; k < inicios.length; k++) {
    const inicio = inicios[k], fim = inicios[k + 1] ?? linhas.length;
    const bloco = linhas.slice(inicio + 1, fim);
    const quantidade = Number(linhas[inicio].match(/^\d+/)?.[0]);
    const nome = bloco[0] ?? "";
    const totalIdx = bloco.findIndex((l) => /^Saldo Total do Navio\b/i.test(l));
    if (!nome || totalIdx < 0) throw new LeituraNaviosInvalida("Cartão de navio incompleto.");
    // Alguns leitores quebram rótulo e valor em linhas diferentes.
    const juntarSaldo = (idx: number, rotulo: string) => {
      const l = bloco[idx];
      return l.trim().toLowerCase() === rotulo.toLowerCase() ? `${l} ${bloco[idx + 1] ?? ""}` : l;
    };
    const total = valorSaldo(juntarSaldo(totalIdx, "Saldo Total do Navio"), "Saldo Total do Navio");
    const operadoras: OperadoraFonte[] = [];
    let cursor = 1;
    for (let i = 1; i < totalIdx; i++) {
      if (!/^Saldo da Operadora\b/i.test(bloco[i])) continue;
      const campos = bloco.slice(cursor, i);
      if (campos.length !== 2) throw new LeituraNaviosInvalida("Operadora ou mercadoria incompleta.");
      const saldo = valorSaldo(juntarSaldo(i, "Saldo da Operadora"), "Saldo da Operadora");
      operadoras.push({ nome: campos[0], mercadoria: campos[1], saldo: saldo.literal, toneladas: saldo.toneladas });
      cursor = i + (/^Saldo da Operadora$/i.test(bloco[i]) ? 2 : 1);
    }
    if (operadoras.length !== quantidade) throw new LeituraNaviosInvalida("Quantidade de operadoras não confere; leitura parcial.");
    // Ler títulos apenas FORA do cartão. Uma operadora chamada FOSPAR
    // não é um título de berço para o navio seguinte.
    local = contextoLocal(linhas.slice(fimAnterior, inicio), local);
    const { porto, berco } = local;
    fimAnterior = inicio + 1 + totalIdx + (/^Saldo Total do Navio$/i.test(bloco[totalIdx]) ? 2 : 1);
    const identidade = `${nomeChave(porto)}:${nomeChave(nome)}`;
    if (identidades.has(identidade)) throw new LeituraNaviosInvalida("Navio duplicado ou leitura ambígua.");
    identidades.add(identidade);
    const texto = [nome, porto, berco, linhas[inicio], ...operadoras.flatMap((o) => [o.nome, o.mercadoria, `Saldo da Operadora ${o.saldo}`]), `Saldo Total do Navio ${total.literal}`].filter(Boolean).join("\n");
    navios.push({ identidade, nome, porto, berco, operadoras, saldoTotal: total.literal, saldoToneladas: total.toneladas, texto });
  }
  // Um cartão cortado que não tenha o contador também invalida o conjunto.
  if (linhas.filter((l) => /^Saldo Total do Navio\b/i.test(l)).length !== navios.length) {
    throw new LeituraNaviosInvalida("Leitura de atracados incompleta.");
  }
  return navios;
}

/** Também aceita berços nomeados (FOSPAR EXT BB), sem exigir número. */
export function bercoFonteDefinido(b: string): boolean {
  return Boolean(b.trim()) && !/^[-?.]+$/.test(b.trim()) && !/^(?:0|N\/?A|N\.?D\.?|S\/?D|TBD|TBA|A CONFIRMAR)$/i.test(b.trim()) &&
    !/A\s*DEFINIR|INDEFIN|N[ÃA]O\s*DEFIN|SEM\s*BER[CÇ]O|FUNDEIO|FUNDEAD|AO\s*LARGO|AGUARDANDO|\?/.test(b.toUpperCase());
}

function dataValida(d: string, h: string): boolean {
  const m = d.match(/^(\d{2})\/(\d{2})(?:\/(\d{2}|\d{4}))?$/);
  if (!m || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) return false;
  const dia = Number(m[1]), mes = Number(m[2]);
  const ano = m[3] ? Number(m[3]) + (m[3].length === 2 ? 2000 : 0) : 2000;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  return dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === dia;
}

export function parseManobrasComposio(bruto: string): ManobraFonte[] {
  const linhas = linhasVisiveis(bruto);
  const datas = linhas.flatMap((l, i) => /^\d{2}\/\d{2}(?:\/\d{2,4})?\s+\d{2}:\d{2}/.test(l) ? [i] : []);
  if (!datas.length) throw new LeituraNaviosInvalida("Página de manobras sem previsões completas.");
  const manobras: ManobraFonte[] = [];
  for (const idx of datas) {
    const linha = linhas[idx];
    const m = linha.match(/^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(\d{2}:\d{2})\s*[·|—–-]?\s*([A-Z]{2})\s*[—–:-]\s*(.+)$/);
    if (!m || !dataValida(m[1], m[2])) throw new LeituraNaviosInvalida("Data, hora ou código de manobra inválido.");
    const acaoIdx = idx - 1;
    if (!/^(Atracar|Desatracar|Mudar de ber[cç]o)$/i.test(linhas[acaoIdx] ?? "")) throw new LeituraNaviosInvalida("Manobra sem ação explícita.");
    const estado = /^(Atracado|Em manobra|Aguardando manobra)$/i.test(linhas[acaoIdx - 1] ?? "") ? linhas[acaoIdx - 1] : "";
    const cargaIdx = acaoIdx - (estado ? 2 : 1);
    const mercadoria = linhas[cargaIdx] ?? "", nome = linhas[cargaIdx - 1] ?? "";
    if (!nome || !mercadoria || /SINPRAPAR|Manobras Previstas|^PREVISTA$/i.test(nome)) throw new LeituraNaviosInvalida("Navio ou mercadoria da manobra incompleto.");
    const situacao = /^(PREVISTA|CONFIRMADA|A CONFIRMAR|PR[ÁA]TICO NA LANCHA|CANCELADA)$/i.test(linhas[idx + 1] ?? "") ? linhas[idx + 1] : "";
    if (!situacao) throw new LeituraNaviosInvalida("Manobra sem situação informada pela fonte.");
    const detalhe = m[4];
    const berco = detalhe.includes(":") ? detalhe.slice(detalhe.indexOf(":") + 1).trim() : "";
    const acao = linhas[acaoIdx];
    const texto = [nome, mercadoria, estado, acao, linha, situacao].filter(Boolean).join("\n");
    manobras.push({ identidade: nomeChave(nome), nome, mercadoria, estado, acao, data: m[1], hora: m[2], codigo: m[3], berco, situacao, linha, texto });
  }
  if (linhas.filter((l) => /^(Atracar|Desatracar|Mudar de ber[cç]o)$/i.test(l)).length !== manobras.length) {
    throw new LeituraNaviosInvalida("Leitura de manobras parcial.");
  }
  return manobras;
}

export function manobraPodeAvisar(m: ManobraFonte): boolean {
  // EF = entrada e fundeio: nunca anunciar como atracação, mesmo se o site
  // usar o botão genérico "Atracar". DS/DF são previsões, não saídas realizadas.
  return ["EA", "AT", "DS", "DF", "MB"].includes(m.codigo) && bercoFonteDefinido(m.berco) && dataValida(m.data, m.hora);
}

const saldosChave = (n: AtracadoFonte) => JSON.stringify([
  n.saldoToneladas,
  n.operadoras.map((o) => [nomeChave(o.nome), o.mercadoria, o.toneladas]).sort((a, b) => String(a).localeCompare(String(b))),
]);

export function novidadesAtracados(antes: AtracadoFonte[], agora: AtracadoFonte[]): NovidadeFonte[] {
  const base = new Map(antes.map((n) => [n.identidade, n]));
  return agora.flatMap((n): NovidadeFonte[] => {
    const a = base.get(n.identidade);
    const tipo = !a ? "atracado" : a.berco !== n.berco ? "berco" :
      n.saldoToneladas < POLITICA_AUTOMACAO.limiteSaldoToneladas && saldosChave(a) !== saldosChave(n) ? "saldo" : null;
    return tipo ? [{ navio: n.nome, tipo, texto: n.texto }] : [];
  });
  // Nunca inferir desatracação de navios ausentes: só a fonte de manobras
  // fornece a previsão explícita de desatracação.
}

export function novidadesManobras(antes: ManobraFonte[], agora: ManobraFonte[]): NovidadeFonte[] {
  const agrupar = (lista: ManobraFonte[]) => {
    const mapa = new Map<string, ManobraFonte[]>();
    for (const m of lista.filter(manobraPodeAvisar)) {
      const grupo = mapa.get(m.identidade) ?? [];
      if (!grupo.some((x) => x.texto === m.texto)) grupo.push(m);
      mapa.set(m.identidade, grupo);
    }
    return mapa;
  };
  const base = agrupar(antes);
  return [...agrupar(agora)].flatMap(([identidade, grupo]): NovidadeFonte[] => {
    const anterior = base.get(identidade) ?? [];
    const mudaram = grupo.filter((m) => !anterior.some((a) => a.texto === m.texto));
    // Uma mensagem pode conter mais de uma manobra DO MESMO navio, nunca de
    // navios diferentes. A retirada de uma previsão não inventa saída/cancelamento.
    return mudaram.length ? [{ navio: grupo[0].nome, tipo: "manobra", texto: mudaram.map((m) => m.texto).join("\n\n") }] : [];
  });
}
