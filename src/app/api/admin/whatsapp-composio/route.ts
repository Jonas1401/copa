import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { ErroComposio } from "@/lib/composio";
import { estadoWhatsappComposio, linkWhatsappComposio } from "@/lib/whatsapp-composio";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "private, no-store" };

/** Estado da conexão empresarial; não devolve chaves, tokens nem números. */
export async function GET() {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json(await estadoWhatsappComposio(), { headers: CAB });
  } catch {
    return NextResponse.json({ erro: "Não foi possível consultar o Composio agora." }, { status: 502, headers: CAB });
  }
}

/** Cria link de autorização no Composio. Somente admin; nunca envia WhatsApp. */
export async function POST(req: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const siteUrl = process.env.SITE_URL || "https://copa-links.vercel.app";
    const link = await linkWhatsappComposio(siteUrl);
    await auditar({
      admin,
      integracao: "whatsapp",
      acao: "solicitou conexão pelo Composio",
      detalhe: "link de autorização iniciado (sem envio de mensagem)",
      ip: ipDe(req),
    });
    return NextResponse.json(link, { headers: CAB });
  } catch (e) {
    const mensagem = e instanceof ErroComposio
      ? "O Composio não conseguiu iniciar a conexão. Confira a conta empresarial e tente de novo."
      : e instanceof Error && e.message.startsWith("Configure")
        ? e.message
        : e instanceof Error && e.message.includes("já está conectada")
          ? e.message
          : "Não foi possível gerar o link de autorização. Tente de novo no painel.";
    return NextResponse.json({ erro: mensagem }, { status: 400, headers: CAB });
  }
}
