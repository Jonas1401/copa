import { desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, configuracao, naviosAvisos } from "@/db/schema";
import { notificarMensagemChat } from "@/lib/chat-push";
import { geminiViaComposio } from "@/lib/composio";
import { checarCota, registrarAviso } from "@/lib/notificacoes-cota";
import {
  bercoDefinido,
  ehFertilizante,
  fmtTon,
  lerLineup,
  lerManobras,
  lerMares,
  manobraDo,
  resumoMares,
  type Manobra,
  type Mare,
  type NavioLineup,
} from "@/lib/navios";

/**
 * Avisos de navios de FERTILIZANTES (chamado pelo /api/cron).
 *
 * Quatro novidades, cada uma avisada uma única vez por navio:
 *   1. programado para atracar (APPA → PROGRAMADOS: berço definido);
 *   2. atracação confirmada pela praticagem (SINPRAPAR, manobra EA/AT);
 *   3. atracou (APPA → ATRACADOS);
 *   4. previsão de atracação (ETB) mudou MUITO (≥ NAVIOS_ETB_DELTA_MIN,
 *      padrão 120 min) em relação à última previsão notificada.
 * O aviso vira mensagem no chat como "🚢 Navios no Porto" e sai por Web Push
 * (quem silenciou o chat não recebe). O texto é escrito pela IA (Gemini pelo
 * Composio) com tom humano e análise da maré; se a IA falhar, usa um modelo
 * pronto. Na 1ª execução só registra o que já existe (não dispara nada antigo).
 *
 * PRINCÍPIO GERAL (o mesmo do radar da previsão): só notifica MUDANÇA
 * RELEVANTE de status/previsão — navio novo, mudança de situação (programado,
 * confirmado, atracou, saiu) ou alteração significativa do ETB. A mesma
 * informação nunca repete: cada evento notificado fica registrado em
 * `navios_avisos` (chave única) e pequenos ajustes de ETB não viram aviso —
 * a comparação é sempre contra a última previsão NOTIFICADA, então a deriva
 * acumulada ainda é pega, sem pingar notificação a cada atualização.
 *
 * ANTIESCESSO (veja também `src/lib/notificacoes-cota.ts`):
 *   - LOTE: quando dois ou mais navios têm novidade no mesmo ciclo, sai UMA
 *     mensagem (e UMA notificação) com todos eles — nada de três avisos
 *     seguidos no mesmo minuto;
 *   - REGISTRO: toda novidade notificada vira chave em `navios_avisos`; a
 *     mesma informação nunca é avisada duas vezes (proteção contra repetição);
 *   - ETB: deriva pequena do horário previsto NÃO avisa — só a mudança
 *     acumulada ≥ `NAVIOS_ETB_DELTA_MIN` (padrão 120 min) contra a última
 *     previsão notificada;
 *   - COTA: `NAVIOS_AVISO_MIN` (padrão 20 min) entre avisos, no máximo
 *     `NAVIOS_MAX_HORA` (3) por hora e `NAVIOS_MAX_DIA` (8) por dia;
 *   - URGENTE: "atracou" e "despachado" (o navio já está no berço ou já saiu)
 *     passam do teto, com piso de 15 min — o motorista não perde o que muda a
 *     fila dele;
 *   - o que não coube no lote continua pendente e sai no próximo ciclo.
 */

export const NOME_NAVIOS = "🚢 Navios no Porto";
const CHAVE_SEMEADO = "navios_semeado";
const CHAVE_ULTIMA = "navios_ultima_verificacao";
const INTERVALO_MS = 5 * 60_000;
const MAX_POR_CICLO = 3;

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
 * (`E:<programação>:<ETB>`); quem decide se a mudança é grande o bastante
 * para avisar é `decidirEventosEtb` (comparando com a última notificada).
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

