import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { motoristas } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { iniciarSessaoMotorista, motoristaDaSessao } from "@/lib/motorista-sessao";
import { limparNome, limparPonto, paraMotorista } from "@/lib/motoristas";

export const dynamic = "force-dynamic";

/** Quantos motoristas usam o CopaLinks (só o número — nenhum nome sai daqui). */
export async function GET() {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(motoristas);
  return NextResponse.json({ total: total ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

/** Cadastro neste aparelho: nome obrigatório, ponto opcional. */
export async function POST(req: Request) {
  await garantirTabelas();
  const atual = await motoristaDaSessao();
  if (atual) return NextResponse.json(paraMotorista(atual), { headers: { "Cache-Control": "no-store" } });
  const corpo = await req.json().catch(() => ({}));
  const nome = limparNome(corpo.nome);
  if (!nome) {
    return NextResponse.json({ erro: "Digite seu nome (pelo menos 2 letras)." }, { status: 400 });
  }
  const ponto = limparPonto(corpo.ponto);

  // O nome não é senha: duas pessoas podem ter o mesmo nome. Nunca dar acesso
  // aos pontos de outra pessoa só porque o nome digitado é igual.
  const [m] = await db
    .insert(motoristas)
    .values({
      nome,
      pontoTipo: ponto?.tipo ?? null,
      pontoLivro: ponto?.livro ?? null,
      pontoNumero: ponto?.numero ?? null,
    })
    .returning();
  return iniciarSessaoMotorista(
    m.id,
    NextResponse.json(paraMotorista(m), { status: 201, headers: { "Cache-Control": "no-store" } }),
  );
}
