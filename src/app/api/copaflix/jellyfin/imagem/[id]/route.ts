import { NextResponse } from "next/server";
import { lerConfiguracao } from "@/lib/copaflix/fontes";
import { cabecalhoJellyfin } from "@/lib/copaflix/jellyfin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/**
 * GET /api/copaflix/jellyfin/imagem/:id[?tipo=fundo]
 *
 * Busca o cartaz/fundo no Jellyfin com a chave do SERVIDOR. O navegador nunca
 * recebe a credencial nem o endereço interno do servidor de mídia.
 */
export async function GET(request: Request, { params }: Params) {
  const config = lerConfiguracao();
  if (!config.jellyfin) {
    return NextResponse.json({ erro: "Jellyfin não configurado." }, { status: 404 });
  }
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ erro: "Item inválido." }, { status: 400 });
  }

  const fundo = new URL(request.url).searchParams.get("tipo") === "fundo";
  const base = config.jellyfin.base.endsWith("/") ? config.jellyfin.base : `${config.jellyfin.base}/`;
  const caminho = fundo
    ? `Items/${encodeURIComponent(id)}/Images/Backdrop/0?maxWidth=1600&quality=88`
    : `Items/${encodeURIComponent(id)}/Images/Primary?maxHeight=675&quality=90`;

  try {
    const resposta = await fetch(new URL(caminho, base), {
      headers: cabecalhoJellyfin(config.jellyfin.chave),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!resposta.ok || !resposta.body) {
      return NextResponse.json({ erro: "Imagem indisponível." }, { status: 404 });
    }
    const tipo = (resposta.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!MIMES.has(tipo)) {
      return NextResponse.json({ erro: "Formato de imagem não aceito." }, { status: 415 });
    }
    return new NextResponse(resposta.body, {
      headers: {
        "Content-Type": tipo,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ erro: "Servidor de mídia indisponível." }, { status: 502 });
  }
}
