import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens } from "@/db/schema";
import { garantirTabelas } from "@/lib/estado";
import { removerReacoesDaMensagem } from "@/lib/chat-reacoes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Apaga a PRÓPRIA mensagem (o motorista só apaga o que ele escreveu). */
export async function DELETE(req: Request, { params }: Params) {
  await garantirTabelas();
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  const motoristaId = Number(corpo?.motoristaId);
  if (!Number.isInteger(motoristaId) || motoristaId <= 0) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  const r = await db
    .delete(chatMensagens)
    .where(and(eq(chatMensagens.id, Number(id)), eq(chatMensagens.motoristaId, motoristaId)))
    .returning({ id: chatMensagens.id });
  if (!r.length) return NextResponse.json({ erro: "Mensagem não encontrada." }, { status: 404 });
  await removerReacoesDaMensagem(Number(id));
  return NextResponse.json({ ok: true });
}
