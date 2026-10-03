import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { esimPlans } from "@/db/schema";
import { auditar, exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: Context) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const id = Number((await context.params).id);
  const body = await req.json().catch(() => null);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof body?.active !== "boolean") {
    return NextResponse.json({ erro: "Plano ou estado inválido." }, { status: 400 });
  }
  const [plan] = await db.update(esimPlans).set({ active: body.active, atualizadoEm: new Date() })
    .where(eq(esimPlans.id, id)).returning({ id: esimPlans.id, active: esimPlans.active });
  if (!plan) return NextResponse.json({ erro: "Plano não encontrado." }, { status: 404 });
  await auditar({ admin, integracao: "nexaesim", acao: body.active ? "ativou_plano" : "desativou_plano", detalhe: `plano ${id}` });
  return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
}
