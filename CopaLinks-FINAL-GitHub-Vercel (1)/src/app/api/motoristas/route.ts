import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { motoristas } from "@/db/schema";
import { limparNome, limparPonto, paraMotorista } from "@/lib/motoristas";

export const dynamic = "force-dynamic";

/** Quantos motoristas usam o CopaLinks (só o número — nenhum nome sai daqui). */
export async function GET() {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(motoristas);
  return NextResponse.json({ total: total ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

/** Cadastro da 1ª abertura do app: nome obrigatório, ponto opcional. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const nome = limparNome(corpo.nome);
  if (!nome) {
    return NextResponse.json(
      { erro: "Digite seu nome (pelo menos 2 letras)." },
      { status: 400 },
    );
  }
  const ponto = limparPonto(corpo.ponto);

  // Mesmo nome já cadastrado = mesma pessoa voltando (ex.: o link do app mudou
  // e o celular esqueceu o cadastro). Reaproveita em vez de duplicar.
  const [existente] = await db
    .select()
    .from(motoristas)
    .where(sql`lower(trim(${motoristas.nome})) = ${nome.toLowerCase()}`)
    .orderBy(motoristas.id)
    .limit(1);
  if (existente) {
    if (ponto && !existente.pontoNumero) {
      const [atual] = await db
        .update(motoristas)
        .set({ pontoTipo: ponto.tipo, pontoLivro: ponto.livro, pontoNumero: ponto.numero })
        .where(eq(motoristas.id, existente.id))
        .returning();
      return NextResponse.json(paraMotorista(atual));
    }
    return NextResponse.json(paraMotorista(existente));
  }

  const [m] = await db
    .insert(motoristas)
    .values({
      nome,
      pontoTipo: ponto?.tipo ?? null,
      pontoLivro: ponto?.livro ?? null,
      pontoNumero: ponto?.numero ?? null,
    })
    .returning();
  return NextResponse.json(paraMotorista(m), { status: 201 });
}
