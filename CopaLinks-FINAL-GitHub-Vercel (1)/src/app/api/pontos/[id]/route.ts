import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pontos } from "@/db/schema";
import {
  LIVROS,
  TIPOS,
  codigoDe,
  montarEstado,
  registrarEvento,
  varrer,
} from "@/lib/estado";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Corrige o ponto monitorado (tipo / livro / número) e revarre o site na
 * hora para recalcular posição e status.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const alvo = Number(id);
  const corpo = await req.json().catch(() => ({}));
  const [atual] = await db
    .select()
    .from(pontos)
    .where(eq(pontos.id, alvo))
    .limit(1);
  if (!atual) {
    return NextResponse.json({ erro: "Ponto não encontrado." }, { status: 404 });
  }

  const tipo = String(corpo.tipo ?? atual.tipo).toUpperCase();
  const livro = String(corpo.livro ?? atual.livro)
    .toUpperCase()
    .replace("LIVRO ", "");
  const numero = Number(corpo.numero ?? atual.numero);

  if (!TIPOS.includes(tipo as never) || !LIVROS.includes(livro as never)) {
    return NextResponse.json({ erro: "Tipo ou livro inválido." }, { status: 400 });
  }
  if (!Number.isFinite(numero) || numero < 1 || numero > 999) {
    return NextResponse.json(
      { erro: "Número de ponto inválido." },
      { status: 400 },
    );
  }

  const codigo = codigoDe(livro, Math.trunc(numero));
  await db
    .update(pontos)
    .set({ tipo, livro, numero: Math.trunc(numero) })
    .where(eq(pontos.id, alvo));

  const antes = codigoDe(atual.livro, atual.numero);
  await registrarEvento({
    codigo,
    tipo,
    livro,
    numero: Math.trunc(numero),
    acao: "atualizou",
    mensagem:
      antes === codigo
        ? `${codigo} conferido de novo · varrendo as tabelas`
        : `${antes} corrigido para ${codigo} · varrendo as tabelas`,
  });

  await varrer();

  return NextResponse.json({ estado: await montarEstado() });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const alvo = Number(id);
  const [atual] = await db
    .select()
    .from(pontos)
    .where(eq(pontos.id, alvo))
    .limit(1);
  if (!atual) {
    return NextResponse.json({ erro: "Ponto não encontrado." }, { status: 404 });
  }
  await db.delete(pontos).where(eq(pontos.id, alvo));
  await registrarEvento({
    codigo: codigoDe(atual.livro, atual.numero),
    tipo: atual.tipo,
    livro: atual.livro,
    numero: atual.numero,
    acao: "removeu",
    mensagem: `${codigoDe(atual.livro, atual.numero)} saiu do monitoramento · varredura parada`,
  });
  return NextResponse.json({ estado: await montarEstado() });
}
