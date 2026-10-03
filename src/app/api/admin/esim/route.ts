import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { painelEsimAdmin } from "@/lib/esim/admin-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Visão privada: vendas, clientes, catálogo, perfis, callbacks e erros. */
export async function GET() {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirSchemaEsim();
  const data = await painelEsimAdmin();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
