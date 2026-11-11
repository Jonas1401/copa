import { and, eq, sql } from "drizzle-orm";
import { comBanco, db, temBancoConfigurado } from "@/db";
import { portalSituacoes } from "@/db/schema";
import { garantirTabelasPortal } from "@/lib/portal-copadubo";

/**
 * SITUAÇÃO DO PONTO NO PORTAL — quem decide que “saiu trabalho”.
 *
 * O monitoramento do número do ponto depende só do Status do Portal do
 * Motorista: o app olha a tela de Status na conta do próprio motorista de
 * minuto em minuto e é a TROCA da situação que gera o aviso —
 *
 *   ATIVO → ESCALADO            “Seu ponto foi ESCALADO” + as linhas do Status
 *   ATIVO → EM DISPENSA         “Seu ponto foi para a DISPENSA” + motivo
 *   ESCALADO/DISPENSA → ATIVO   “Seu ponto está ATIVO” (voltou para a fila)
 *
 * O quadro público da fila não decide mais a saída: continua mostrando a fila
 * e avisando que a vez está chegando. Motorista sem CPF/senha do portal não
 * tem aviso de saída — o app pede o cadastro.
 *
 * Aqui ficam a configuração, a situação guardada de cada ponto e as regras
 * puras. Nada de rede e nada de aviso: quem lê e avisa é o `portal-monitor`.
 */

/* ------------------------------------------------------------ configuração */

export type FontePortal = "portal" | "quadro";

/**
 * Quem decide a saída do ponto. O padrão é `portal` (o Status do Portal do
 * Motorista). `PORTAL_FONTE_SAIDA=quadro` no ambiente volta ao comportamento
 * anterior — o quadro percebe a saída e o portal é consultado uma vez para
 * dizer o que aconteceu. É a chave de retorno se a leitura do Status falhar
 * no portal de verdade.
 */
export function fontePortal(): FontePortal {
  return (process.env.PORTAL_FONTE_SAIDA ?? "").trim().toLowerCase() === "quadro" ? "quadro" : "portal";
}

/**
 * De quanto em quanto tempo o Status de cada motorista é olhado. Padrão: 1
 * minuto. `PORTAL_INTERVALO_MIN` (1 a 60) muda sem mexer no código — útil se
 * o portal reclamar de tantas consultas.
 */
export function intervaloStatusMs(): number {
  const minutos = Number((process.env.PORTAL_INTERVALO_MIN ?? "").trim());
  return (Number.isFinite(minutos) && minutos >= 1 && minutos <= 60 ? Math.round(minutos) : 1) * 60_000;
}

/**
 * Espera gravada entre duas leituras do mesmo motorista. Fica 15 s abaixo do
 * intervalo: o despertador de 1 minuto nunca cai exatamente em cima da marca,
 * e alguns milissegundos de atraso não fazem a leitura pular um ciclo inteiro.
 */
export function esperaEntreLeiturasMs(intervaloMs = intervaloStatusMs()): number {
  return Math.max(30_000, intervaloMs - 15_000);
}

/* ----------------------------------------------------------- regras puras */

/** Situações em que o ponto está FORA da fila, trabalhando. */
const TURNOS_TRABALHO: readonly string[] = ["ESCALADO", "EM ATENDIMENTO"];
const TURNO_DISPENSA = "EM DISPENSA";

type Familia = "trabalho" | "dispensa" | "fila";

function familia(turno: string): Familia {
  if (TURNOS_TRABALHO.includes(turno)) return "trabalho";
  return turno === TURNO_DISPENSA ? "dispensa" : "fila";
}

export type AvisoDoPortal = "saiu" | "dispensa" | "voltou" | null;

/**
 * Que aviso a TROCA de situação no portal pede.
 *
 * `anterior` vazio = o app nunca tinha lido a situação deste ponto: a primeira
 * leitura é só o ponto de partida. O que já estava assim antes de o app olhar
 * não é novidade — cadastrar a senha ou publicar esta versão não dispara aviso
 * de uma escala antiga.
 */
export function avisoDaTroca(e: { anterior: string | null | undefined; novo: string }): AvisoDoPortal {
  if (!e.anterior) return null;
  const antes = familia(e.anterior);
  const agora = familia(e.novo);
  if (antes === agora) return null; // ESCALADO → EM ATENDIMENTO é o mesmo trabalho
  if (agora === "trabalho") return "saiu";
  if (agora === "dispensa") return "dispensa";
  return "voltou"; // estava fora (trabalho ou dispensa) e voltou para a fila
}

