import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { motoristas, pontos, subscriptions } from "@/db/schema";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();

  const { id } = await params;
  const motoristaId = Number(id);
  if (!motoristaId || isNaN(motoristaId)) {
    return NextResponse.json({ erro: "ID inválido." }, { status: 400 });
  }

  const [motorista] = await db
    .select()
    .from(motoristas)
    .where(eq(motoristas.id, motoristaId));

  if (!motorista) {
    return NextResponse.json({ erro: "Motorista não encontrado." }, { status: 404 });
  }

  // Deletar inscrições push, pontos vinculados e o motorista (sessões, alertas e silenciados deletam em cascata)
  await db.delete(subscriptions).where(eq(subscriptions.motoristaId, motoristaId));
  await db.delete(pontos).where(eq(pontos.motoristaId, motoristaId));
  await db.delete(motoristas).where(eq(motoristas.id, motoristaId));

  return NextResponse.json({ sucesso: true, mensagem: `Motorista ${motorista.nome} excluído com sucesso.` });
}
