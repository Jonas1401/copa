import { NextResponse } from "next/server";
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
  const endpoint = corpo?.endpoint ? String(corpo.endpoint) : undefined;

  if (!(await vapidConfigurado())) {
    return NextResponse.json(
      { erro: "VAPID não configurado no servidor." },
      { status: 503 },
    );
  }

  const resultado = await notificarTeste(endpoint);
  return NextResponse.json({ ...resultado, assinaturasAtivas: await totalAssinaturas() });
}
