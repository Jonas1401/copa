import { NextResponse } from "next/server";
import { getEstado } from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";

/** Relê o quadro e devolve apenas os pontos da sessão deste aparelho. */
export async function POST() {
  const motorista = await motoristaDaSessao();
  const estado = await getEstado(motorista?.id ?? null, true);
  return NextResponse.json(estado, { headers: { "Cache-Control": "private, no-store" } });
}
