import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { iaMensagens } from "@/db/schema";

/**
 * Armazenamento das imagens do assistente (SOMENTE servidor).
 * A coluna `imagem_dados` é criada na primeira utilização, sem mexer nas
 * tabelas existentes e sem exigir migração manual.
 */

let colunaPronta: Promise<void> | null = null;

export function garantirColunaImagem(): Promise<void> {
  colunaPronta ??= (async () => {
    const r = await db.execute<{ pronto: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('ia_mensagens')
          AND attname = 'imagem_dados' AND NOT attisdropped
      ) AS pronto
    `);
    if (r.rows[0]?.pronto) return;
    await db.execute(sql`ALTER TABLE ia_mensagens ADD COLUMN IF NOT EXISTS imagem_dados TEXT`);
  })().catch((e) => {
    colunaPronta = null;
    throw e;
  });
  return colunaPronta;
}

/** Lê a imagem de UMA mensagem deste motorista (nunca de outro). */
export async function lerImagemDaMensagem(motoristaId: number, mensagemId: number): Promise<Buffer | null> {
  await garantirColunaImagem();
  const [linha] = await db
    .select({ dados: iaMensagens.imagemDados })
    .from(iaMensagens)
    .where(and(eq(iaMensagens.id, mensagemId), eq(iaMensagens.motoristaId, motoristaId)))
    .limit(1);
  return linha?.dados ? Buffer.from(linha.dados, "base64") : null;
}
