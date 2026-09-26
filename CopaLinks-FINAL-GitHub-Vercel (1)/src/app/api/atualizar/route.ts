import { NextResponse } from "next/server";
import { getEstado } from "@/lib/estado";

export const dynamic = "force-dynamic";

export async function POST() {
  // Releitura explícita ("reler agora"): espera a fonte responder.
  const estado = await getEstado(true);
  return NextResponse.json(estado);
}
