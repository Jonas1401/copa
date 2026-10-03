import { NextResponse } from "next/server";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { consultarConsumoNexa, EsimServiceError } from "@/lib/esim/orders";
import { registrarErroEsim } from "@/lib/esim/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: Context) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const id = Number((await context.params).id);
  try {
    const result = await consultarConsumoNexa(id);
    await auditar({ admin, integracao: "nexaesim", acao: "consultou_consumo", detalhe: `eSIM ${id} · ${result.status}` });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof EsimServiceError ? error.status : 500;
    if (!(error instanceof EsimServiceError)) await registrarErroEsim(error, "sim-info/query-info");
    return NextResponse.json({ erro: error instanceof EsimServiceError ? error.message : "Não foi possível consultar o consumo." }, { status });
  }
}
