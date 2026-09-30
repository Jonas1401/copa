import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
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

/**
 * POST /api/pontos { tipo, livro, numero, motoristaId } → cadastra o ponto
 * PARA ESTE motorista. Cada motorista vê e recebe aviso só dos próprios
 * pontos; o mesmo número pode estar em dois motoristas, cada um com o seu.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return naoAutorizadoMotorista();
  const corpo = await req.json().catch(() => ({}));
  if (corpo.motoristaId != null && Number(corpo.motoristaId) !== motorista.id) return naoAutorizadoMotorista();
  const tipo = String(corpo.tipo ?? "").toUpperCase();
  const livro = String(corpo.livro ?? "").toUpperCase().replace("LIVRO ", "");
  const numero = Number(corpo.numero);

  if (!TIPOS.includes(tipo as never) || !LIVROS.includes(livro as never)) {
    return NextResponse.json({ erro: "Tipo ou livro inválido." }, { status: 400 });
  }
  if (!Number.isFinite(numero) || numero < 1 || numero > 999) {
    return NextResponse.json(
      { erro: "Informe um número de ponto entre 001 e 999." },
      { status: 400 },
    );
  }

  const n = Math.trunc(numero);
  const cod = codigoDe(livro, n);
  const [{ ordem }] = await db
    .select({ ordem: sql<number>`coalesce(max(${pontos.ordem}), -1) + 1` })
    .from(pontos);

  const [criado] = await db
    .insert(pontos)
    .values({
      tipo,
      livro,
      numero: n,
      naFrente: 0,
      status: "AGUARDANDO",
      ordem: Number(ordem) || 0,
      motoristaId: motorista.id,
    })
    .onConflictDoNothing()
    .returning();

  if (!criado) {
    // Só conflita quando ESTE motorista já monitora o mesmo ponto.
    return NextResponse.json(
      { erro: `Você já está monitorando o ponto ${cod}.` },
      { status: 409 },
    );
  }

  await registrarEvento({
    codigo: cod,
    tipo,
    livro,
    numero: n,
    acao: "cadastrou",
    mensagem: `${cod} entrou no monitoramento · ${motorista.nome} · varredura iniciada`,
  });

  // Do cadastro já nasce a varredura: confere o número em todas as tabelas.
  // Se o site não respondeu de primeira, tenta mais uma vez na hora.
  let leitura = await varrer();
  if (leitura.origem !== "intranet") {
    await new Promise((r) => setTimeout(r, 700));
    leitura = await varrer({ forcarRede: true });
  }

  return NextResponse.json(
    { estado: await montarEstado(motorista.id), ponto: criado },
    { status: 201, headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Lista somente os pontos deste aparelho, sem confiar em ?motoristaId. */
export async function GET() {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return naoAutorizadoMotorista();
  const lista = await db.select().from(pontos)
    .where(eq(pontos.motoristaId, motorista.id))
    .orderBy(pontos.ordem, pontos.id);
  return NextResponse.json(lista, { headers: { "Cache-Control": "private, no-store" } });
}
