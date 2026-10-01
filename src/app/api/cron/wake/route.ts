import { NextResponse } from "next/server";
import { obterOuCriarWakeToken } from "@/lib/cron-wake";

export const dynamic = "force-dynamic";

/**
 * Entrega um token curto de wake-up para o Service Worker.
 *
 * O token autoriza o GET /api/cron (e só ele) durante 12 h. É entregue
 * a qualquer navegador que já tenha acesso ao app — o que já é suficiente
 * para disparar o ciclo de monitoramento (que é idempotente e só envia
 * Push se houver novidade).
 */
export async function GET() {
  try {
    const token = await obterOuCriarWakeToken();
    return NextResponse.json(
      { token },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json({ token: null }, { status: 500 });
  }
}
