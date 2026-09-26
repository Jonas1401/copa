import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditoria } from "@/db/schema";
import { exigirAdmin } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

/** Últimas ações dos administradores (sem valores de chave). Admin apenas. */
export async function GET() {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const linhas = await db.select().from(auditoria).orderBy(desc(auditoria.id)).limit(60);
  return NextResponse.json(
    linhas.map((l) => ({
      id: l.id,
      admin: l.adminNome,
      integracao: l.integracao,
      acao: l.acao,
      detalhe: l.detalhe,
      criadoEm: l.criadoEm.toISOString(),
    })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
