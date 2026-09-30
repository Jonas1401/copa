import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pontos } from "@/db/schema";
import {
  LIVROS,
  TIPOS,
  codigoDe,
  garantirTabelas,
  montarEstado,
  registrarEvento,
  varrer,
} from "@/lib/estado";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const naoEncontrado = () => NextResponse.json({ erro: "Ponto não encontrado." }, { status: 404 });

/** Só o dono mexe no ponto; para os outros ele "não existe" (não revela nada). */
async function pontoDoMotorista(id: number, motoristaId: number | null) {
  if (!motoristaId || !Number.isInteger(id)) return null;
  const [p] = await db
    .select()
    .from(pontos)
    .where(and(eq(pontos.id, id), eq(pontos.motoristaId, motoristaId)))
    .limit(1);
  return p ?? null;
}

/** Violação de "ponto repetido no mesmo motorista" (Postgres 23505). */
function duplicado(e: unknown) {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code === "23505" || x?.cause?.code === "23505";
}

/**
 * Corrige o ponto monitorado (tipo / livro / número) e revarre o site na
 * hora para recalcular posição e status. Corpo: { tipo, livro, numero, motoristaId }.
 */
export async function PATCH(req: Request, { params }: Params) {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return naoAutorizadoMotorista();
  const { id } = await params;
  const alvo = Number(id);
  const corpo = await req.json().catch(() => ({}));
  if (corpo.motoristaId != null && Number(corpo.motoristaId) !== motorista.id) return naoAutorizadoMotorista();
  const atual = await pontoDoMotorista(alvo, motorista.id);
  if (!atual) return naoEncontrado();

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
  try {
    await db
      .update(pontos)
      .set({ tipo, livro, numero: Math.trunc(numero) })
      .where(and(eq(pontos.id, alvo), eq(pontos.motoristaId, motorista.id)));
  } catch (e) {
    if (duplicado(e)) {
      return NextResponse.json(
        { erro: `Você já está monitorando o ponto ${codigo}.` },
        { status: 409 },
      );
    }
    throw e;
  }

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

  return NextResponse.json({ estado: await montarEstado(motorista.id) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** Remove apenas um ponto monitorado pelo dono desta sessão. */
export async function DELETE(req: Request, { params }: Params) {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return naoAutorizadoMotorista();
  const { id } = await params;
  const alvo = Number(id);
  const corpo = await req.json().catch(() => ({}));
  if (corpo.motoristaId != null && Number(corpo.motoristaId) !== motorista.id) return naoAutorizadoMotorista();
  const atual = await pontoDoMotorista(alvo, motorista.id);
  if (!atual) return naoEncontrado();

  await db.delete(pontos).where(and(eq(pontos.id, alvo), eq(pontos.motoristaId, motorista.id)));
  await registrarEvento({
    codigo: codigoDe(atual.livro, atual.numero),
    tipo: atual.tipo,
    livro: atual.livro,
    numero: atual.numero,
    acao: "removeu",
    mensagem: `${codigoDe(atual.livro, atual.numero)} saiu do monitoramento · varredura parada`,
  });
  return NextResponse.json({ estado: await montarEstado(motorista.id) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
