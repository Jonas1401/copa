import { NextResponse } from "next/server";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { salvarMargemPercentual } from "@/lib/esim/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const body = await req.json().catch(() => null);
  const margin = Number(body?.marginPercent);
  if (!Number.isFinite(margin) || margin < 0 || margin > 500) {
    return NextResponse.json({ erro: "A margem deve ser um número de 0 a 500%." }, { status: 400 });
  }
  const saved = await salvarMargemPercentual(margin);
  await auditar({ admin, integracao: "nexaesim", acao: "alterou_margem", detalhe: `margem ${saved.toFixed(2)}%` });
  return NextResponse.json({ marginPercent: saved }, { headers: { "Cache-Control": "no-store" } });
}
