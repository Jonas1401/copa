import { NextResponse } from "next/server";
import { processarEventoPagamento } from "@/lib/esim/payments";
import { EsimServiceError } from "@/lib/esim/orders";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { verificarAssinaturaHmac } from "@/lib/esim/security";
import { nexaeMode } from "@/lib/esim/nexaesim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headersPrivate = { "Cache-Control": "no-store", Pragma: "no-cache" };

/**
 * Canonical adapter callback; no payment vendor is currently installed in CopaLinks.
 * Production adapters must validate their own signature and map approved events to this contract.
 */
export async function POST(req: Request) {
  if (nexaeMode() !== "PRODUCTION") {
    return NextResponse.json({ erro: "O callback de gateway está desativado no modo TESTE." }, { status: 409, headers: headersPrivate });
  }
  const secret = process.env.ESIM_PAYMENT_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json({ erro: "Webhook de pagamento não configurado no backend." }, { status: 503, headers: headersPrivate });
  }
  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > 32_000) {
    return NextResponse.json({ erro: "Evento excede o tamanho permitido." }, { status: 413, headers: headersPrivate });
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > 32_000) {
    return NextResponse.json({ erro: "Evento excede o tamanho permitido." }, { status: 413, headers: headersPrivate });
  }
  if (!verificarAssinaturaHmac(rawBody, req.headers.get("Signature"), secret)) {
    return NextResponse.json({ erro: "Assinatura inválida." }, { status: 401, headers: headersPrivate });
  }
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ erro: "JSON do evento inválido." }, { status: 400, headers: headersPrivate });
  }
  try {
    await garantirSchemaEsim();
    const result = await processarEventoPagamento(rawBody, event);
    return NextResponse.json(result, { headers: headersPrivate });
  } catch (error) {
    if (error instanceof EsimServiceError) {
      return NextResponse.json({ erro: error.message }, { status: error.status, headers: headersPrivate });
    }
    return NextResponse.json({ erro: "Evento não pôde ser salvo; tente novamente." }, { status: 500, headers: headersPrivate });
  }
}
