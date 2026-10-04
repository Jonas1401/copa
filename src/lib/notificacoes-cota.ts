import { eq } from "drizzle-orm";
import { db } from "@/db";
import { configuracao } from "@/db/schema";

/**
 * COTA DE NOTIFICAÇÕES — o antiexcesso comum aos agentes que falam no chat.
 *
 * Clima, radar da previsão e navios publicam no MESMO chat, e cada publicação
 * vira uma notificação no celular do motorista. Para o aparelho de ninguém
 * virar uma metralhadora de avisos, todo aviso passa por aqui antes de sair:
 *
 *   1. INTERVALO MÍNIMO entre dois avisos do mesmo assunto;
 *   2. TETO POR HORA (nada de rajada de avisos na mesma hora);
 *   3. TETO POR DIA, no horário de Brasília (o dia vira à meia-noite local).
 *
 * Assunto URGENTE — tempo severo que MUDOU de nível e navio que atracou ou
 * saiu — não é engolido pelo teto: ele passa, mas continua respeitando um
 * piso curto (`PISO_URGENTE_MIN`) para dois avisos nunca saírem em cima do
 * outro, e o teto diário dobra como trava de segurança.
 *
 * O estado é UM JSON em `configuracao` (chave `notificacoes_cota`), então
 * sobrevive ao reinício das funções, vale para todos os ciclos do cron e não
 * precisa de tabela nova. Tudo é opcional e configurável por variável de
 * ambiente (veja `.env.example`); sem elas valem os padrões abaixo.
 */

/** Fuso dos motoristas do porto: dia e hora da cota são os de Brasília. */
export const FUSO = "America/Sao_Paulo";

const CHAVE = "notificacoes_cota";

/** Piso entre dois avisos URGENTES (min): nunca dois em cima do outro. */
export const PISO_URGENTE_MIN = 15;

/** Teto de avisos urgentes por dia = teto normal × este fator. */
export const FATOR_URGENTE = 2;

/** Cada assunto tem a sua cota (e o seu silêncio). */
export type Assunto = "clima" | "radar" | "navios";

export const ASSUNTOS: Assunto[] = ["clima", "radar", "navios"];

export type Politica = {
  /** Intervalo mínimo entre dois avisos do mesmo assunto (minutos). */
  intervaloMin: number;
  /** Teto de avisos por hora. */
  maxHora: number;
  /** Teto de avisos por dia (horário de Brasília). */
  maxDia: number;
};

/**
 * Padrões de fábrica — pensados para o motorista não receber aviso demais:
 *
 *   clima  → alerta de tempo ruim: lembrete de 6 em 6 h, no máximo 4 por dia;
 *   radar  → mudanças da previsão: 45 min entre avisos, 2/h, 8/dia;
 *   navios → novidades dos navios: 20 min entre avisos, 3/h, 8/dia.
 */
export const POLITICAS_PADRAO: Record<Assunto, Politica> = {
  clima: { intervaloMin: 360, maxHora: 1, maxDia: 4 },
  radar: { intervaloMin: 45, maxHora: 2, maxDia: 8 },
  navios: { intervaloMin: 20, maxHora: 3, maxDia: 8 },
};

/** Variáveis de ambiente de cada assunto (as três primeiras já documentadas). */
const VARIAVEIS: Record<Assunto, { intervalo: string; maxHora: string; maxDia: string }> = {
  clima: {
    intervalo: "CLIMA_ALERTA_MIN",
    maxHora: "CLIMA_ALERTA_MAX_HORA",
    maxDia: "CLIMA_ALERTA_MAX_DIA",
  },
  radar: {
    intervalo: "CLIMA_MONITOR_AVISO_MIN",
    maxHora: "CLIMA_MONITOR_MAX_HORA",
    maxDia: "CLIMA_MONITOR_MAX_DIA",
  },
  navios: {
    intervalo: "NAVIOS_AVISO_MIN",
    maxHora: "NAVIOS_MAX_HORA",
    maxDia: "NAVIOS_MAX_DIA",
  },
};

const numero = (v: unknown, padrao: number) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

/** Política de um assunto (variáveis de ambiente opcionais). */
export function politica(assunto: Assunto, ambiente: Record<string, string | undefined> = process.env): Politica {
  const padrao = POLITICAS_PADRAO[assunto] ?? POLITICAS_PADRAO.radar;
  const vars = VARIAVEIS[assunto] ?? VARIAVEIS.radar;
  return {
    intervaloMin: numero(ambiente[vars.intervalo], padrao.intervaloMin),
    maxHora: numero(ambiente[vars.maxHora], padrao.maxHora),
    maxDia: numero(ambiente[vars.maxDia], padrao.maxDia),
  };
}

/* ----------------------------------------------------------------- estado */
export type Registro = {
  /** Quando foi o último aviso publicado deste assunto (epoch ms). */
  em: number;
  /** Hora local (chave "AAAA-MM-DDTHH") e quantos avisos saíram nela. */
  hora: { chave: string; n: number };
  /** Dia local (chave "AAAA-MM-DD") e quantos avisos saíram nele. */
  dia: { chave: string; n: number };
};

type Estado = Record<string, Registro>;

/** Dia local no formato AAAA-MM-DD (o dia do motorista, não o do servidor). */
export function diaLocal(agora: Date = new Date(), fuso = FUSO): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** Dia + hora locais ("AAAA-MM-DDTHH") — a janela do teto por hora. */
export function horaLocal(agora: Date = new Date(), fuso = FUSO): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

