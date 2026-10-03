import { NextResponse } from "next/server";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { aprovarPagamentoTeste, EsimServiceError } from "@/lib/esim/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: Context) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const id = Number((await context.params).id);
  try {
    const result = await aprovarPagamentoTeste(id);
    await auditar({ admin, integracao: "nexaesim", acao: result.duplicate ? "repetiu_pagamento_teste" : "aprovou_pagamento_teste", detalhe: `pedido ${id}` });
    return NextResponse.json({ ...result, aviso: "Pagamento simulado localmente; nenhum dinheiro foi cobrado e nenhum eSIM instalável foi emitido." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof EsimServiceError ? error.status : 500;
    const message = error instanceof EsimServiceError ? error.message : "Não foi possível concluir a simulação de pagamento.";
    return NextResponse.json({ erro: message }, { status });
  }
}
