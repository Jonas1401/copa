import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alertasMotorista, motoristas, subscriptions } from "@/db/schema";
import { enviarPush } from "@/lib/push";

/**
 * Alerta individual do administrador → motorista (SOMENTE servidor).
 *
 * O caso principal é o motorista com as notificações desativadas: o Push não
 * chega, então o alerta aparece DENTRO do app, em tela cheia, na próxima vez
 * que ele abrir (ou em até 1 min com o app aberto). Ele só fecha quando o
 * motorista ativa as notificações NESTE aparelho — o servidor confere que a
 * inscrição Web Push existe e pertence a ele antes de dar o alerta por
 * resolvido. Cada motorista tem no máximo um alerta pendente.
 */

export const MENSAGEM_MAX = 400;

export function mensagemPadrao(nome: string) {
  const primeiro = nome.trim().split(/\s+/)[0] || "motorista";
  return `Olá, ${primeiro}! Suas notificações do CopaLinks estão desativadas. Ative para receber o aviso quando o seu ponto for chamado.`;
}

export type AlertaPublico = { id: number; mensagem: string; adminNome: string; criadoEm: string };

export async function alertaPendente(motoristaId: number): Promise<AlertaPublico | null> {
  const [a] = await db.select().from(alertasMotorista)
    .where(and(eq(alertasMotorista.motoristaId, motoristaId), isNull(alertasMotorista.resolvidoEm)))
    .orderBy(desc(alertasMotorista.id)).limit(1);
  return a ? { id: a.id, mensagem: a.mensagem, adminNome: a.adminNome, criadoEm: a.criadoEm.toISOString() } : null;
}

/** Cria (ou substitui) o alerta pendente do motorista e tenta também um Push. */
export async function criarAlerta(motoristaId: number, mensagem: string, adminNome: string) {
  const texto = mensagem.trim().slice(0, MENSAGEM_MAX);
  await db.delete(alertasMotorista)
    .where(and(eq(alertasMotorista.motoristaId, motoristaId), isNull(alertasMotorista.resolvidoEm)));
  const [novo] = await db.insert(alertasMotorista)
    .values({ motoristaId, mensagem: texto, adminNome: adminNome.slice(0, 80) })
    .returning();
  // Se algum aparelho dele ainda recebe Push, avisa já (o alerta no app vale igual).
  const push = await enviarPush(
    { title: "📢 Aviso do administrador", body: texto.slice(0, 180), tag: `ALERTA_ADMIN_${novo.id}`, acao: "alerta-admin", url: "/", requireInteraction: true },
    { motoristaId, unica: false },
  ).catch(() => null);
  return { id: novo.id, criadoEm: novo.criadoEm.toISOString(), pushEnviadas: push?.enviadas ?? 0 };
}

export async function cancelarAlerta(motoristaId: number) {
  const r = await db.delete(alertasMotorista)
    .where(and(eq(alertasMotorista.motoristaId, motoristaId), isNull(alertasMotorista.resolvidoEm)))
    .returning({ id: alertasMotorista.id });
  return r.length > 0;
}

/**
 * Fecha o alerta SÓ se este aparelho tem notificações ativas: a inscrição
 * (endpoint) precisa existir, estar ativa e pertencer ao motorista.
 */
export async function resolverAlerta(motoristaId: number, alertaId: number, endpoint: string) {
  if (!endpoint) return { ok: false as const, motivo: "sem_notificacao" as const };
  const [sub] = await db.select({ id: subscriptions.id }).from(subscriptions)
    .where(and(eq(subscriptions.endpoint, endpoint), eq(subscriptions.motoristaId, motoristaId), eq(subscriptions.ativa, 1)))
    .limit(1);
  if (!sub) return { ok: false as const, motivo: "sem_notificacao" as const };
  const r = await db.update(alertasMotorista).set({ resolvidoEm: new Date() })
    .where(and(eq(alertasMotorista.id, alertaId), eq(alertasMotorista.motoristaId, motoristaId), isNull(alertasMotorista.resolvidoEm)))
    .returning({ id: alertasMotorista.id });
  return r.length ? { ok: true as const } : { ok: false as const, motivo: "nao_encontrado" as const };
}

