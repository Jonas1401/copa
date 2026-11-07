import { NextResponse } from "next/server";
import { lerPainelEspelho } from "@/lib/espelho-navios";

export const dynamic = "force-dynamic";

/**
 * GET /api/navios/espelho → cópia do COPALINKS de navios: navios ATRACADOS de
 * fertilizantes com saldos/descarga (APPA) e manobras previstas de navios de
 * fertilizantes (SINPRAPAR). São exatamente duas fontes oficiais; quando uma
 * falha, o trecho vem da última leitura gravada e o painel avisa.
 */
export async function GET() {
  const painel = await lerPainelEspelho();
  return NextResponse.json(painel, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
