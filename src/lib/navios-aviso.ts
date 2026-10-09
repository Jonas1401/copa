import {
  bercoDefinido,
  ehFertilizante,
  fmtTon,
  manobraDo,
  type Manobra,
  type Mare,
  type NavioLineup,
} from "@/lib/navios";

import { NOME_NAVIOS_AUTOMACAO } from "@/lib/politica-automacao";

/** Utilitários legados da APPA para consultas; não usados no envio automático. */
export const NOME_NAVIOS = NOME_NAVIOS_AUTOMACAO;

export type EventoNavio = {
  chave: string;
  tipo: "programado" | "manobra" | "atracado" | "saiu" | "etb";
  navio: NavioLineup;
  manobra: Manobra | null;
  /** ETB anterior (o último notificado), quando o evento é reprogramação. */
  etbAnterior?: string;
};

const CONFIRMADA = /CONFIRMADA|PR[ÁA]TICO/i;

/** Delta mínimo (minutos) na previsão de atracação para virar aviso. */
export const ETB_DELTA_MIN_PADRAO = 120;

export function etbDeltaMin(ambiente: Record<string, string | undefined> = process.env): number {
  const n = Number(String(ambiente.NAVIOS_ETB_DELTA_MIN ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : ETB_DELTA_MIN_PADRAO;
}

/**
 * Converte o ETB do line-up ("05/10 08:00", com ou sem ano) em data, para
 * comparar previsões. Sem ano na fonte, assume o ano atual — e o próximo se o
 * resultado ficar mais de 6 meses no passado (virada de dezembro → janeiro).
 * Devolve null quando não dá para entender o horário.
 */
export function parseEtb(bruto: string | null | undefined, agora: Date = new Date()): Date | null {
  const s = String(bruto ?? "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2})[:hH](\d{2})/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const hora = Number(m[4]);
  const min = Number(m[5]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || hora > 23 || min > 59) return null;
  const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : agora.getUTCFullYear();
  let d = new Date(Date.UTC(ano, mes - 1, dia, hora, min));
  if (Number.isNaN(d.getTime())) return null;
  if (!m[3] && agora.getTime() - d.getTime() > 180 * 86_400_000) {
    d = new Date(Date.UTC(ano + 1, mes - 1, dia, hora, min));
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Eventos atuais dos navios de FERTILIZANTES (sem repetir o mesmo navio).
 *
 * Só entra no radar navio de fertilizante: qualquer outra carga é ignorada.
 * O aviso de "programado" exige BERÇO DEFINIDO — navio sem berço ainda não é
 * novidade útil para o motorista. A chave leva o berço, então uma mudança de
 * berço do mesmo navio também vira novidade (avisada uma vez).
 *
 * O evento `etb` carrega o VALOR da previsão de atracação na chave
 * (`E:<programação>:<ETB>`). Este gerador legado não participa dos envios;
 * o monitor Composio compara as leituras literais em `navios-monitor.ts`.
 */
export function eventosFertilizantes(lineup: NavioLineup[], manobras: Manobra[]): EventoNavio[] {
  const vistos = new Set<string>();
  const eventos: EventoNavio[] = [];
  for (const n of lineup) {
    if (!ehFertilizante(n.mercadoria) || !n.programacao) continue;
    const id = `${n.programacao}:${n.secao}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const m = manobraDo(n, manobras);
    // Programado para atracar: só com berço definido pela APPA.
    if (n.secao === "PROGRAMADOS" && bercoDefinido(n.berco)) {
      eventos.push({ chave: `P:${n.programacao}:${n.berco.trim()}`, tipo: "programado", navio: n, manobra: m });
    }
    if (n.secao === "ATRACADOS") eventos.push({ chave: `A:${n.programacao}`, tipo: "atracado", navio: n, manobra: m });
    if (n.secao === "DESPACHADOS") eventos.push({ chave: `S:${n.programacao}`, tipo: "saiu", navio: n, manobra: m });
    if (n.secao !== "ATRACADOS" && n.secao !== "DESPACHADOS" && m && (m.codigo === "EA" || m.codigo === "AT") && CONFIRMADA.test(m.situacao)) {
      eventos.push({ chave: `M:${n.programacao}:${m.data} ${m.hora}`, tipo: "manobra", navio: n, manobra: m });
    }
    // Previsão de atracação (ETB) dos navios que ainda não atracaram: cada
    // valor vira candidato; só muda o que for mudança significativa.
    if (n.secao !== "ATRACADOS" && n.secao !== "DESPACHADOS" && bercoDefinido(n.berco) && parseEtb(n.etb)) {
      eventos.push({ chave: `E:${n.programacao}:${n.etb.trim()}`, tipo: "etb", navio: n, manobra: m });
    }
  }
  return eventos;
}

export function textoPadrao(ev: EventoNavio, mares: Mare[]) {
  const n = ev.navio;
  const carga = `${n.mercadoria.toLowerCase()}${n.toneladas != null ? ` (${fmtTon(n.toneladas)})` : ""}`;
  const onde = `${n.porto}, berço ${n.berco || "a definir"}`;
  const mare = mares.find((x) => x.tipo === "preamar");
  const dicaMare = mare ? ` Próxima preamar por volta das ${mare.hora.slice(11, 16)}.` : "";
  const m = ev.manobra;
  if (ev.tipo === "etb") {
    return `🚢 A previsão de atracação do ${n.nome} mudou: era ${ev.etbAnterior ?? "?"} e agora é ${n.etb}, em ${onde}, com ${carga}. Programe-se pelo novo horário.`;
  }
  if (ev.tipo === "saiu") {
    return `⚓ O ${n.nome} já foi despachado e deixou ${n.porto}${n.berco ? `, berço ${n.berco}` : ""}. A descarga de ${n.mercadoria.toLowerCase()} desse navio encerrou.`;
  }
  if (ev.tipo === "atracado") {
    return `⚓ O ${n.nome} já atracou em ${onde} com ${carga}.${n.saldoToneladas != null ? ` Faltam cerca de ${fmtTon(n.saldoToneladas)} para descarregar.` : ""} Bora que tem serviço, pessoal!`;
  }
  if (ev.tipo === "manobra" && m) {
    return `🚢 Atracação confirmada! O ${n.nome} entra para ${onde} em ${m.data} às ${m.hora}, trazendo ${carga}.${m.calado ? ` Calado de ${m.calado.toFixed(1)} m.` : ""}${dicaMare} Fiquem de olho na escala.`;
  }
  const etb = n.etb ? ` Previsão de atracação (ETB) ${n.etb}.` : "";
  return `🚢 Berço definido! O ${n.nome} está programado para atracar em ${onde} com ${carga}.${etb}${dicaMare} Assim que a praticagem confirmar o horário, eu aviso.`;
}

/**
 * A IA não pode inventar tonelagem. Aqui conferimos cada número de toneladas
 * citado no texto contra os valores reais da fonte (previsto e saldo):
 * se aparecer um número que não veio do line-up — ou se a fonte não informou
 * tonelagem nenhuma — o texto da IA é descartado e usamos o modelo pronto.
 */
const TONELADAS_NO_TEXTO = /(\d[\d.,]*)\s*(?:mil\s*)?(?:t\b|ton\b|tons?\b|toneladas?\b)/gi;

export function tonelagemConfere(texto: string, navio: Pick<NavioLineup, "toneladas" | "saldoToneladas">): boolean {
  const citados = [...texto.matchAll(TONELADAS_NO_TEXTO)].map((m) => {
    const bruto = m[1].replace(/\./g, "").replace(",", ".");
    const n = Number(bruto);
    return Number.isFinite(n) ? (/mil\s*(?:t|ton)/i.test(m[0]) ? n * 1000 : n) : NaN;
  });
  if (!citados.length) return true;
  const permitidos = [navio.toneladas, navio.saldoToneladas]
    .filter((t): t is number => t != null)
    .flatMap((t) => [Math.round(t), Math.round(t / 1000)]);
  if (!permitidos.length) return false; // fonte sem tonelagem: nenhum número pode aparecer
  return citados.every((c) => !Number.isNaN(c) && permitidos.some((p) => Math.abs(p - c) <= 1));
}

/** Compatibilidade com o cron existente: os envios usam somente o monitor
 * Composio v2. Sem reescrita por IA, lotes de navios ou dicas de maré.
 */
export async function verificarNaviosFertilizantes(opcoes: { forcar?: boolean } = {}) {
  const { verificarNaviosComposio } = await import("@/lib/navios-monitor");
  return verificarNaviosComposio(opcoes);
}