/** Último alerta de cada motorista (para o painel do administrador). */
export async function ultimosAlertas(ids: number[]) {
  const mapa = new Map<number, { criadoEm: string; resolvidoEm: string | null }>();
  if (!ids.length) return mapa;
  const linhas = await db.select().from(alertasMotorista)
    .where(inArray(alertasMotorista.motoristaId, ids)).orderBy(desc(alertasMotorista.id));
  for (const l of linhas) {
    if (!mapa.has(l.motoristaId)) {
      mapa.set(l.motoristaId, { criadoEm: l.criadoEm.toISOString(), resolvidoEm: l.resolvidoEm?.toISOString() ?? null });
    }
  }
  return mapa;
}

/**
 * Envia (cria) o alerta de ativar notificações para TODOS os motoristas que
 * ainda não têm notificações ativas (sem subscription ativa), de uma vez só.
 *
 * CUSTO FIXO, NÃO POR MOTORISTA: o alerta de todos é gravado em 3 consultas
 * (lista, apaga os pendentes, insere um por motorista). Antes era um laço que
 * chamava `criarAlerta` por motorista — 3 consultas cada uma, ou seja ~180
 * consultas para 60 motoristas. Cada consulta é uma ida e volta ao banco
 * remoto (40–120 ms no Neon/Supabase), então o pedido passava de 30 s,
 * estourava o tempo da Function e o painel ficava para sempre em "Enviando…".
 *
 * Sem Push de propósito: quem está na lista não tem nenhuma inscrição ativa
 * (é o critério da seleção), então `enviarPush` não teria para quem mandar —
 * só gastaria uma varredura de `subscriptions` por motorista.
 */
export async function criarAlertaParaTodosSemNotificacao(adminNome: string, mensagem?: string) {
  const todos = await db.select({ id: motoristas.id, nome: motoristas.nome }).from(motoristas);
  const ativos = await db
    .select({ motoristaId: subscriptions.motoristaId })
    .from(subscriptions)
    .where(eq(subscriptions.ativa, 1));
  const comNotificacao = new Set(
    ativos.map((a) => a.motoristaId).filter((v): v is number => v != null),
  );
  const alvos = todos.filter((m) => !comNotificacao.has(m.id));
  if (!alvos.length) return { total: 0, enviados: 0, pushEnviadas: 0, motoristas: [] };

  const bruta = typeof mensagem === "string" ? mensagem.trim().slice(0, MENSAGEM_MAX) : "";
  const admin = adminNome.slice(0, 80);
  const ids = alvos.map((m) => m.id);
  // Substitui o pendente de cada um (como faz o alerta individual) e grava
  // todos os novos num único INSERT.
  await db.delete(alertasMotorista)
    .where(and(inArray(alertasMotorista.motoristaId, ids), isNull(alertasMotorista.resolvidoEm)));
  const gravados = await db.insert(alertasMotorista)
    .values(alvos.map((m) => ({
      motoristaId: m.id,
      mensagem: bruta || mensagemPadrao(m.nome).slice(0, MENSAGEM_MAX),
      adminNome: admin,
    })))
    .returning({ id: alertasMotorista.id, motoristaId: alertasMotorista.motoristaId, criadoEm: alertasMotorista.criadoEm });
  const porMotorista = new Map(gravados.map((g) => [g.motoristaId, g]));

  const motoristasAlertados = alvos.flatMap((m) => {
    const g = porMotorista.get(m.id);
    return g ? [{ id: m.id, nome: m.nome, alertaId: g.id, criadoEm: g.criadoEm.toISOString(), pushEnviadas: 0 }] : [];
  });
  return { total: alvos.length, enviados: motoristasAlertados.length, pushEnviadas: 0, motoristas: motoristasAlertados };
}

export const criarAlertaParaTodos = criarAlertaParaTodosSemNotificacao;
export const criarAlertaTodos = criarAlertaParaTodosSemNotificacao;
export const enviarAlertaParaTodos = criarAlertaParaTodosSemNotificacao;
export const enviarAlertaTodos = criarAlertaParaTodosSemNotificacao;
export const alertarTodosSemNotificacao = criarAlertaParaTodosSemNotificacao;
export const alertarMotoristasSemNotificacao = criarAlertaParaTodosSemNotificacao;
export const criarAlertaMotoristasSemNotificacao = criarAlertaParaTodosSemNotificacao;
