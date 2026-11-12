import { NextResponse } from "next/server";
import { carregarEpg, lerConfiguracao } from "@/lib/copaflix/fontes";
import { horaCurta } from "@/lib/copaflix/epg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/copaflix/epg → programa que está no ar em cada canal (XMLTV).
 * Sem guia configurado responde com lista vazia (a tela não inventa nada).
 */
export async function GET(request: Request) {
  const forcar = new URL(request.url).searchParams.get("atualizar") === "1";
  const config = lerConfiguracao();
  const programas = await carregarEpg(config, { forcar }).catch(() => []);
  return NextResponse.json(
    {
      programas: programas.map((p) => ({ ...p, inicioHora: horaCurta(p.inicio), fimHora: horaCurta(p.fim) })),
      guiaConfigurado: Boolean(config.epgUrl),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
