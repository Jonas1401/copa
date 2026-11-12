import { NextResponse } from "next/server";
import { lerConfiguracao } from "@/lib/copaflix/fontes";
import { episodiosJellyfin } from "@/lib/copaflix/jellyfin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/copaflix/jellyfin/serie/:id → episódios da série no Jellyfin.
 * Chamado só quando o usuário abre a ficha (a abertura do CopaFlix não espera
 * uma consulta por série).
 */
export async function GET(_request: Request, { params }: Params) {
  const config = lerConfiguracao();
  if (!config.jellyfin) {
    return NextResponse.json({ erro: "Jellyfin não configurado." }, { status: 404 });
  }
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ erro: "Série inválida." }, { status: 400 });
  }
  try {
    const episodios = await episodiosJellyfin(config.jellyfin, id);
    return NextResponse.json(
      { episodios },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ erro: "Não foi possível ler os episódios." }, { status: 502 });
  }
}