function fatos(ev: EventoNavio, mares: Mare[]) {
  const n = ev.navio;
  const m = ev.manobra;
  return [
    `Evento: ${ev.tipo === "programado" ? "programado para atracar (berço definido)" : ev.tipo === "manobra" ? "atracação confirmada pela praticagem" : ev.tipo === "saiu" ? "despachado (já desatracou e saiu do porto)" : ev.tipo === "etb" ? "previsão de atracação (ETB) reprogramada" : "atracou"}`,
    ev.tipo === "etb" ? `ETB anterior: ${ev.etbAnterior ?? "?"} · ETB novo: ${n.etb}` : "",
    `Navio: ${n.nome} (IMO ${n.imo || "?"}, DWT ${n.dwt || "?"})`,
    `Porto: ${n.porto} · Berço ${n.berco || "?"}`,
    `Carga: ${n.mercadoria}${n.toneladas != null ? ` · ${fmtTon(n.toneladas)} previstas` : " · tonelagem NÃO informada pela fonte (não cite nenhum número de toneladas)"}`,
    n.saldoToneladas != null && ev.tipo === "atracado" ? `Saldo a operar: ${fmtTon(n.saldoToneladas)}` : "",
    n.chegada ? `Chegada: ${n.chegada}` : n.eta ? `ETA: ${n.eta}` : "",
    n.etb ? `ETB: ${n.etb}` : "",
    n.atracacao ? `Atracação: ${n.atracacao}` : "",
    n.agencia ? `Agência: ${n.agencia}` : "",
    m ? `Manobra (SINPRAPAR): ${m.descricao} em ${m.data} às ${m.hora} · ${m.situacao.toLowerCase()}${m.calado ? ` · calado ${m.calado.toFixed(2)} m` : ""}` : "",
    mares.length ? `Próximas marés (referência, Open-Meteo): ${resumoMares(mares)}` : "",
  ].filter(Boolean).join("\n");
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

/** Linha curta de UM evento, para o lote de vários navios no mesmo ciclo. */
export function resumoEvento(ev: EventoNavio): string {
  const n = ev.navio;
  const carga = `${n.mercadoria.toLowerCase()}${n.toneladas != null ? ` (${fmtTon(n.toneladas)})` : ""}`;
  const onde = `${n.porto}, berço ${n.berco || "a definir"}`;
  const m = ev.manobra;
  if (ev.tipo === "etb") {
    return `${n.nome} (${carga}) teve a previsão de atracação reprogramada de ${ev.etbAnterior ?? "?"} para ${n.etb} em ${onde}`;
  }
  if (ev.tipo === "saiu") {
    return `${n.nome} foi despachado e deixou ${n.porto} — a descarga de ${n.mercadoria.toLowerCase()} encerrou`;
  }
  if (ev.tipo === "atracado") {
    return `${n.nome} já atracou em ${onde} com ${carga}${n.saldoToneladas != null ? ` (faltam ${fmtTon(n.saldoToneladas)})` : ""}`;
  }
  if (ev.tipo === "manobra" && m) {
    return `${n.nome} (${carga}) com atracação confirmada para ${m.data} às ${m.hora}, em ${onde}`;
  }
  return `${n.nome} (${carga}) programado para atracar em ${onde}${n.etb ? ` (ETB ${n.etb})` : ""}`;
}

/**
 * Texto pronto do LOTE (sem IA): várias novidades em UMA mensagem, na ordem
 * dos eventos, terminando com a próxima preamar quando houver.
 */
export function textoLotePadrao(evs: EventoNavio[], mares: Mare[] = []): string {
  const cabeca = evs.length === 1 ? "" : `🚢 ${evs.length} novidades nos navios de fertilizantes: `;
  const corpo = evs.map((e, i) => `${evs.length === 1 ? "" : `${i + 1}) `}${resumoEvento(e)}.`).join(" ");
  const mare = mares.find((x) => x.tipo === "preamar");
  const dica = mare ? ` Próxima preamar por volta das ${mare.hora.slice(11, 16)}.` : "";
  return `${cabeca}${corpo}${dica}`.replace(/\s+/g, " ").trim().slice(0, 480);
}

const SISTEMA = `Você avisa os caminhoneiros do Porto de Paranaguá (PR), no chat do app CopaLinks, sobre navios de FERTILIZANTES.
Regras:
- Português do Brasil, tom humano e caloroso de colega do porto; 2 a 4 frases; no máximo 420 caracteres; comece com um emoji (🚢 ou ⚓).
- Use SOMENTE os fatos fornecidos. NUNCA invente, estime ou arredonde tonelagem, horário, berço, calado ou maré.
- Se a tonelagem não foi informada, não escreva número nenhum de toneladas: diga apenas que a quantidade ainda não foi divulgada.
- Diga o navio, o que ele traz (tipo de fertilizante e toneladas, se houver), porto e berço, e o que acontece agora.
- Comente a maré de forma prática quando houver horário de manobra: diga se a manobra fica perto de uma preamar ou de uma baixa-mar, sem afirmar regras oficiais de calado da praticagem.
- Sem título, sem hashtags, sem aspas.`;

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