function registroValido(bruto: unknown): Registro | null {
  const r = bruto as Registro | null;
  if (!r || typeof r.em !== "number") return null;
  return {
    em: r.em,
    hora: { chave: String(r.hora?.chave ?? ""), n: Number(r.hora?.n ?? 0) || 0 },
    dia: { chave: String(r.dia?.chave ?? ""), n: Number(r.dia?.n ?? 0) || 0 },
  };
}

/**
 * Decide se um aviso pode sair AGORA, sem tocar no banco (função pura — é o
 * que os testes exercitam). Nunca lança erro.
 */
export function avaliarCota(
  registro: Registro | null,
  p: Politica,
  agora: Date = new Date(),
  urgente = false,
  /** Piso do aviso urgente (min). Sem ele, vale `PISO_URGENTE_MIN`. */
  pisoUrgenteMin?: number,
): { liberado: boolean; motivo: string } {
  const t = agora.getTime();
  if (registro) {
    const desde = t - registro.em;
    const faltamMin = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
    if (urgente) {
      // Aviso urgente passa do teto, mas nunca cola no anterior.
      const piso = Math.min(p.intervaloMin, pisoUrgenteMin ?? PISO_URGENTE_MIN) * 60_000;
      if (desde < piso) {
        return { liberado: false, motivo: `aguardando ${faltamMin(piso - desde)} min do último aviso` };
      }
      const teto = p.maxDia * FATOR_URGENTE;
      if (registro.dia.chave === diaLocal(agora) && registro.dia.n >= teto) {
        return { liberado: false, motivo: `limite de ${teto} avisos no dia` };
      }
      return { liberado: true, motivo: "" };
    }
    if (desde < p.intervaloMin * 60_000) {
      return { liberado: false, motivo: `aguardando ${faltamMin(p.intervaloMin * 60_000 - desde)} min do último aviso` };
    }
    if (registro.hora.chave === horaLocal(agora) && registro.hora.n >= p.maxHora) {
      return { liberado: false, motivo: `limite de ${p.maxHora} avisos por hora` };
    }
    if (registro.dia.chave === diaLocal(agora) && registro.dia.n >= p.maxDia) {
      return { liberado: false, motivo: `limite de ${p.maxDia} avisos por dia` };
    }
  }
  return { liberado: true, motivo: "" };
}

/** Some com o registro de um assunto (usado nos testes). */
function semRegistro(estado: Estado, assunto: Assunto): Estado {
  const copia = { ...estado };
  delete copia[assunto];
  return copia;
}

async function lerEstado(): Promise<Estado> {
  const [linha] = await db.select().from(configuracao).where(eq(configuracao.chave, CHAVE)).limit(1);
  if (!linha?.valor) return {};
  try {
    const j = JSON.parse(linha.valor) as Estado;
    if (!j || typeof j !== "object") return {};
    const estado: Estado = {};
    for (const assunto of ASSUNTOS) {
      const r = registroValido(j[assunto]);
      if (r) estado[assunto] = r;
    }
    return estado;
  } catch {
    return {};
  }
}

async function gravarEstado(estado: Estado) {
  const valor = JSON.stringify(estado);
  await db
    .insert(configuracao)
    .values({ chave: CHAVE, valor })
    .onConflictDoUpdate({ target: configuracao.chave, set: { valor } });
}

/**
 * Pode avisar agora? `urgente` é para o que o motorista NÃO pode perder
 * (tempo severo que mudou, navio atracado/saiu). Nunca lança erro: se o banco
 * falhar, libera (avisar demais é melhor do que engolir aviso sério).
 */
export async function checarCota(
  assunto: Assunto,
  opcoes: {
    urgente?: boolean;
    agora?: Date;
    ambiente?: Record<string, string | undefined>;
    /** Piso do aviso urgente (min) — ex.: `CLIMA_MONITOR_MIN_GRAVE`. */
    pisoUrgenteMin?: number;
  } = {},
): Promise<{ liberado: boolean; motivo: string }> {
  const agora = opcoes.agora ?? new Date();
  const p = politica(assunto, opcoes.ambiente);
  try {
    const estado = await lerEstado();
    return avaliarCota(estado[assunto] ?? null, p, agora, Boolean(opcoes.urgente), opcoes.pisoUrgenteMin);
  } catch {
    return { liberado: true, motivo: "" };
  }
}

/** Registra que um aviso do assunto saiu AGORA (chamar depois de publicar). */
export async function registrarAviso(assunto: Assunto, agora: Date = new Date()): Promise<void> {
  try {
    const estado = await lerEstado();
    const anterior = estado[assunto] ?? null;
    const dia = diaLocal(agora);
    const hora = horaLocal(agora);
    estado[assunto] = {
      em: agora.getTime(),
      hora: { chave: hora, n: (anterior?.hora.chave === hora ? anterior.hora.n : 0) + 1 },
      dia: { chave: dia, n: (anterior?.dia.chave === dia ? anterior.dia.n : 0) + 1 },
    };
    await gravarEstado(estado);
  } catch {
    /* a cota é aliviada, nunca o aviso: falha aqui não pode quebrar o cron */
  }
}

/** Zera a cota de um assunto (ou de todos) — usado nos testes. */
export async function limparCota(assunto?: Assunto): Promise<void> {
  const estado = await lerEstado();
  const novo = assunto ? semRegistro(estado, assunto) : {};
  await gravarEstado(novo);
}
