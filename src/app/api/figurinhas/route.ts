import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { garantirFigurinhasPadrao, listarCategorias, listarFigurinhas } from "@/lib/figurinhas-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/figurinhas → catálogo central das figurinhas ATIVAS, agrupado por
 * categoria, pronto para o seletor do chat. Todo motorista (app, PWA, Android)
 * consulta aqui: publicou no admin, aparece para todos na próxima abertura do
 * painel — sem atualizar o app.
 *
 * Só devolve categorias que têm figurinha ativa (a categoria vazia do pacote
 * antigo não aparece no seletor) e nunca envia os bytes da imagem: cada
 * figurinha tem imagemUrl própria.
 */
export async function GET() {
  await garantirTabelas();
  await garantirFigurinhasPadrao();
  const [categorias, figurinhas] = await Promise.all([listarCategorias(), listarFigurinhas({ somenteAtivas: true })]);
  const emUso = new Set(figurinhas.map((f) => f.categoria));
  return NextResponse.json(
    {
      categorias: categorias.filter((c) => emUso.has(c.chave)).map((c) => ({ chave: c.chave, nome: c.nome, ordem: c.ordem })),
      figurinhas: figurinhas.map((f) => ({
        id: f.id,
        nome: f.nome,
        categoria: f.categoria,
        ordem: f.ordem,
        imagemUrl: `/api/figurinhas/${f.id}/imagem`,
        animada: f.mime === "image/gif",
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
