import { NextResponse } from "next/server";
import { adminAtual, apagarCookie, auditar, encerrarSessao, ipDe } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const admin = await adminAtual();
  await encerrarSessao();
  if (admin) await auditar({ admin, integracao: "acesso", acao: "saiu", ip: ipDe(req) });
  return apagarCookie(NextResponse.json({ ok: true }));
}
