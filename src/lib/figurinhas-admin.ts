/**
 * Catálogo central de figurinhas do chat (SOMENTE servidor).
 *
 * Leitura/escrita das tabelas `figurinha_categorias` e `figurinhas_catalogo`
 * mais a semente do pacote inicial CopaLinks (uma única vez por banco: se o
 * administrador apagar tudo, o pacote não volta sozinho).
 *
 * A imagem de cada figurinha vive no banco (base64): todos os motoristas
 * recebem exatamente as mesmas figurinhas, inclusive no Android/PWA. Ao ser
 * enviada no chat, a figurinha é COPIADA para a mensagem — o histórico não
 * muda nem some quando o catálogo é editado depois.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { configuracao, figurinhaCategorias, figurinhasCatalogo } from "@/db/schema";
import {
  CATEGORIAS_PADRAO,
  chaveCategoria,
  nomeCategoria,
  nomeFigurinha,
  ordemFigurinha,
  type CategoriaFigurinha,
} from "@/lib/figurinhas-catalogo";
import { PACOTE_FIGURINHAS } from "@/lib/figurinhas-pacote";

/** Marca na tabela `configuracao`: o pacote inicial já foi semeado. */
const CHAVE_SEMENTE = "figurinhas_pacote_copalinks";

export type FigurinhaCatalogo = {
  id: number;
  nome: string;
  categoria: string;
  mime: string;
  ativa: boolean;
  ordem: number;
  pacote: string;
  criadoEm: Date;
  atualizadoEm: Date;
};

const semDados = {
  id: figurinhasCatalogo.id,
  nome: figurinhasCatalogo.nome,
  categoria: figurinhasCatalogo.categoria,
  mime: figurinhasCatalogo.mime,
  ativa: figurinhasCatalogo.ativa,
  ordem: figurinhasCatalogo.ordem,
  pacote: figurinhasCatalogo.pacote,
  criadoEm: figurinhasCatalogo.criadoEm,
  atualizadoEm: figurinhasCatalogo.atualizadoEm,
} as const;

/** Semeia categorias + figurinhas oficiais na primeira chamada do servidor. */
export async function garantirFigurinhasPadrao() {
  try {
    const semeada = await db
      .select({ chave: configuracao.chave })
      .from(configuracao)
      .where(eq(configuracao.chave, CHAVE_SEMENTE))
      .limit(1);
    if (semeada.length) return;
    for (const categoria of CATEGORIAS_PADRAO) {
      await db
        .insert(figurinhaCategorias)
        .values(categoria)
        .onConflictDoNothing({ target: figurinhaCategorias.chave });
    }
    for (const [indice, f] of PACOTE_FIGURINHAS.entries()) {
      await db
        .insert(figurinhasCatalogo)
        .values({
          nome: f.nome,
          categoria: f.categoria,
          mime: f.mime,
          dados: f.base64,
          ativa: true,
          ordem: indice,
          pacote: "copalinks",
        })
        .onConflictDoNothing();
    }
    await db
      .insert(configuracao)
      .values({ chave: CHAVE_SEMENTE, valor: String(PACOTE_FIGURINHAS.length) })
      .onConflictDoNothing({ target: configuracao.chave });
  } catch {
    // banco ainda não pronto: a próxima chamada tenta de novo
  }
}

/** Categorias na ordem do seletor (as do admin e do chat vêm daqui). */
export async function listarCategorias(): Promise<CategoriaFigurinha[]> {
  return db.select().from(figurinhaCategorias).orderBy(asc(figurinhaCategorias.ordem), asc(figurinhaCategorias.chave));
}

/** Figurinha pelo id (com a imagem) — para enviar no chat ou servir bytes. */
export async function obterFigurinhaComImagem(id: number) {
  const [f] = await db
    .select({ ...semDados, dados: figurinhasCatalogo.dados })
    .from(figurinhasCatalogo)
    .where(eq(figurinhasCatalogo.id, id))
    .limit(1);
  return f ?? null;
}

/**
 * Lista para o seletor do chat (só ativas) ou para o admin (todas).
 * Nunca devolve os bytes da imagem: a tela usa /api/figurinhas/:id/imagem.
 */
