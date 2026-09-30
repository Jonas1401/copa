import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { chatEstaSilenciado, definirSilencioChat } from "@/lib/chat-silencio";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "private, no-store" };

/** GET → { silenciado } do motorista deste aparelho (sessão httpOnly). */
export async function GET() {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  return NextResponse.json({ silenciado: await chatEstaSilenciado(m.id) }, { headers: CAB });
}

/** POST { silenciado: boolean } → liga/desliga SÓ as notificações do chat. */
export async function POST(req: Request) {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const body = await req.json().catch(() => ({}));
  if (typeof body?.silenciado !== "boolean") {
    return NextResponse.json({ erro: "Informe silenciado: true ou false." }, { status: 400, headers: CAB });
  }
  return NextResponse.json({ silenciado: await definirSilencioChat(m.id, body.silenciado) }, { headers: CAB });
}
