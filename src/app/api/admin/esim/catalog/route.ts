import { NextResponse } from "next/server";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { atualizarCatalogo } from "@/lib/esim/catalog";
import { registrarErroEsim } from "@/lib/esim/observability";
import { NexaApiError, nexaeMode } from "@/lib/esim/nexaesim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  try {
    const result = await atualizarCatalogo();
    await auditar({ admin, integracao: "nexaesim", acao: "sincronizou_catalogo", detalhe: `${result.count} plano(s) · ${result.source}` });
    return NextResponse.json({ ...result, mode: nexaeMode() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const recorded = await registrarErroEsim(error, "package/load");
    await auditar({ admin, integracao: "nexaesim", acao: "falha_catalogo", detalhe: `referência ${recorded.requestId}` });
    return NextResponse.json({ erro: error instanceof NexaApiError ? error.message : "Não foi possível atualizar o catálogo. Consulte os erros da integração." }, { status: error instanceof NexaApiError ? 502 : 500 });
  }
}
