import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, chatReacoes, motoristas } from "@/db/schema";
import { reacaoValida, type ReacaoChat } from "@/lib/reacoes";

/**
 * Curtidas com emoji nas mensagens do chat (estilo WhatsApp) — SOMENTE servidor.
 *
 * - Cada motorista tem UMA reação por mensagem: tocar no mesmo emoji remove,
 *   tocar em outro troca. Nada de lista duplicada.
 * - Reagir é silencioso: não entra no chat como mensagem nova e não dispara
 *   Web Push — só aparece a pílula de reação embaixo da bolha.
 * - A pílula mostra os emojis + total; tocando nela dá para ver quem curtiu.
 */

export type { ReacaoChat };

/** Reações de várias mensagens de uma vez (a tela busca as visíveis). */
export async function listarReacoes(mensagemIds: number[]): Promise<Record<number, ReacaoChat[]>> {
  const ids = [...new Set(mensagemIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  const mapa: Record<number, ReacaoChat[]> = {};
  if (!ids.length) return mapa;
  let linhas: (ReacaoChat & { mensagemId: number })[];
  try {
    linhas = await db
      .select({
        mensagemId: chatReacoes.mensagemId,
        emoji: chatReacoes.emoji,
        motoristaId: chatReacoes.motoristaId,
        nome: motoristas.nome,
      })
      .from(chatReacoes)
      .innerJoin(motoristas, eq(motoristas.id, chatReacoes.motoristaId))
      .where(inArray(chatReacoes.mensagemId, ids));
  } catch {
    // Tabela ainda não criada neste banco: sem reações.
    return mapa;
  }
  for (const l of linhas) {
    (mapa[l.mensagemId] ??= []).push({ emoji: l.emoji, motoristaId: l.motoristaId, nome: l.nome });
  }
  return mapa;
}

/**
 * Alterna a reação do motorista na mensagem:
 * - sem emoji (null/"") → remove a reação dele, se houver;
 * - mesmo emoji que já está → remove (descurtir);
 * - outro emoji → troca; sem reação ainda → cria.
 * Devolve a reação atual dele + a lista atualizada da mensagem.
 */
export async function alternarReacao(
  mensagemId: number,
  motoristaId: number,
  emoji: string | null,
): Promise<{ minhaReacao: string | null; reacoes: ReacaoChat[] } | { erro: string }> {
  if (!Number.isInteger(mensagemId) || mensagemId <= 0) return { erro: "Mensagem não encontrada." };
  if (!Number.isInteger(motoristaId) || motoristaId <= 0) return { erro: "Cadastre seu nome no app para curtir." };
  const querRemover = !emoji || !emoji.trim();
  if (!querRemover && !reacaoValida(emoji!.trim())) {
    return { erro: "Escolha um emoji para curtir." };
  }

  const [mensagem] = await db.select({ id: chatMensagens.id }).from(chatMensagens).where(eq(chatMensagens.id, mensagemId)).limit(1);
  if (!mensagem) return { erro: "Mensagem não encontrada." };
  const [motorista] = await db.select({ id: motoristas.id }).from(motoristas).where(eq(motoristas.id, motoristaId)).limit(1);
  if (!motorista) return { erro: "Cadastre seu nome no app para curtir." };

  const [atual] = await db
    .select()
    .from(chatReacoes)
    .where(and(eq(chatReacoes.mensagemId, mensagemId), eq(chatReacoes.motoristaId, motoristaId)))
    .limit(1);

  const novoEmoji = querRemover ? null : emoji!.trim();
  if (!atual && !novoEmoji) {
    // Nada a remover: devolve o estado atual.
  } else if (atual && atual.emoji === novoEmoji) {
    // Mesmo emoji: descurtir.
    await db.delete(chatReacoes).where(eq(chatReacoes.id, atual.id));
  } else if (atual && !novoEmoji) {
    await db.delete(chatReacoes).where(eq(chatReacoes.id, atual.id));
  } else if (atual && novoEmoji) {
    await db.update(chatReacoes).set({ emoji: novoEmoji }).where(eq(chatReacoes.id, atual.id));
  } else if (novoEmoji) {
    await db.insert(chatReacoes).values({ mensagemId, motoristaId, emoji: novoEmoji }).onConflictDoNothing();
  }

  const mapa = await listarReacoes([mensagemId]);
  const reacoes = mapa[mensagemId] ?? [];
  const minha = reacoes.find((r) => r.motoristaId === motoristaId)?.emoji ?? null;
  return { minhaReacao: minha, reacoes };
}

/** Apaga as reações junto quando a mensagem é apagada. */
export async function removerReacoesDaMensagem(mensagemId: number) {
  try {
    await db.delete(chatReacoes).where(eq(chatReacoes.mensagemId, mensagemId));
  } catch {
    // Tabela ainda não criada: nada a apagar.
  }
}
