import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { desativarWebhook, gerarSegredoWebhook, statusWebhook } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "private, no-store" };

function enderecoPublico(req: Request) {
  const fixo = process.env.SITE_URL?.trim();
  if (fixo) return fixo.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return new URL(req.url).origin;
}

/** GET — situação da conexão do WhatsApp sem APK (só administrador). */
export async function GET() {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  return NextResponse.json(await statusWebhook(), { headers: CAB });
}

/**
 * POST — gera um NOVO segredo (o anterior deixa de valer) e devolve, uma única
 * vez, o endereço completo para colar no serviço de WhatsApp Web.
 */
export async function POST(req: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  const segredo = await gerarSegredoWebhook();
  await auditar({ admin, integracao: "whatsapp-webhook", acao: "gerou endereço do webhook", ip: ipDe(req) });
  const base = `${enderecoPublico(req)}/api/whatsapp/webhook`;
  return NextResponse.json(
    { endereco: base, enderecoComSegredo: `${base}?token=${segredo}`, segredo, status: await statusWebhook() },
    { headers: CAB },
  );
}

/** DELETE — desliga a entrada pelo servidor (o endereço para de aceitar mensagens). */
export async function DELETE(req: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  await desativarWebhook();
  await auditar({ admin, integracao: "whatsapp-webhook", acao: "desativou o webhook", ip: ipDe(req) });
  return NextResponse.json({ ok: true, status: await statusWebhook() }, { headers: CAB });
}
