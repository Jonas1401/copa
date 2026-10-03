import { NextResponse } from "next/server";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { EsimServiceError, consultarPedidoNexa } from "@/lib/esim/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: Context) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const id = Number((await context.params).id);
  try {
    const result = await consultarPedidoNexa(id);
    await auditar({ admin, integracao: "nexaesim", acao: "consultou_pedido", detalhe: `pedido ${id}` });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ erro: error instanceof EsimServiceError ? error.message : "Não foi possível consultar o pedido." }, { status: error instanceof EsimServiceError ? error.status : 500 });
  }
}
