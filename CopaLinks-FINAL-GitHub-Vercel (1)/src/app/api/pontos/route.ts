import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { motoristas, pontos } from "@/db/schema";
import {
  LIVROS,
  TIPOS,
  codigoDe,
  montarEstado,
  registrarEvento,
  varrer,
} from "@/lib/estado";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const tipo = String(corpo.tipo ?? "").toUpperCase();
  const livro = String(corpo.livro ?? "").toUpperCase().replace("LIVRO ", "");
  const numero = Number(corpo.numero);
  const motoristaId = Number.isInteger(Number(corpo.motoristaId))
    ? Number(corpo.motoristaId)
    : null;

  if (!TIPOS.includes(tipo as never) || !LIVROS.includes(livro as never)) {
    return NextResponse.json({ erro: "Tipo ou livro inválido." }, { status: 400 });
  }
  if (!Number.isFinite(numero) || numero < 1 || numero > 999) {
    return NextResponse.json(
      { erro: "Informe um número de ponto entre 001 e 999." },
      { status: 400 },
    );
  }

  // Só aceita o motorista se ele existir de verdade na lista.
  let motorista: { id: number; nome: string } | null = null;
  if (motoristaId) {
    const [m] = await db
      .select({ id: motoristas.id, nome: motoristas.nome })
      .from(motoristas)
      .where(eq(motoristas.id, motoristaId))
      .limit(1);
    motorista = m ?? null;
  }

  const n = Math.trunc(numero);
  const cod = codigoDe(livro, n);
  const [{ ordem }] = await db
    .select({ ordem: sql<number>`coalesce(max(${pontos.ordem}), -1) + 1` })
    .from(pontos);

  const inserido = await db
    .insert(pontos)
    .values({
      tipo,
      livro,
      numero: n,
      naFrente: 0,
      status: "AGUARDANDO",
      ordem: Number(ordem) || 0,
      motoristaId: motorista?.id ?? null,
    })
    .onConflictDoNothing()
    .returning();

  let criado = inserido[0];
  if (!criado) {
    // O ponto já é monitorado. Se ainda não tem dono, passa a ser deste
    // motorista (ele aparece na lista com o ponto); senão é repetido mesmo.
    const [existente] = await db
      .select()
      .from(pontos)
      .where(and(eq(pontos.tipo, tipo), eq(pontos.livro, livro), eq(pontos.numero, n)))
      .limit(1);
    if (motorista && existente && existente.motoristaId === null) {
      [criado] = await db
        .update(pontos)
        .set({ motoristaId: motorista.id })
        .where(eq(pontos.id, existente.id))
        .returning();
      await registrarEvento({
        codigo: cod,
        tipo,
        livro,
        numero: n,
        acao: "atualizou",
        mensagem: `${cod} agora é de ${motorista.nome}`,
      });
      return NextResponse.json({ estado: await montarEstado(), ponto: criado });
    }
    return NextResponse.json(
      { erro: `O ponto ${cod} já está no monitoramento.` },
      { status: 409 },
    );
  }

  await registrarEvento({
    codigo: cod,
    tipo,
    livro,
    numero: n,
    acao: "cadastrou",
    mensagem: `${cod} entrou no monitoramento${motorista ? ` · ${motorista.nome}` : ""} · varredura iniciada`,
  });

  // Do cadastro já nasce a varredura: confere o número em todas as tabelas.
  // Se o site não respondeu de primeira, tenta mais uma vez na hora.
  let leitura = await varrer();
  if (leitura.origem !== "intranet") {
    await new Promise((r) => setTimeout(r, 700));
    leitura = await varrer({ forcarRede: true });
  }

  return NextResponse.json(
    { estado: await montarEstado(), ponto: criado },
    { status: 201 },
  );
}

export async function GET() {
  const lista = await db.select().from(pontos).orderBy(pontos.id);
  return NextResponse.json(lista);
}
