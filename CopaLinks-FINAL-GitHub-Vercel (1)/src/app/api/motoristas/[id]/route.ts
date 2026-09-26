import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { motoristas } from "@/db/schema";
import { limparNome, paraMotorista } from "@/lib/motoristas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** O app confere se o motorista salvo no aparelho ainda existe. */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const [m] = await db
    .select()
    .from(motoristas)
    .where(eq(motoristas.id, Number(id)))
    .limit(1);
  if (!m) {
    return NextResponse.json({ erro: "Motorista não encontrado." }, { status: 404 });
  }
  return NextResponse.json(paraMotorista(m));
}

/** Troca de nome (pelo próprio motorista, no cartão "Você"). */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  const nome = limparNome(corpo.nome);
  if (!nome) {
    return NextResponse.json(
      { erro: "Digite seu nome (pelo menos 2 letras)." },
      { status: 400 },
    );
  }
  const [m] = await db
    .update(motoristas)
    .set({ nome })
    .where(eq(motoristas.id, Number(id)))
    .returning();
  if (!m) {
    return NextResponse.json({ erro: "Motorista não encontrado." }, { status: 404 });
  }
  return NextResponse.json(paraMotorista(m));
}
