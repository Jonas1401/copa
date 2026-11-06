import { NextResponse } from "next/server";
import { chavePublica, totalAssinaturas, vapidConfigurado } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * A chave pública VAPID pode ir para o navegador. A chave privada nunca sai
 * do servidor — este endpoint não a conhece.
 */
export async function GET() {
  // As chaves VAPID são o que permite o aviso chegar no celular. Se o banco
  // oscilar na hora do cadastro, devolve as chaves que estiverem no ambiente e
  // NUNCA um 500 — o app precisa poder se inscrever mesmo com o banco instável.
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  const [publicKey, vapid, assinaturas] = await Promise.all([
    chavePublica().catch(() => envPub ?? ""),
    vapidConfigurado().catch(() => Boolean(envPub && envPriv)),
    totalAssinaturas().catch(() => null),
  ]);
  return NextResponse.json({ publicKey, vapid, assinaturas });
}
