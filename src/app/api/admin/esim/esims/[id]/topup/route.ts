import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Intentionally unavailable: current official v1 docs publish no customer eSIM top-up endpoint. */
export async function POST() {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  return NextResponse.json({
    erro: "Recarga eSIM desativada: a documentação oficial pública atual não define um endpoint de recarga de perfil. Não foi feita chamada nem cobrança.",
    code: "NEXA_TOPUP_ENDPOINT_NOT_DOCUMENTED",
  }, { status: 501, headers: { "Cache-Control": "no-store" } });
}
