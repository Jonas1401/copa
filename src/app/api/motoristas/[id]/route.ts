import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { motoristas } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";
import { limparNome, paraMotorista } from "@/lib/motoristas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Confere o perfil deste aparelho, não um ID fornecido por outro usuário. */
export async function GET(_req: Request, { params }: Params) {
  await garantirTabelas();
  const { id } = await params;
  const m = await motoristaDaSessao();
  if (!m || m.id !== Number(id)) return naoAutorizadoMotorista();
  return NextResponse.json(paraMotorista(m), { headers: { "Cache-Control": "no-store" } });
}

/** Troca de nome (pelo próprio motorista, no cartão "Você"). */
export async function PATCH(req: Request, { params }: Params) {
  await garantirTabelas();
  const { id } = await params;
  const atual = await motoristaDaSessao();
  if (!atual || atual.id !== Number(id)) return naoAutorizadoMotorista();
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
