import { and, desc, eq, lt, sql } from "drizzle-orm";
import { comBanco, db, temBancoConfigurado } from "@/db";
import { pontos, portalMotoristaAcessos, portalTicketConfig, portalTickets } from "@/db/schema";
import { calcular, type Carga } from "@/lib/frete";
import { acessoPortalDoMotorista, garantirTabelasPortal, lerTicketsNaSessaoGuardada, type TicketsLidosNoPortal } from "@/lib/portal-copadubo";
import { normalizarCodigoPortal } from "@/lib/portal-copadubo-parse";
import type { LancamentoDoTicket } from "@/lib/portal-ticket-parse";
import type { ContaDoTicket, PontoDoResumo, ResumoDoTicket, ViagemGuardada } from "@/lib/ticket-card";

export type { ContaDoTicket, PontoDoResumo, ResumoDoTicket, ViagemGuardada };

/**
 * CONSULTA DE PONTO — as viagens da semana e a comissão do motorista.
 *
 * O motorista cadastra a porcentagem dele no card “Consulta de Ponto”. A partir
 * daí, de 5 em 5 minutos, na carona da olhada do Status (a conta dele acabou de
 * abrir), a mesma sessão abre a aba “Ticket” do Portal do Motorista, escolhe
 * cada ponto que ele cadastrou no app e a semana de hoje, e toca em “Gerar”.
 * As viagens que a tela mostra ficam guardadas AQUI, por ponto e por semana.
 *
 * A conta é a MESMA da calculadora de frete (`frete.ts`, card “Cálculo de
 * Frete”): frete da viagem = Quant (t) × Valor (R$/t); bruto = soma das
 * viagens; comissão = bruto × porcentagem. O card mostra só três números:
 * viagens, valor bruto e comissão.
 *
 * Regras:
 *   - só é lido o Ticket de quem LIGOU a consulta (cadastrou a porcentagem);
 *   - a leitura nunca faz login: usa a sessão que a olhada do Status deixou
 *     aberta. Sem sessão, espera a próxima olhada;
 *   - leitura que não veio inteira não muda nada: a última leitura boa continua
 *     valendo, com a hora dela e o motivo da falha;
 *   - as viagens são do PRÓPRIO motorista: só ele vê. O painel do administrador
 *     mostra apenas se a leitura está funcionando — nunca peso, valor ou
 *     comissão; o diagnóstico guardado também não traz esses números.
 *
 * Aqui ficam a configuração, o que está guardado e a conta. Quem abre a tela é
 * o `portal-copadubo` (`lerTicketsNaSessaoGuardada`); quem decide a hora é o
 * `portal-monitor`.
 */

/* ------------------------------------------------------------ configuração */

/** `PORTAL_TICKET=desligado` desliga a leitura da aba “Ticket” para todo mundo. */
export function ticketLigado(): boolean {
  return !/^(desligado|desligada|off|nao|não|0|false)$/i.test((process.env.PORTAL_TICKET ?? "").trim());
}

/**
 * De quanto em quanto tempo o Ticket de cada motorista é lido. O padrão é 5
 * minutos; `PORTAL_TICKET_INTERVALO_MIN` aceita de 2 a 60.
 */
export function intervaloTicketMs(): number {
  const n = Number((process.env.PORTAL_TICKET_INTERVALO_MIN ?? "").trim().replace(",", "."));
  const minutos = Number.isFinite(n) && n > 0 ? Math.min(60, Math.max(2, n)) : 5;
  return Math.round(minutos * 60_000);
}

/** Pontos consultados por leitura (cada ponto é um “Gerar”). Com mais pontos, eles se revezam. */
export const MAX_PONTOS_POR_LEITURA = 3;
/** Entre um “Atualizar” e outro do mesmo motorista. */
export const ESPERA_ENTRE_ATUALIZAR_MS = 20_000;
/** Depois de uma tentativa que não leu nada, a próxima pode vir mais cedo. */
export const ESPERA_APOS_FALHA_DO_TICKET_MS = 60_000;
/** Semanas guardadas por ponto (as mais antigas saem). */
const DIAS_GUARDADOS = 70;

