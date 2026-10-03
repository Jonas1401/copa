import { NextResponse } from "next/server";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { EsimServiceError, provisionarPedidoPago } from "@/lib/esim/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/** Reintento administrativo: requiere pago persistido y reutiliza la clave original. */
export async function POST(_req: Request, context: Context) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const id = Number((await context.params).id);
  try {
    const result = await provisionarPedidoPago(id);
    await auditar({
      admin,
      integracao: "nexaesim",
      acao: "reintentou_provisionamento_pago",
      detalhe: `pedido ${id}`,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof EsimServiceError ? error.status : 500;
    const message = error instanceof EsimServiceError ? error.message : "Não foi possível reprocessar o pedido.";
    return NextResponse.json({ erro: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
