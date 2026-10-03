import { NextResponse } from "next/server";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { criarPedidoTeste, EsimServiceError } from "@/lib/esim/orders";
import { nexaeMode } from "@/lib/esim/nexaesim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Checkout de laboratório: cria somente pedido/pagamento fictício, sem gateway e sem eSIM real. */
export async function POST(req: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const body = await req.json().catch(() => null);
  if (nexaeMode() !== "TEST") {
    return NextResponse.json({ erro: "Checkout de cliente está desativado: não há gateway de pagamento configurado neste CopaLinks." }, { status: 409 });
  }
  try {
    const result = await criarPedidoTeste({
      planId: Number(body?.planId),
      motoristaId: Number(body?.motoristaId),
      idempotencyKey: String(body?.idempotencyKey ?? ""),
    });
    await auditar({ admin, integracao: "nexaesim", acao: result.duplicate ? "repetiu_pedido_idempotente" : "criou_pedido_teste", detalhe: `pedido ${result.order.id}` });
    return NextResponse.json({
      orderId: result.order.id,
      status: result.order.status,
      duplicate: result.duplicate,
      mode: "TEST",
      aviso: "Pedido local de demonstração. Nenhum pagamento ou perfil real foi criado.",
    }, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof EsimServiceError ? error.status : 500;
    const message = error instanceof EsimServiceError ? error.message : "Não foi possível salvar o pedido de teste.";
    return NextResponse.json({ erro: message }, { status });
  }
}
