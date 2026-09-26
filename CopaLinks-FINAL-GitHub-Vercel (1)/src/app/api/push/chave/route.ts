import { NextResponse } from "next/server";
import { chavePublica, totalAssinaturas, vapidConfigurado } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * A chave pública VAPID pode ir para o navegador. A chave privada nunca sai
 * do servidor — este endpoint não a conhece.
 */
export async function GET() {
  return NextResponse.json({
    publicKey: await chavePublica(),
    vapid: await vapidConfigurado(),
    assinaturas: await totalAssinaturas(),
  });
}
