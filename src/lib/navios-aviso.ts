import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, configuracao, naviosAvisos } from "@/db/schema";
import { notificarMensagemChat } from "@/lib/chat-push";
import { geminiViaComposio } from "@/lib/composio";
import {
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
 * Três momentos, cada um avisado uma única vez por navio:
 *   1. programado para atracar (APPA → PROGRAMADOS: berço definido);
 *   2. atracação confirmada pela praticagem (SINPRAPAR, manobra EA/AT);
 *   3. atracou (APPA → ATRACADOS).
 * O aviso vira mensagem no chat como "🚢 Navios no Porto" e sai por Web Push
 * (quem silenciou o chat não recebe). O texto é escrito pela IA (Gemini pelo
 * Composio) com tom humano e análise da maré; se a IA falhar, usa um modelo
 * pronto. Na 1ª execução só registra o que já existe (não dispara nada antigo).
 */

export const NOME_NAVIOS = "🚢 Navios no Porto";
const CHAVE_SEMEADO = "navios_semeado";
const CHAVE_ULTIMA = "navios_ultima_verificacao";
const INTERVALO_MS = 5 * 60_000;
const MAX_POR_CICLO = 3;

export type EventoNavio = {
  chave: string;
  tipo: "programado" | "manobra" | "atracado";
  navio: NavioLineup;
  manobra: Manobra | null;
};

const CONFIRMADA = /CONFIRMADA|PR[ÁA]TICO/i;

/** Eventos atuais dos navios de fertilizantes (sem repetir o mesmo navio). */
export function eventosFertilizantes(lineup: NavioLineup[], manobras: Manobra[]): EventoNavio[] {
  const vistos = new Set<string>();
  const eventos: EventoNavio[] = [];
  for (const n of lineup) {
    if (!ehFertilizante(n.mercadoria) || !n.programacao) continue;
    const id = `${n.programacao}:${n.secao}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const m = manobraDo(n, manobras);
    if (n.secao === "PROGRAMADOS") eventos.push({ chave: `P:${n.programacao}`, tipo: "programado", navio: n, manobra: m });
    if (n.secao === "ATRACADOS") eventos.push({ chave: `A:${n.programacao}`, tipo: "atracado", navio: n, manobra: m });
    if (n.secao !== "ATRACADOS" && n.secao !== "DESPACHADOS" && m && (m.codigo === "EA" || m.codigo === "AT") && CONFIRMADA.test(m.situacao)) {
      eventos.push({ chave: `M:${n.programacao}:${m.data} ${m.hora}`, tipo: "manobra", navio: n, manobra: m });
    }
  }
  return eventos;
}

function fatos(ev: EventoNavio, mares: Mare[]) {
  const n = ev.navio;
  const m = ev.manobra;
  return [
    `Evento: ${ev.tipo === "programado" ? "programado para atracar (berço definido)" : ev.tipo === "manobra" ? "atracação confirmada pela praticagem" : "atracou"}`,
    `Navio: ${n.nome} (IMO ${n.imo || "?"}, DWT ${n.dwt || "?"})`,
    `Porto: ${n.porto} · Berço ${n.berco || "?"}`,
    `Carga: ${n.mercadoria}${n.toneladas != null ? ` · ${fmtTon(n.toneladas)} previstas` : " · tonelagem não informada"}`,
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
  if (ev.tipo === "atracado") {
    return `⚓ O ${n.nome} já atracou em ${onde} com ${carga}.${n.saldoToneladas != null ? ` Faltam cerca de ${fmtTon(n.saldoToneladas)} para descarregar.` : ""} Bora que tem serviço, pessoal!`;
  }
  if (ev.tipo === "manobra" && m) {
    return `🚢 Atracação confirmada! O ${n.nome} entra para ${onde} em ${m.data} às ${m.hora}, trazendo ${carga}.${m.calado ? ` Calado de ${m.calado.toFixed(1)} m.` : ""}${dicaMare} Fiquem de olho na escala.`;
  }
  return `🚢 Berço definido! O ${n.nome} está programado para atracar em ${onde} com ${carga}.${dicaMare} Assim que a praticagem confirmar o horário, eu aviso.`;
}

const SISTEMA = `Você avisa os caminhoneiros do Porto de Paranaguá (PR), no chat do app CopaLinks, sobre navios de FERTILIZANTES.
Regras:
- Português do Brasil, tom humano e caloroso de colega do porto; 2 a 4 frases; no máximo 420 caracteres; comece com um emoji (🚢 ou ⚓).
- Use SOMENTE os fatos fornecidos. Nunca invente tonelagem, horário, berço ou maré.
- Diga o navio, o que ele traz (tipo de fertilizante e toneladas, se houver), porto e berço, e o que acontece agora.
- Comente a maré de forma prática quando houver horário de manobra: diga se a manobra fica perto de uma preamar ou de uma baixa-mar, sem afirmar regras oficiais de calado da praticagem.
- Sem título, sem hashtags, sem aspas.`;

async function escreverAviso(ev: EventoNavio, mares: Mare[]) {
  const base = textoPadrao(ev, mares);
  try {
    const { texto } = await geminiViaComposio(SISTEMA, `${fatos(ev, mares)}\n\nEscreva o aviso.`, {
      rapido: true, reserva: false, maxTokens: 400, temperatura: 0.6, timeoutMs: 12000,
    });
    const limpo = texto.replace(/^["“”']+|["“”']+$/g, "").trim();
    return limpo.length >= 30 ? limpo.slice(0, 480) : base;
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

    const mares = await lerMares().catch(() => [] as Mare[]);
    const avisados: string[] = [];
    for (const ev of novos.slice(0, MAX_POR_CICLO)) {
      // Reserva antes de enviar: dois ciclos ao mesmo tempo não duplicam.
      const [reservado] = await db.insert(naviosAvisos).values({ chave: ev.chave, navio: ev.navio.nome })
        .onConflictDoNothing().returning({ chave: naviosAvisos.chave });
      if (!reservado) continue;
      const texto = await escreverAviso(ev, mares);
      const [msg] = await db.insert(chatMensagens).values({ motoristaId: 0, nome: NOME_NAVIOS, texto }).returning();
      await notificarMensagemChat({ id: msg.id, motoristaId: 0, nome: NOME_NAVIOS, texto }).catch(() => null);
      avisados.push(`${ev.tipo}:${ev.navio.nome}`);
    }
    // Retenção: 60 dias de registros de aviso.
    await db.delete(naviosAvisos).where(sql`${naviosAvisos.criadoEm} < now() - interval '60 days'`);
    return { rodou: true, motivo: `${avisados.length} aviso(s)`, eventos: eventos.length, avisados };
  } catch (e) {
    return { rodou: false, motivo: `falha: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160), eventos: 0, avisados: [] };
  }
}
