import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { TEXTO_MAX } from "@/lib/grupo-filtro";
import { simularMensagemGrupo } from "@/lib/grupo-aviso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/grupo-teste { texto, enviar? } — SÓ ADMINISTRADOR.
 * Cola uma mensagem do grupo e mostra o que o filtro encontra e quem
 * receberia cada aviso. Com enviar=true, entrega os avisos de verdade
 * (mesma trava de 1 aviso por dia por ponto do monitor automático).
 */
export async function POST(req: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  const body = await req.json().catch(() => ({}));
  const texto = typeof body?.texto === "string" ? body.texto : "";
  if (!texto.trim()) return NextResponse.json({ erro: "Cole a mensagem do grupo." }, { status: 400 });
  if (texto.length > TEXTO_MAX) return NextResponse.json({ erro: "Mensagem grande demais." }, { status: 413 });
  const r = await simularMensagemGrupo(texto, { enviar: body?.enviar === true });
  return NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } });
}
