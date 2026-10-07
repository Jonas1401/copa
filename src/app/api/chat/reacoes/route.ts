import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { alternarReacao, listarReacoes } from "@/lib/chat-reacoes";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/reacoes?ids=12,13,14 → reações das mensagens visíveis na tela.
 * A tela pergunta junto com as mensagens novas, então a curtida de um
 * motorista aparece para os outros sem precisar fechar e abrir o chat.
 */
export async function GET(req: Request) {
  await garantirTabelas();
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
  const reacoes = await listarReacoes(ids);
  return NextResponse.json({ reacoes }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/chat/reacoes { mensagemId, motoristaId, emoji }
 * - emoji com 1 emoji: curte (ou troca, se já curtiu com outro);
 * - mesmo emoji de novo, ou emoji vazio: descurte.
 * Não entra no chat como mensagem nova e não dispara Push: é silencioso.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  const corpo = await req.json().catch(() => ({}));
  const resultado = await alternarReacao(
    Number(corpo?.mensagemId),
    Number(corpo?.motoristaId),
    typeof corpo?.emoji === "string" ? corpo.emoji : null,
  );
  if ("erro" in resultado) {
    const status = resultado.erro.includes("Cadastre") ? 403 : 400;
    return NextResponse.json({ erro: resultado.erro }, { status });
  }
  return NextResponse.json(resultado, { status: 200 });
}
