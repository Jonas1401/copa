import { NextResponse } from "next/server";
import { garantirSchemaEsim } from "@/lib/esim/database";
import { receberWebhookNexa } from "@/lib/esim/webhooks";
import { verificarAssinaturaHmac } from "@/lib/esim/security";
import { nexaeMode } from "@/lib/esim/nexaesim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cabecalhosPrivados = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** NexaEsim v1 callback: HMAC-SHA256 over exact raw UTF-8 body, Signature header. */
export async function POST(req: Request) {
  if (nexaeMode() !== "PRODUCTION") {
    return NextResponse.json({ erro: "Callback NexaEsim desativado no modo TESTE; não há sandbox publicado." }, { status: 409, headers: cabecalhosPrivados });
  }
  const secret = process.env.NEXAESIM_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json({ erro: "Webhook NexaEsim não configurado no backend." }, { status: 503, headers: cabecalhosPrivados });
  }
  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > 128_000) {
    return NextResponse.json({ erro: "Callback excede o tamanho permitido." }, { status: 413, headers: cabecalhosPrivados });
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > 128_000) {
    return NextResponse.json({ erro: "Callback excede o tamanho permitido." }, { status: 413, headers: cabecalhosPrivados });
  }
  if (!verificarAssinaturaHmac(rawBody, req.headers.get("Signature"), secret)) {
    return NextResponse.json({ erro: "Assinatura inválida." }, { status: 401, headers: cabecalhosPrivados });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ erro: "JSON do callback inválido." }, { status: 400, headers: cabecalhosPrivados });
  }
  try {
    await garantirSchemaEsim();
    const result = await receberWebhookNexa(rawBody, body);
    if (result.status === "INVALID") return NextResponse.json({ erro: "Callback sem estrutura documentada." }, { status: 400, headers: cabecalhosPrivados });
    if (result.status === "PENDING") {
      // O corpo assinado foi persistido para processar assim que o orderCode local aparecer.
      return NextResponse.json({ recebido: true, estado: "pendente" }, { status: 202, headers: cabecalhosPrivados });
    }
    return NextResponse.json({ recebido: true, duplicado: result.status === "DUPLICATE" }, { headers: cabecalhosPrivados });
  } catch {
    // Sem corpo do provedor nem detalhes de eSIM em logs/respostas; a Nexa pode tentar de novo.
    return NextResponse.json({ erro: "Callback ainda não pôde ser salvo; tente novamente." }, { status: 500, headers: cabecalhosPrivados });
  }
}