/** Por quanto tempo uma situação lida continua valendo sem uma leitura nova. */
export function validadeSituacaoMs(intervaloMs = intervaloStatusMs()): number {
  return Math.max(3 * intervaloMs, 5 * 60_000);
}

export type SituacaoPonto = typeof portalSituacoes.$inferSelect;

/** A situação foi lida há pouco (uma leitura antiga não afirma nada sobre agora). */
export function situacaoFresca(
  s: Pick<SituacaoPonto, "lidoEm"> | null | undefined,
  agora = Date.now(),
  intervaloMs = intervaloStatusMs(),
): boolean {
  if (!s) return false;
  const idade = agora - s.lidoEm.getTime();
  return idade <= validadeSituacaoMs(intervaloMs);
}

/* ------------------------------------------------------ situação guardada */

export async function situacoesDoMotorista(motoristaId: number): Promise<SituacaoPonto[]> {
  if (!temBancoConfigurado) return [];
  await garantirTabelasPortal();
  return comBanco(() => db.select().from(portalSituacoes).where(eq(portalSituacoes.motoristaId, motoristaId)));
}

export type TrocaDeSituacao = {
  /** ESTA chamada trocou a situação no banco — só ela pode avisar. */
  trocou: boolean;
  /** Situação que estava guardada (vazio = nunca lida para este ponto). */
  anterior: string | null;
  /** Quando o app viu a situação atual começar (relógio do banco). */
  mudouEm: Date | null;
};

/**
 * Guarda a situação que o portal mostrou para um ponto. A troca é atômica: se
 * duas funções lerem a mesma mudança ao mesmo tempo, só uma recebe
 * `trocou: true` — é o que impede o aviso repetido.
 */
export async function registrarSituacaoLida(dados: {
  pontoId: number;
  motoristaId: number;
  /** Código como o portal escreve (A032). */
  codigo: string;
  turno: string;
}): Promise<TrocaDeSituacao> {
  await garantirTabelasPortal();
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const [atual] = await comBanco(() =>
      db.select().from(portalSituacoes).where(eq(portalSituacoes.pontoId, dados.pontoId)).limit(1),
    );

    if (!atual) {
      const [nova] = await comBanco(() =>
        db
          .insert(portalSituacoes)
          .values({ ...dados, mudouEm: sql`now()`, lidoEm: sql`now()` })
          .onConflictDoNothing()
          .returning({ mudouEm: portalSituacoes.mudouEm }),
      );
      if (nova) return { trocou: true, anterior: null, mudouEm: nova.mudouEm };
      continue; // outra função gravou no mesmo instante: relê e compara
    }

    // O cadastro do ponto mudou de número ou de dono: a situação antiga não é dele.
    const mesmoPonto = atual.codigo === dados.codigo && atual.motoristaId === dados.motoristaId;
    if (mesmoPonto && atual.turno === dados.turno) {
      await comBanco(() =>
        db.update(portalSituacoes).set({ lidoEm: sql`now()` }).where(eq(portalSituacoes.pontoId, dados.pontoId)),
      );
      return { trocou: false, anterior: atual.turno, mudouEm: atual.mudouEm };
    }

    const [trocada] = await comBanco(() =>
      db
        .update(portalSituacoes)
        .set({ motoristaId: dados.motoristaId, codigo: dados.codigo, turno: dados.turno, mudouEm: sql`now()`, lidoEm: sql`now()` })
        .where(
          and(
            eq(portalSituacoes.pontoId, dados.pontoId),
            eq(portalSituacoes.codigo, atual.codigo),
            eq(portalSituacoes.motoristaId, atual.motoristaId),
            eq(portalSituacoes.turno, atual.turno),
          ),
        )
        .returning({ mudouEm: portalSituacoes.mudouEm }),
    );
    if (trocada) return { trocou: true, anterior: mesmoPonto ? atual.turno : null, mudouEm: trocada.mudouEm };
    // Outra função trocou antes: relê (pode ser que já esteja igual).
  }
  return { trocou: false, anterior: dados.turno, mudouEm: null };
}