/** A leitura guardada ainda vale como “agora” (três ciclos, no mínimo 20 min). */
export function validadeDoTicketMs(intervaloMs = intervaloTicketMs()): number {
  return Math.max(20 * 60_000, 3 * intervaloMs);
}

/**
 * Porcentagem da comissão em centésimos (18,5 % → 1850): maior que zero, até
 * 100, com no máximo duas casas. Qualquer outra coisa → null.
 */
export function porcentagemEmCentesimos(valor: unknown): number | null {
  const texto = typeof valor === "number" ? String(valor) : typeof valor === "string" ? valor.replace("%", "").replace(",", ".").trim() : "";
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(texto)) return null;
  const centesimos = Math.round(Number(texto) * 100);
  return centesimos >= 1 && centesimos <= 10_000 ? centesimos : null;
}

/* ------------------------------------------------------------------ a conta */

/**
 * A conta da calculadora de frete (`calcular`, em `frete.ts`), sem tirar nem
 * pôr: cada viagem vira uma “carga” (Quant × Valor) e a porcentagem é aplicada
 * sobre a soma.
 */
export function contaDasViagens(viagens: Pick<ViagemGuardada, "quant" | "valor">[], porcentagem: number): ContaDoTicket {
  const cargas: Carga[] = viagens.map((v, i) => ({
    id: `v-${i}`,
    quant: v.quant,
    valor: v.valor,
    subtotal: v.quant * v.valor,
    linha: "",
    confianca: "alta",
  }));
  const c = calcular({ cargas, ponto: "" }, porcentagem);
  return { viagens: c.cargas.length, bruto: c.bruto, comissao: c.ganho, toneladas: c.toneladas };
}

/** Confere o que saiu do banco: um valor estragado nunca vira viagem. */
export function viagensValidas(v: unknown): ViagemGuardada[] | null {
  if (!Array.isArray(v)) return null;
  const saida: ViagemGuardada[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") return null;
    const { quant, valor, servico, data, hora } = item as Record<string, unknown>;
    if (typeof quant !== "number" || !Number.isFinite(quant) || quant <= 0 || quant > 1_000) return null;
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0 || valor > 10_000) return null;
    if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data) || typeof hora !== "string" || !/^\d{2}:\d{2}$/.test(hora)) return null;
    saida.push({ quant, valor, servico: typeof servico === "string" ? servico.slice(0, 80) : "", data, hora });
  }
  return saida;
}

/* ------------------------------------------------------------ o que guarda */

export type ConfigDoTicket = {
  motoristaId: number;
  /** 18.5 = 18,5 %. */
  porcentagem: number;
  semana: { inicio: string; fim: string } | null;
  tentativaEm: Date | null;
  erro: string | null;
  diagnostico: string[];
};

const linhasDe = (texto: string | null) => (texto ? texto.split("\n").filter(Boolean) : []);
const semanaValida = (inicio: string | null, fim: string | null) =>
  inicio && fim && /^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim) && inicio <= fim ? { inicio, fim } : null;

/** A consulta deste motorista (null = ele não ligou). */
export async function configDoTicket(motoristaId: number): Promise<ConfigDoTicket | null> {
  if (!temBancoConfigurado) return null;
  await garantirTabelasPortal();
  const [linha] = await comBanco(() => db.select().from(portalTicketConfig).where(eq(portalTicketConfig.motoristaId, motoristaId)).limit(1));
  if (!linha) return null;
  return {
    motoristaId,
    porcentagem: linha.porcentagemCentesimos / 100,
    semana: semanaValida(linha.semanaInicio, linha.semanaFim),
    tentativaEm: linha.tentativaEm,
    erro: linha.erro,
    diagnostico: linhasDe(linha.diagnostico),
  };
}

/**
 * Cadastra (ou troca) a porcentagem — é o que LIGA a consulta. A próxima
 * leitura fica liberada para já.
 */
