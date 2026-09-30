import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin/auth";
import {
  notificarTeste,
  totalAssinaturas,
  vapidConfigurado,
} from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Teste real do Web Push: o backend envia, o Chrome recebe e o Service Worker
 * mostra a notificação do sistema. Não é mensagem de página nem alert().
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const endpoint = corpo?.endpoint ? String(corpo.endpoint).trim() : undefined;

  // O botão no app envia a assinatura do próprio aparelho. Um teste sem
  // endpoint dispara para TODOS os inscritos: só administradores podem fazê-lo.
  if (!endpoint) {
    const admin = await exigirAdmin();
    if (admin instanceof NextResponse) return admin;
  }

  if (!(await vapidConfigurado())) {
    return NextResponse.json(
      { erro: "VAPID não configurado no servidor." },
      { status: 503 },
    );
  }

  const resultado = await notificarTeste(endpoint);
  return NextResponse.json({ ...resultado, assinaturasAtivas: await totalAssinaturas() });
}
