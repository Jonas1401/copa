import { NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/supabase";
import { monitorCodes } from "@/db/schema";
import { dispositivoAutenticado, marcarAtivo } from "@/lib/auth";
import { garantirTabelas } from "@/lib/estado";
import { normalizarCodigo } from "@/lib/matcher";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "private, no-store" };
const erro = (msg: string, status: number) => NextResponse.json({ erro: msg }, { status, headers: CAB });

/** Motorista vê só os seus; Android monitor vê só os códigos agregados, sem donos. */
export async function GET(req: Request) {
  await garantirTabelas();
  if (req.headers.has("authorization")) {
    const device = await dispositivoAutenticado(req, "MONITOR");
    if (!device) return erro("Monitor não autorizado.", 401);
    const rows = await db.select({ codigo: monitorCodes.codigo }).from(monitorCodes)
      .where(eq(monitorCodes.ativo, 1));
    await marcarAtivo(device.id);
    return NextResponse.json({ codigos: [...new Set(rows.map((r) => r.codigo))] }, { headers: CAB });
  }
  const motorista = await motoristaDaSessao();
  if (!motorista) return erro("Entre no seu perfil neste aparelho.", 401);
  const rows = await db.select({ id: monitorCodes.id, codigo: monitorCodes.codigo, ativo: monitorCodes.ativo })
    .from(monitorCodes).where(eq(monitorCodes.motoristaId, motorista.id)).orderBy(asc(monitorCodes.id));
  return NextResponse.json({ codigos: rows }, { headers: CAB });
}

/** Cadastro opt-in do motorista. Independente da lista de pontos da fila. */
export async function POST(req: Request) {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return erro("Entre no seu perfil neste aparelho.", 401);
  const body = await req.json().catch(() => ({}));
  const codigo = normalizarCodigo(body?.codigo);
  if (!codigo) return erro("Use um código como A184, B22 ou M69 (1 a 999).", 400);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(monitorCodes)
    .where(eq(monitorCodes.motoristaId, motorista.id));
  const [existing] = await db.select().from(monitorCodes)
    .where(and(eq(monitorCodes.motoristaId, motorista.id), eq(monitorCodes.codigo, codigo))).limit(1);
  if (!existing && (n ?? 0) >= 30) return erro("Limite de 30 códigos por motorista.", 429);
  if (existing) {
    const [updated] = await db.update(monitorCodes).set({ ativo: 1 })
      .where(eq(monitorCodes.id, existing.id)).returning({ id: monitorCodes.id, codigo: monitorCodes.codigo, ativo: monitorCodes.ativo });
    return NextResponse.json({ codigo: updated }, { headers: CAB });
  }
  const [created] = await db.insert(monitorCodes).values({ motoristaId: motorista.id, codigo })
    .onConflictDoNothing().returning({ id: monitorCodes.id, codigo: monitorCodes.codigo, ativo: monitorCodes.ativo });
  if (!created) return erro("Código já cadastrado. Atualize a lista.", 409);
  return NextResponse.json({ codigo: created }, { status: 201, headers: CAB });
}

export async function PATCH(req: Request) {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return erro("Entre no seu perfil neste aparelho.", 401);
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof body?.ativo !== "boolean") return erro("Código inválido.", 400);
  const [result] = await db.update(monitorCodes).set({ ativo: body.ativo ? 1 : 0 })
    .where(and(eq(monitorCodes.id, id), eq(monitorCodes.motoristaId, motorista.id)))
    .returning({ id: monitorCodes.id, codigo: monitorCodes.codigo, ativo: monitorCodes.ativo });
  return result ? NextResponse.json({ codigo: result }, { headers: CAB }) : erro("Código não encontrado.", 404);
}

export async function DELETE(req: Request) {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return erro("Entre no seu perfil neste aparelho.", 401);
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id < 1) return erro("Código inválido.", 400);
  const [deleted] = await db.delete(monitorCodes)
    .where(and(eq(monitorCodes.id, id), eq(monitorCodes.motoristaId, motorista.id)))
    .returning({ id: monitorCodes.id });
  return deleted ? NextResponse.json({ ok: true }, { headers: CAB }) : erro("Código não encontrado.", 404);
}
