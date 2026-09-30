import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatSilenciados } from "@/db/schema";

/**
 * "Silenciar notificações do chat" — por motorista (vale para todos os
 * aparelhos dele). Afeta SÓ os avisos de mensagens do chat; os avisos do
 * ponto (NA VEZ, SAIU, perto da vez, lista do grupo) continuam normalmente.
 */
export async function motoristasComChatSilenciado(): Promise<number[]> {
  try {
    const linhas = await db.select({ id: chatSilenciados.motoristaId }).from(chatSilenciados);
    return linhas.map((l) => l.id);
  } catch {
    // Tabela ainda não criada neste banco: ninguém silenciou.
    return [];
  }
}

export async function chatEstaSilenciado(motoristaId: number) {
  try {
    const [l] = await db.select({ id: chatSilenciados.motoristaId }).from(chatSilenciados)
      .where(eq(chatSilenciados.motoristaId, motoristaId)).limit(1);
    return Boolean(l);
  } catch {
    return false;
  }
}

export async function definirSilencioChat(motoristaId: number, silenciado: boolean) {
  if (silenciado) {
    await db.insert(chatSilenciados).values({ motoristaId }).onConflictDoNothing();
  } else {
    await db.delete(chatSilenciados).where(eq(chatSilenciados.motoristaId, motoristaId));
  }
  return silenciado;
}
