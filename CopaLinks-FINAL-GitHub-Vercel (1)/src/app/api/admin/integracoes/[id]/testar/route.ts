import { NextResponse } from "next/server";
import { auditar, exigirAdmin, ipDe } from "@/lib/admin/auth";
import { definicao, listarEstados, testar } from "@/lib/admin/integracoes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Testa a conexão no servidor (as chaves nunca saem de lá). */
export async function POST(req: Request, { params }: Params) {
  const g = await exigirAdmin();
  if (g instanceof NextResponse) return g;
  const { id } = await params;
  const d = definicao(id);
  if (!d) return NextResponse.json({ erro: "Integração desconhecida." }, { status: 404 });
  const corpo = await req.json().catch(() => ({}));
  const endpoint = typeof corpo?.endpointAparelho === "string" ? corpo.endpointAparelho : undefined;
  const r = await testar(d.id, { endpointAparelho: endpoint });
  await auditar({ admin: g, integracao: d.id, acao: "testou conexão", detalhe: r.status, ip: ipDe(req) });
  return NextResponse.json({ teste: r, integracoes: await listarEstados() });
}
