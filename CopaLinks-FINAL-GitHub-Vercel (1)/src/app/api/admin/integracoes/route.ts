import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin/auth";
import { listarEstados } from "@/lib/admin/integracoes";

export const dynamic = "force-dynamic";

/** Só STATUS das integrações (nunca o valor das chaves). Admin apenas. */
export async function GET() {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  return NextResponse.json(await listarEstados(), { headers: { "Cache-Control": "no-store" } });
}