export async function salvarPorcentagemDoTicket(motoristaId: number, centesimos: number) {
  await garantirTabelasPortal();
  await comBanco(() =>
    db
      .insert(portalTicketConfig)
      .values({ motoristaId, porcentagemCentesimos: centesimos, proximaLeituraEm: null })
      .onConflictDoUpdate({
        target: portalTicketConfig.motoristaId,
        set: { porcentagemCentesimos: centesimos, atualizadoEm: new Date() },
      }),
  );
}

/** Desliga a consulta do motorista: a porcentagem e as viagens guardadas saem do banco. */
export async function desligarTicket(motoristaId: number) {
  if (!temBancoConfigurado) return false;
  await garantirTabelasPortal();
  await comBanco(() => db.delete(portalTickets).where(eq(portalTickets.motoristaId, motoristaId)));
  const apagados = await comBanco(() =>
    db.delete(portalTicketConfig).where(eq(portalTicketConfig.motoristaId, motoristaId)).returning({ id: portalTicketConfig.motoristaId }),
  );
  return apagados.length > 0;
}

/** Os pontos que o motorista cadastrou no app, como o portal escreve (A032), sem repetir. */
export async function codigosDoMotorista(motoristaId: number): Promise<string[]> {
  const meus = await comBanco(() =>
    db.select({ livro: pontos.livro, numero: pontos.numero }).from(pontos).where(eq(pontos.motoristaId, motoristaId)).orderBy(pontos.ordem, pontos.id),
  );
  return [...new Set(meus.map((p) => normalizarCodigoPortal(`${p.livro}${p.numero}`)))];
}

/**
 * Reserva a leitura deste motorista, se já pode começar, e marca a próxima
 * para daqui a `esperaMs`. A reserva é atômica: duas funções rodando juntas
 * (cron + app aberto) nunca abrem o Ticket da mesma conta ao mesmo tempo.
 * `forcar` (o botão “Atualizar”) não espera o ciclo — só o intervalo curto
 * entre um toque e outro.
 */
export async function reservarLeituraDoTicket(motoristaId: number, opcoes: { esperaMs?: number; forcar?: boolean } = {}): Promise<boolean> {
  if (!temBancoConfigurado) return false;
  await garantirTabelasPortal();
  const espera = Math.max(30_000, Math.round(opcoes.esperaMs ?? intervaloTicketMs()));
  const linhas = await comBanco(() =>
    db
      .update(portalTicketConfig)
      .set({ proximaLeituraEm: sql`now() + (${espera} * interval '1 millisecond')`, tentativaEm: sql`now()` })
      .where(
        opcoes.forcar
          ? sql`${portalTicketConfig.motoristaId} = ${motoristaId} and (${portalTicketConfig.tentativaEm} is null or ${portalTicketConfig.tentativaEm} <= now() - (${ESPERA_ENTRE_ATUALIZAR_MS} * interval '1 millisecond'))`
          : sql`${portalTicketConfig.motoristaId} = ${motoristaId} and (${portalTicketConfig.proximaLeituraEm} is null or ${portalTicketConfig.proximaLeituraEm} <= now())`,
      )
      .returning({ id: portalTicketConfig.motoristaId }),
  );
  return linhas.length > 0;
}

/**
 * Quais pontos consultar nesta leitura: até `MAX_PONTOS_POR_LEITURA`. Primeiro
 * os que nunca foram tentados, depois os de tentativa mais antiga (rodízio);
 * no empate, quem ficou sem leitura na última tentativa vem antes — um ponto
 * que não coube no tempo de uma visita abre a próxima.
 */
export async function pontosDaVez(motoristaId: number, codigos: string[], maximo = MAX_PONTOS_POR_LEITURA): Promise<string[]> {
  const linhas = await comBanco(() =>
    db
      .select({ codigo: portalTickets.codigo, tentativaEm: portalTickets.tentativaEm, erro: portalTickets.erro })
      .from(portalTickets)
      .where(eq(portalTickets.motoristaId, motoristaId))
      .orderBy(desc(portalTickets.tentativaEm)),
  );
  // A tentativa mais recente de cada ponto (as linhas vêm da mais nova para a mais antiga).
  const ultima = new Map<string, { quando: number; falhou: boolean }>();
  for (const l of linhas) if (!ultima.has(l.codigo)) ultima.set(l.codigo, { quando: l.tentativaEm.getTime(), falhou: Boolean(l.erro) });
  return codigos
    .map((codigo, ordem) => ({ codigo, ordem, quando: ultima.get(codigo)?.quando ?? 0, falhou: ultima.get(codigo)?.falhou ?? false }))
    .sort((a, b) => a.quando - b.quando || Number(b.falhou) - Number(a.falhou) || a.ordem - b.ordem)
    .slice(0, maximo)
    .map((x) => x.codigo);
}

