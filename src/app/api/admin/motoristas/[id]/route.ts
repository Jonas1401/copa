import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { motoristas } from "@/db/schema";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { excluirCadastroMotorista } from "@/lib/motorista-inatividade";

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

  await excluirCadastroMotorista(motoristaId);

  return NextResponse.json({ sucesso: true, mensagem: `Motorista ${motorista.nome} excluído com sucesso.` });
}