export async function listarFigurinhas(opcoes: { somenteAtivas?: boolean } = {}) {
  const linhas = await db
    .select(semDados)
    .from(figurinhasCatalogo)
    .orderBy(asc(figurinhasCatalogo.categoria), asc(figurinhasCatalogo.ordem), asc(figurinhasCatalogo.id));
  return opcoes.somenteAtivas ? linhas.filter((f) => f.ativa) : linhas;
}

export async function criarFigurinha(entrada: {
  nome: string;
  categoria: string;
  mime: string;
  dados: string;
  ordem?: number;
  ativa?: boolean;
}) {
  const [f] = await db
    .insert(figurinhasCatalogo)
    .values({
      nome: entrada.nome,
      categoria: entrada.categoria,
      mime: entrada.mime,
      dados: entrada.dados,
      ordem: ordemFigurinha(entrada.ordem),
      ativa: entrada.ativa ?? true,
    })
    .returning(semDados);
  return f;
}

export async function atualizarFigurinha(
  id: number,
  mudancas: { nome?: string; categoria?: string; ordem?: number; ativa?: boolean },
) {
  const dados: Partial<typeof figurinhasCatalogo.$inferInsert> = { atualizadoEm: new Date() };
  if (mudancas.nome !== undefined) dados.nome = mudancas.nome;
  if (mudancas.categoria !== undefined) dados.categoria = mudancas.categoria;
  if (mudancas.ordem !== undefined) dados.ordem = mudancas.ordem;
  if (mudancas.ativa !== undefined) dados.ativa = mudancas.ativa;
  const [f] = await db
    .update(figurinhasCatalogo)
    .set(dados)
    .where(eq(figurinhasCatalogo.id, id))
    .returning(semDados);
  return f ?? null;
}

/** Exclusão definitiva (a mensagem já enviada guarda a própria cópia). */
export async function excluirFigurinha(id: number) {
  const [f] = await db.delete(figurinhasCatalogo).where(eq(figurinhasCatalogo.id, id)).returning(semDados);
  return f ?? null;
}

export async function criarCategoria(entrada: { nome: string; chave?: string; ordem?: number; pacote?: string }) {
  const nome = nomeCategoria(entrada.nome);
  const chave = chaveCategoria(entrada.chave ?? entrada.nome);
  if (!nome || !chave) return { erro: "Informe um nome válido para a categoria (2 a 40 letras)." };
  const existente = await db
    .select({ chave: figurinhaCategorias.chave })
    .from(figurinhaCategorias)
    .where(eq(figurinhaCategorias.chave, chave))
    .limit(1);
  if (existente.length) return { erro: "Já existe uma categoria com esse nome." };
  const [c] = await db
    .insert(figurinhaCategorias)
    .values({ chave, nome, ordem: ordemFigurinha(entrada.ordem), pacote: entrada.pacote || "copalinks" })
    .returning();
  return { categoria: c };
}

export async function atualizarCategoria(chave: string, mudancas: { nome?: string; ordem?: number }) {
  const dados: Partial<typeof figurinhaCategorias.$inferInsert> = {};
  if (mudancas.nome !== undefined) {
    const nome = nomeCategoria(mudancas.nome);
    if (!nome) return null;
    dados.nome = nome;
  }
  if (mudancas.ordem !== undefined) dados.ordem = ordemFigurinha(mudancas.ordem);
  const [c] = await db
    .update(figurinhaCategorias)
    .set(dados)
    .where(eq(figurinhaCategorias.chave, chave))
    .returning();
  return c ?? null;
}

/** Remove a categoria só quando nenhuma figurinha está usando (as padrão também). */
export async function excluirCategoria(chave: string) {
  if (CATEGORIAS_PADRAO.some((c) => c.chave === chave)) {
    return { erro: "A categoria padrão do CopaLinks não pode ser removida." };
  }
  const usadas = await db
    .select({ id: figurinhasCatalogo.id })
    .from(figurinhasCatalogo)
    .where(eq(figurinhasCatalogo.categoria, chave))
    .limit(1);
  if (usadas.length) return { erro: "Mova ou exclua as figurinhas desta categoria antes de removê-la." };
  const [c] = await db
    .delete(figurinhaCategorias)
    .where(eq(figurinhaCategorias.chave, chave))
    .returning();
  return c ? { categoria: c } : { erro: "Categoria não encontrada." };
}
