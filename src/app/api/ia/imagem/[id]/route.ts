import { NextResponse } from "next/server";
import { lerImagemDaMensagem } from "@/lib/ia-imagem-banco";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const semCache = { "Cache-Control": "no-store" };

/**
 * GET /api/ia/imagem/12?motoristaId=3 → imagem da mensagem 12 do assistente.
 * Só serve a imagem de quem está logado (sessão do aparelho) e da própria conversa.
 */
export async function GET(req: Request, { params }: Params) {
  const { id: valorId } = await params;
  const id = Number(valorId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ erro: "Imagem não encontrada." }, { status: 404, headers: semCache });
  }
  const m = await motoristaDaSessao();
  const motoristaId = Number(new URL(req.url).searchParams.get("motoristaId"));
  if (!m || motoristaId !== m.id) {
    return NextResponse.json({ erro: "Cadastre seu nome no app para ver esta imagem." }, { status: 403, headers: semCache });
  }
  const bytes = await lerImagemDaMensagem(m.id, id);
  if (!bytes) return NextResponse.json({ erro: "Imagem não encontrada." }, { status: 404, headers: semCache });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
