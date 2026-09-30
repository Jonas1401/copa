import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { processarWebhookWhatsApp, segredoWebhookValido } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";
// Tempo para filtrar a lista e AGUARDAR os Web Push (a Vercel encerra ao responder).
export const maxDuration = 60;
const CAB = { "Cache-Control": "private, no-store" };

/**
 * POST /api/whatsapp/webhook — filtro do grupo SEM APK.
 *
 * Chamado pelo serviço de WhatsApp Web (Green-API, Z-API, Evolution API,
 * WAHA ou Whapi) a cada mensagem da conta conectada. Exige o segredo gerado
 * em /monitor (Authorization, X-Webhook-Token ou ?token=). Só o grupo
 * "INFO. OP PORTO / FOSPAR **" é processado; o resto é descartado na hora.
 * Mensagens ignoradas respondem 200 para o serviço não reenviar.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  if (!(await segredoWebhookValido(req))) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401, headers: CAB });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true, recebidas: 0 }, { headers: CAB });
  try {
    const r = await processarWebhookWhatsApp(body);
    return NextResponse.json({ ok: true, ...r }, { headers: CAB });
  } catch {
    // 503: o serviço tenta de novo; a trava de duplicidade evita aviso em dobro.
    return NextResponse.json({ erro: "Falha temporária." }, { status: 503, headers: CAB });
  }
}

/** Alguns serviços testam o endereço com GET antes de salvar. */
export async function GET(req: Request) {
  await garantirTabelas();
  const ok = await segredoWebhookValido(req);
  return NextResponse.json(ok ? { ok: true, servico: "CopaLinks — filtro do grupo" } : { erro: "Não autorizado." }, {
    status: ok ? 200 : 401,
    headers: CAB,
  });
}
