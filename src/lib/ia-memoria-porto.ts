import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { configuracao } from "@/db/schema";
import { MEMORIA_POLITICA_PORTO, POLITICA_AUTOMACAO } from "@/lib/politica-automacao";
import { REGRAS } from "@/lib/regras-seguranca";
import type { Previsao } from "@/lib/tempo";

export const CHAVE_MEMORIA_POLITICA = "ia_porto_politica_v2";
export const CHAVE_MEMORIA_REGRAS = "ia_porto_orientacoes_v2";
export const CHAVE_MEMORIA_CLIMA = "ia_porto_ultima_previsao_v2";

/** Memória do aplicativo no PostgreSQL, não na sessão do navegador. */
export async function garantirMemoriaPorto() {
  for (const [chave, valor] of [
    [CHAVE_MEMORIA_POLITICA, JSON.stringify({ versao: POLITICA_AUTOMACAO.versao, texto: MEMORIA_POLITICA_PORTO })],
    [CHAVE_MEMORIA_REGRAS, JSON.stringify(REGRAS)],
  ]) {
    await db.insert(configuracao).values({ chave, valor }).onConflictDoUpdate({
      target: configuracao.chave, set: { valor }, setWhere: sql`${configuracao.valor} <> ${valor}`,
    });
  }
}

export async function memorizarClima(previsao: Previsao) {
  if (!previsao.atualizadoEm || !Number.isFinite(Date.parse(previsao.atualizadoEm))) return;
  if (!previsao.fontes || !Object.values(previsao.fontes).some(Boolean)) return;
  const valor = JSON.stringify(previsao);
  await db.insert(configuracao).values({ chave: CHAVE_MEMORIA_CLIMA, valor }).onConflictDoUpdate({
    target: configuracao.chave,
    set: { valor },
    // Um retorno de rede atrasado não substitui uma leitura mais nova.
    setWhere: sql`coalesce(${configuracao.valor}::jsonb ->> 'atualizadoEm', '') <= ${previsao.atualizadoEm}`,
  });
}

export async function lerMemoriaClima(): Promise<Previsao | null> {
  const [r] = await db.select().from(configuracao).where(eq(configuracao.chave, CHAVE_MEMORIA_CLIMA)).limit(1);
  try {
    const p = JSON.parse(r?.valor ?? "null") as Previsao | null;
    return p?.agora && p.alerta && Array.isArray(p.dias) && Number.isFinite(Date.parse(p.atualizadoEm)) ? p : null;
  } catch { return null; }
}

/** Só anexado ao contexto da IA quando há uma pergunta sobre o porto. */
export async function contextoOrientacoesPorto(): Promise<string> {
  await garantirMemoriaPorto();
  const [r] = await db.select().from(configuracao).where(eq(configuracao.chave, CHAVE_MEMORIA_REGRAS)).limit(1);
  const regras = JSON.parse(r?.valor ?? "[]") as typeof REGRAS;
  return "\n\nOrientações de porto cadastradas no CopaLinks (somente resposta a perguntas; conferir também as regras oficiais vigentes):\n" +
    regras.map((x) => `${x.titulo}: ${x.texto}`).join("\n");
}