/** O dia `dias` antes de `iso` (aaaa-mm-dd). */
function diasAntes(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Guarda o que a leitura trouxe. Ponto que veio inteiro: as viagens da semana
 * (substituem as da leitura anterior da MESMA semana). Ponto que não veio: só
 * o motivo e a hora da tentativa — as viagens guardadas continuam como estavam.
 */
export async function guardarTicketsLidos(motoristaId: number, tentados: string[], lida: TicketsLidosNoPortal) {
  const semana = lida.semana;
  // Uma hora só para a leitura inteira: é por ela que o rodízio sabe quais pontos foram juntos.
  const quando = new Date();
  const geral = semana ? null : (Object.values(lida.falhas)[0] ?? "a leitura não chegou à tela de lançamentos");
  if (semana) {
    for (const codigo of tentados) {
      const viagens = lida.pontos[codigo];
      if (viagens) {
        const lancamentos: ViagemGuardada[] = viagens.map((v: LancamentoDoTicket) => ({ quant: v.quant, valor: v.valor, servico: v.servico, data: v.data, hora: v.hora }));
        await comBanco(() =>
          db
            .insert(portalTickets)
            .values({ motoristaId, codigo, semanaInicio: semana.inicio, semanaFim: semana.fim, lancamentos, lidoEm: quando, tentativaEm: quando, erro: null })
            .onConflictDoUpdate({
              target: [portalTickets.motoristaId, portalTickets.codigo, portalTickets.semanaInicio],
              set: { semanaFim: semana.fim, lancamentos, lidoEm: quando, tentativaEm: quando, erro: null },
            }),
        );
      } else {
        const erro = (lida.falhas[codigo] ?? "a tela não trouxe as viagens deste ponto").slice(0, 300);
        await comBanco(() =>
          db
            .insert(portalTickets)
            .values({ motoristaId, codigo, semanaInicio: semana.inicio, semanaFim: semana.fim, lancamentos: null, lidoEm: null, tentativaEm: quando, erro })
            .onConflictDoUpdate({
              target: [portalTickets.motoristaId, portalTickets.codigo, portalTickets.semanaInicio],
              set: { tentativaEm: quando, erro },
            }),
        );
      }
    }
    // Semanas antigas saem (a tela só mostra a semana de hoje).
    const limite = diasAntes(semana.inicio, DIAS_GUARDADOS);
    await comBanco(() => db.delete(portalTickets).where(and(eq(portalTickets.motoristaId, motoristaId), lt(portalTickets.semanaInicio, limite)))).catch(() => null);
  }
  const algumLido = tentados.some((c) => lida.pontos[c]);
  await comBanco(() =>
    db
      .update(portalTicketConfig)
      .set({
        ...(semana ? { semanaInicio: semana.inicio, semanaFim: semana.fim } : {}),
        tentativaEm: quando,
        erro: geral ? geral.slice(0, 300) : null,
        diagnostico: lida.diagnostico.join("\n").slice(0, 2_000),
        // Nada lido: a próxima tentativa não espera o ciclo inteiro.
        ...(algumLido ? {} : { proximaLeituraEm: sql`least(${portalTicketConfig.proximaLeituraEm}, now() + (${ESPERA_APOS_FALHA_DO_TICKET_MS} * interval '1 millisecond'))` }),
      })
      .where(eq(portalTicketConfig.motoristaId, motoristaId)),
  );
}

export type LeituraDoTicket = {
  /** A aba “Ticket” foi aberta nesta chamada. */
  tentou: boolean;
  /** Por que não tentou (só quando `tentou` é falso). */
  motivo?: "desligado" | "sem_porcentagem" | "sem_pontos" | "nao_e_a_hora" | "sem_acesso";
  /** Pontos que vieram com a tela de lançamentos inteira. */
  lidos: string[];
  /** Pontos tentados que não vieram, com o motivo. */
  falhas: Record<string, string>;
  /** Nunca traz peso nem valor. */
  diagnostico: string[];
};

/**
 * Lê o Ticket de UM motorista, se ele ligou a consulta e já é a hora (ou
 * `forcar`), com a sessão guardada — nunca faz login. `jaNaFila`: quem chama
 * já está dentro do `umPorVez` deste motorista.
 */
export async function atualizarTicketsDoMotorista(
  motoristaId: number,
  opcoes: { buscar?: typeof fetch; forcar?: boolean; agora?: Date; jaNaFila?: boolean } = {},
): Promise<LeituraDoTicket> {
  const nada = (motivo: LeituraDoTicket["motivo"]): LeituraDoTicket => ({ tentou: false, motivo, lidos: [], falhas: {}, diagnostico: [] });
  if (!temBancoConfigurado || !ticketLigado()) return nada("desligado");
  const config = await configDoTicket(motoristaId);
  if (!config) return nada("sem_porcentagem");
  const codigos = await codigosDoMotorista(motoristaId);
  if (!codigos.length) return nada("sem_pontos");
  if (!(await reservarLeituraDoTicket(motoristaId, { forcar: opcoes.forcar }))) return nada("nao_e_a_hora");

  const daVez = await pontosDaVez(motoristaId, codigos);
  const lida = await lerTicketsNaSessaoGuardada(motoristaId, { buscar: opcoes.buscar, codigos: daVez, agora: opcoes.agora, jaNaFila: opcoes.jaNaFila });
  if (!lida) {
    const motivo = "a conta não tem acesso ativo ao Portal do Motorista";
    await comBanco(() =>
      db.update(portalTicketConfig).set({ tentativaEm: new Date(), erro: motivo, diagnostico: `Ticket: ${motivo}.` }).where(eq(portalTicketConfig.motoristaId, motoristaId)),
    ).catch(() => null);
    return { tentou: false, motivo: "sem_acesso", lidos: [], falhas: {}, diagnostico: [`Ticket: ${motivo}.`] };
  }
  await guardarTicketsLidos(motoristaId, daVez, lida);
  const diagnostico = [...lida.diagnostico];
  if (daVez.length < codigos.length) {
    diagnostico.push(`Ticket: ${daVez.length} de ${codigos.length} pontos consultados nesta leitura (${daVez.join(", ")}); os outros entram nas próximas.`);
  }
  return { tentou: true, lidos: daVez.filter((c) => lida.pontos[c]), falhas: lida.falhas, diagnostico };
}

/**
 * A passada periódica: lê o Ticket dos motoristas que ligaram a consulta e
 * cuja leitura já pode começar — quem espera há mais tempo primeiro, um de cada
 * vez. Vem DEPOIS da rodada do Status (que acabou de conferir a sessão de cada
 * conta e é quem avisa a saída): o Ticket nunca atrasa esse aviso.
 *
 * `comecarAte`: hora (em ms) depois da qual nenhuma leitura nova começa — o
 * que sobrar fica para a próxima rodada (nada fica reservado).
 */
export async function lerTicketsDevidos(opcoes: { buscar?: typeof fetch; comecarAte: number; limite?: number; agora?: Date }) {
  const resumo = { motoristas: 0, pontos: 0, falhas: 0 };
  if (!temBancoConfigurado || !ticketLigado() || Date.now() >= opcoes.comecarAte) return resumo;
  await garantirTabelasPortal();
  const devidos = await comBanco(() =>
    db
      .select({ motoristaId: portalTicketConfig.motoristaId })
      .from(portalTicketConfig)
      .innerJoin(portalMotoristaAcessos, eq(portalMotoristaAcessos.motoristaId, portalTicketConfig.motoristaId))
      .where(
        // Só conta com acesso ativo e sessão aberta pela olhada do Status: o Ticket nunca faz login.
        sql`${portalMotoristaAcessos.ativo} = 1 and ${portalMotoristaAcessos.sessaoCifrada} is not null and (${portalTicketConfig.proximaLeituraEm} is null or ${portalTicketConfig.proximaLeituraEm} <= now())`,
      )
      .orderBy(sql`${portalTicketConfig.proximaLeituraEm} asc nulls first`)
      .limit(Math.max(1, Math.min(opcoes.limite ?? 6, 20))),
  );
  for (const { motoristaId } of devidos) {
    if (Date.now() >= opcoes.comecarAte) break;
    try {
      const r = await atualizarTicketsDoMotorista(motoristaId, { buscar: opcoes.buscar, agora: opcoes.agora });
      if (!r.tentou) continue;
      resumo.motoristas += 1;
      resumo.pontos += r.lidos.length;
      resumo.falhas += Object.keys(r.falhas).length;
    } catch (e) {
      resumo.falhas += 1;
      console.error("[portal-ticket] leitura falhou:", e instanceof Error ? e.message : e);
    }
  }
  return resumo;
}

/* ------------------------------------------------------------------ resumo */

/**
 * O motivo guardado num ponto ainda é o da ÚLTIMA tentativa? Uma falha geral
 * mais nova (a aba nem abriu: sessão fechada, portal fora do ar) não chega a
 * regravar o motivo de cada ponto; nesse caso vale só o motivo geral — o
 * antigo do ponto não é mais “a última tentativa”.
 */
function motivoDoPontoVale(config: Pick<ConfigDoTicket, "erro" | "tentativaEm">, tentativaDoPonto: Date | null): boolean {
  if (!config.erro || !config.tentativaEm || !tentativaDoPonto) return true;
  return tentativaDoPonto.getTime() >= config.tentativaEm.getTime();
}

const CONTA_VAZIA: ContaDoTicket = { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 };

/** O que o card e a página “Consulta de Ponto” mostram para este motorista. Não fala com o portal. */
export async function resumoDoTicket(motoristaId: number, agora = Date.now()): Promise<ResumoDoTicket> {
  const intervaloMin = Math.round(intervaloTicketMs() / 60_000);
  const vazio: ResumoDoTicket = {
    disponivel: temBancoConfigurado && ticketLigado(),
    ligado: false,
    porcentagem: null,
    temAcesso: false,
    totalPontos: 0,
    semana: null,
    conta: CONTA_VAZIA,
    pontos: [],
    completo: false,
    lidoEm: null,
    recente: false,
    tentativaEm: null,
    erro: null,
    intervaloMin,
    diagnostico: [],
  };
  if (!temBancoConfigurado) return vazio;
  await garantirTabelasPortal();
  const [config, acesso, codigos] = await Promise.all([configDoTicket(motoristaId), acessoPortalDoMotorista(motoristaId), codigosDoMotorista(motoristaId)]);
  const base = { ...vazio, temAcesso: Boolean(acesso && acesso.ativo === 1), totalPontos: codigos.length };
  if (!config) return base;

  const semana = config.semana;
  const linhas = semana
    ? await comBanco(() => db.select().from(portalTickets).where(and(eq(portalTickets.motoristaId, motoristaId), eq(portalTickets.semanaInicio, semana.inicio))))
    : [];
  const pontosDoResumo: PontoDoResumo[] = codigos.map((codigo) => {
    const linha = linhas.find((l) => l.codigo === codigo);
    const viagens = linha?.lidoEm ? viagensValidas(linha.lancamentos) : null;
    return {
      codigo,
      viagens,
      conta: viagens ? contaDasViagens(viagens, config.porcentagem) : null,
      lidoEm: viagens && linha?.lidoEm ? linha.lidoEm.toISOString() : null,
      tentativaEm: linha?.tentativaEm ? linha.tentativaEm.toISOString() : null,
      erro:
        (motivoDoPontoVale(config, linha?.tentativaEm ?? null) ? linha?.erro : null) ??
        (linha && linha.lidoEm && !viagens ? "o que estava guardado deste ponto não pôde ser lido" : null),
    };
  });
  const lidos = pontosDoResumo.filter((p) => p.viagens);
  const todas = lidos.flatMap((p) => p.viagens ?? []);
  const maisAntiga = lidos.map((p) => p.lidoEm as string).sort()[0] ?? null;
  return {
    ...base,
    ligado: true,
    porcentagem: config.porcentagem,
    semana,
    // Uma conta só, sobre todas as viagens (como a calculadora faz com um ticket).
    conta: todas.length ? contaDasViagens(todas, config.porcentagem) : CONTA_VAZIA,
    pontos: pontosDoResumo,
    completo: codigos.length > 0 && lidos.length === codigos.length,
    lidoEm: maisAntiga,
    recente: Boolean(maisAntiga && agora - Date.parse(maisAntiga) <= validadeDoTicketMs()),
    tentativaEm: config.tentativaEm ? config.tentativaEm.toISOString() : null,
    erro: config.erro,
    intervaloMin,
    diagnostico: config.diagnostico,
  };
}

/* --------------------------------------------------- painel do administrador */

export type SaudeDoTicket = {
  ligado: boolean;
  intervaloMin: number;
  /** Motoristas que cadastraram a porcentagem. */
  motoristas: number;
  contas: {
    motoristaId: number;
    /** Última leitura boa de algum ponto (null = nenhuma ainda). */
    lidoEm: string | null;
    tentativaEm: string | null;
    /** Pontos com leitura boa na semana atual / pontos tentados na semana atual. */
    pontosLidos: number;
    pontosTentados: number;
    /** Motivos da última tentativa (geral e por ponto), sem peso nem valor. */
    erros: string[];
    diagnostico: string[];
  }[];
};

/**
 * Para o cartão do /admin: a leitura do Ticket está funcionando? Só a saúde da
 * leitura — nenhuma viagem, peso, valor, porcentagem ou comissão sai daqui.
 */
export async function saudeDoTicket(limite = 30): Promise<SaudeDoTicket> {
  const intervaloMin = Math.round(intervaloTicketMs() / 60_000);
  if (!temBancoConfigurado) return { ligado: ticketLigado(), intervaloMin, motoristas: 0, contas: [] };
  await garantirTabelasPortal();
  const configs = await comBanco(() =>
    db
      .select({
        motoristaId: portalTicketConfig.motoristaId,
        semanaInicio: portalTicketConfig.semanaInicio,
        tentativaEm: portalTicketConfig.tentativaEm,
        erro: portalTicketConfig.erro,
        diagnostico: portalTicketConfig.diagnostico,
      })
      .from(portalTicketConfig)
      .orderBy(sql`${portalTicketConfig.tentativaEm} desc nulls last`),
  );
  const linhas = configs.length
    ? await comBanco(() =>
        db
          .select({
            motoristaId: portalTickets.motoristaId,
            codigo: portalTickets.codigo,
            semanaInicio: portalTickets.semanaInicio,
            lidoEm: portalTickets.lidoEm,
            tentativaEm: portalTickets.tentativaEm,
            erro: portalTickets.erro,
          })
          .from(portalTickets),
      )
    : [];
  return {
    ligado: ticketLigado(),
    intervaloMin,
    motoristas: configs.length,
    contas: configs.slice(0, limite).map((c) => {
      const daSemana = linhas.filter((l) => l.motoristaId === c.motoristaId && l.semanaInicio === c.semanaInicio);
      const lidoEm = daSemana
        .map((l) => l.lidoEm)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        motoristaId: c.motoristaId,
        lidoEm: lidoEm ? lidoEm.toISOString() : null,
        tentativaEm: c.tentativaEm ? c.tentativaEm.toISOString() : null,
        pontosLidos: daSemana.filter((l) => l.lidoEm).length,
        pontosTentados: daSemana.length,
        erros: [...(c.erro ? [c.erro] : []), ...daSemana.filter((l) => l.erro && motivoDoPontoVale(c, l.tentativaEm)).map((l) => `${l.codigo}: ${l.erro}`)],
        diagnostico: linhasDe(c.diagnostico),
      };
    }),
  };
}
