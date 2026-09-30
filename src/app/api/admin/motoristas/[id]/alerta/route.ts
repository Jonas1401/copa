import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { motoristas } from "@/db/schema";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { cancelarAlerta, criarAlerta, mensagemPadrao, MENSAGEM_MAX } from "@/lib/alerta-admin";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "no-store" };
type Params = { params: Promise<{ id: string }> };

async function motoristaDe(params: Params["params"]) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [m] = await db.select({ id: motoristas.id, nome: motoristas.nome }).from(motoristas).where(eq(motoristas.id, id)).limit(1);
  return m ?? null;
}

/** POST { mensagem? } → alerta individual para ESTE motorista (só administrador). */
export async function POST(req: Request, { params }: Params) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  const m = await motoristaDe(params);
  if (!m) return NextResponse.json({ erro: "Motorista não encontrado." }, { status: 404, headers: CAB });
  const body = await req.json().catch(() => ({}));
  const bruta = typeof body?.mensagem === "string" ? body.mensagem.trim() : "";
  if (bruta.length > MENSAGEM_MAX) {
    return NextResponse.json({ erro: `Mensagem com no máximo ${MENSAGEM_MAX} caracteres.` }, { status: 400, headers: CAB });
  }
  const mensagem = bruta || mensagemPadrao(m.nome);
  const r = await criarAlerta(m.id, mensagem, admin.nome);
  await auditar({ admin, integracao: "motoristas", acao: "alerta enviado", detalhe: `${m.nome} (#${m.id})`, ip: ipDe(req) }).catch(() => {});
  return NextResponse.json({ ok: true, ...r }, { headers: CAB });
}

/** DELETE → cancela o alerta ainda pendente deste motorista. */
export async function DELETE(req: Request, { params }: Params) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  const m = await motoristaDe(params);
  if (!m) return NextResponse.json({ erro: "Motorista não encontrado." }, { status: 404, headers: CAB });
  const cancelado = await cancelarAlerta(m.id);
  if (cancelado) await auditar({ admin, integracao: "motoristas", acao: "alerta cancelado", detalhe: `${m.nome} (#${m.id})`, ip: ipDe(req) }).catch(() => {});
  return NextResponse.json({ ok: true, cancelado }, { headers: CAB });
}
