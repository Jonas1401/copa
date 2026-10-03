import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { esims } from "@/db/schema";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/** ICCID, QR e URL de instalação são retornados somente à sessão de administrador. */
export async function GET(_req: Request, context: Context) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ erro: "eSIM inválido." }, { status: 400 });
  const [sim] = await db.select().from(esims).where(eq(esims.id, id)).limit(1);
  if (!sim) return NextResponse.json({ erro: "eSIM não encontrado." }, { status: 404 });
  return NextResponse.json({
    id: sim.id,
    iccid: sim.iccid,
    status: sim.status,
    providerStatus: sim.providerStatus,
    qrCode: sim.qrCode,
    qrUrl: sim.qrUrl,
    activationCode: sim.activationCode,
    installationUrl: sim.installationUrl,
    smDp: sim.smDp,
    expiresAt: sim.expiresAt?.toISOString() ?? null,
    source: sim.source,
    createdAt: sim.criadoEm.toISOString(),
  }, { headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
}