async function escreverAviso(ev: EventoNavio, mares: Mare[]) {
  const base = textoPadrao(ev, mares);
  try {
    const { texto } = await geminiViaComposio(SISTEMA, `${fatos(ev, mares)}\n\nEscreva o aviso.`, {
      rapido: true, reserva: false, maxTokens: 400, temperatura: 0.6, timeoutMs: 12000,
    });
    const limpo = texto.replace(/^["“”']+|["“”']+$/g, "").trim();
    if (limpo.length < 30) return base;
    if (!tonelagemConfere(limpo, ev.navio)) return base; // IA inventou tonelagem
    return limpo.slice(0, 480);
  } catch {
    return base;
  }
}

async function lerConfig(chave: string) {
  const [l] = await db.select().from(configuracao).where(eq(configuracao.chave, chave)).limit(1);
  return l?.valor ?? null;
}
async function gravarConfig(chave: string, valor: string) {
  await db.insert(configuracao).values({ chave, valor }).onConflictDoUpdate({ target: configuracao.chave, set: { valor } });
}

/**
 * Decide quais eventos de ETB viram aviso. A comparação é SEMPRE contra a
 * última previsão NOTIFICADA (a linha `E:<programação>:<ETB>` mais nova em
 * `navios_avisos`):
 *   - navio ainda não anunciado (sem registro `P:`) → sai: o evento
 *     "programado" apresenta o navio já com o ETB;
 *   - sem linha de referência → registra o ETB atual em silêncio (referência
 *     para o futuro) e não avisa;
 *   - deriva menor que `NAVIOS_ETB_DELTA_MIN` → sai sem registrar nada: a
 *     referência continua sendo a última previsão notificada, então a deriva
 *     ACUMULADA ainda será pega quando cruzar o limite;
 *   - mudança ≥ limite → fica no lote (o registro do aviso vira a nova
 *     referência, e o mesmo ETB nunca é avisado duas vezes — chave única).
 */
async function decidirEventosEtb(novos: EventoNavio[], deltaMin: number): Promise<EventoNavio[]> {
  const resultado: EventoNavio[] = [];
  for (const e of novos) {
    if (e.tipo !== "etb") {
      resultado.push(e);
      continue;
    }
    try {
      const prog = e.navio.programacao;
      const [anunciado] = await db
        .select({ chave: naviosAvisos.chave })
        .from(naviosAvisos)
        .where(like(naviosAvisos.chave, `P:${prog}:%`))
        .limit(1);
      if (!anunciado) continue;
      const [base] = await db
        .select({ chave: naviosAvisos.chave })
        .from(naviosAvisos)
        .where(like(naviosAvisos.chave, `E:${prog}:`.replace(/[_%]/g, "\\$&") + "%"))
        .orderBy(desc(naviosAvisos.criadoEm))
        .limit(1);
      if (!base) {
        // Primeira leitura de ETB depois do navio anunciado: referência calada.
        await db.insert(naviosAvisos).values({ chave: e.chave, navio: e.navio.nome }).onConflictDoNothing();
        continue;
      }
      const etbBase = base.chave.slice(`E:${prog}:`.length);
      const antes = parseEtb(etbBase);
      const depois = parseEtb(e.navio.etb);
      if (!antes || !depois) continue;
      if (Math.abs(depois.getTime() - antes.getTime()) < deltaMin * 60_000) continue;
      resultado.push({ ...e, etbAnterior: etbBase });
    } catch {
      // Sem decisão para este ETB: antes calado do que aviso errado.
    }
  }
  return resultado;
}

/**
 * Nunca joga erro para cima: o cron não pode quebrar por causa dos navios.
 * `forcar` ignora o intervalo de 5 min (testes / admin).
 */
export async function verificarNaviosFertilizantes(opcoes: { forcar?: boolean } = {}): Promise<{
  rodou: boolean; motivo: string; eventos: number; avisados: string[];
}> {
  try {
    const ultima = Number(await lerConfig(CHAVE_ULTIMA)) || 0;
    if (!opcoes.forcar && Date.now() - ultima < INTERVALO_MS) {
      return { rodou: false, motivo: "aguardando intervalo", eventos: 0, avisados: [] };
    }
    await gravarConfig(CHAVE_ULTIMA, String(Date.now()));

    const [lineup, manobras] = await Promise.all([lerLineup(), lerManobras().catch(() => [] as Manobra[])]);
    if (!lineup.length) return { rodou: true, motivo: "line-up vazio ou fora do ar", eventos: 0, avisados: [] };
    const eventos = eventosFertilizantes(lineup, manobras);
    const jaAvisados = eventos.length
      ? new Set((await db.select({ chave: naviosAvisos.chave }).from(naviosAvisos)
          .where(inArray(naviosAvisos.chave, eventos.map((e) => e.chave)))).map((r) => r.chave))
      : new Set<string>();
    const novos = eventos.filter((e) => !jaAvisados.has(e.chave));

    // 1ª vez: só registra o que já existe, sem avisar coisa antiga.
    if (!(await lerConfig(CHAVE_SEMEADO))) {
      if (novos.length) {
        await db.insert(naviosAvisos).values(novos.map((e) => ({ chave: e.chave, navio: e.navio.nome }))).onConflictDoNothing();
      }
      await gravarConfig(CHAVE_SEMEADO, new Date().toISOString());
      return { rodou: true, motivo: `primeira leitura: ${novos.length} evento(s) registrados sem aviso`, eventos: eventos.length, avisados: [] };
    }
    if (!novos.length) return { rodou: true, motivo: "nada novo", eventos: eventos.length, avisados: [] };

    // ETB: só vira aviso a mudança significativa contra a última previsão
    // notificada — deriva pequena sai calada (e não vira referência nova).
    const decididos = await decidirEventosEtb(novos, etbDeltaMin());
    if (!decididos.length) {
      return {
        rodou: true,
        motivo: "nada novo (ETB sem mudança significativa)",
        eventos: eventos.length,
        avisados: [],
      };
    }

    // Um lote por ciclo: várias novidades viram UMA mensagem e UMA notificação.
    const lote = decididos.slice(0, MAX_POR_CICLO);
    // "Atracou" e "despachado" mudam a fila de trabalho: são urgentes e não
    // esperam a cota (só não saem em cima do aviso anterior).
    const urgente = lote.some((e) => e.tipo === "atracado" || e.tipo === "saiu");
    if (!opcoes.forcar) {
      const cota = await checarCota("navios", { urgente });
      if (!cota.liberado) {
        // Nada é reservado: as novidades seguem pendentes para o próximo ciclo.
        return {
          rodou: true,
          motivo: `aguardando cota: ${cota.motivo}`,
          eventos: eventos.length,
          avisados: [],
        };
      }
    }

    // Reserva antes de enviar: dois ciclos ao mesmo tempo não duplicam.
    const reservados = await db
      .insert(naviosAvisos)
      .values(lote.map((e) => ({ chave: e.chave, navio: e.navio.nome })))
      .onConflictDoNothing()
      .returning({ chave: naviosAvisos.chave });
    const chavesReservadas = new Set(reservados.map((r) => r.chave));
    const confirmados = lote.filter((e) => chavesReservadas.has(e.chave));
    if (!confirmados.length) return { rodou: true, motivo: "nada novo", eventos: eventos.length, avisados: [] };

    const mares = await lerMares().catch(() => [] as Mare[]);
    const texto =
      confirmados.length === 1 ? await escreverAviso(confirmados[0], mares) : textoLotePadrao(confirmados, mares);
    const [msg] = await db.insert(chatMensagens).values({ motoristaId: 0, nome: NOME_NAVIOS, texto }).returning();
    if (msg) {
      await notificarMensagemChat({ id: msg.id, motoristaId: 0, nome: NOME_NAVIOS, texto }).catch(() => null);
    }
    await registrarAviso("navios");
    const avisados = confirmados.map((e) => `${e.tipo}:${e.navio.nome}`);
    // Retenção: 60 dias de registros de aviso.
    await db.delete(naviosAvisos).where(sql`${naviosAvisos.criadoEm} < now() - interval '60 days'`);
    return { rodou: true, motivo: `${avisados.length} aviso(s)`, eventos: eventos.length, avisados };
  } catch (e) {
    return { rodou: false, motivo: `falha: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160), eventos: 0, avisados: [] };
  }
}
