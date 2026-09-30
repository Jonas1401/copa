import { NextResponse } from "next/server";
import { adminAtual, existeAdmin, garantirAdminDefault } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";

export const dynamic = "force-dynamic";

/** Quem está logado? Precisa criar o primeiro administrador? */
export async function GET() {
  await garantirTabelas();
  await garantirAdminDefault();
  const [admin, temAdmin] = await Promise.all([adminAtual(), existeAdmin()]);
  return NextResponse.json(
    { logado: Boolean(admin), admin, precisaSetup: !temAdmin },
    { headers: { "Cache-Control": "no-store" } },
  );
}
