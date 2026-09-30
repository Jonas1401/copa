import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { alertaPendente, resolverAlerta } from "@/lib/alerta-admin";
import { motoristaDaSessao, naoAutorizadoMotorista } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "private, no-store" };

/** GET → alerta pendente do administrador para o motorista deste aparelho. */
export async function GET() {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  return NextResponse.json({ alerta: await alertaPendente(m.id) }, { headers: CAB });
}

/**
 * POST { id, endpoint } → fecha o alerta. Só aceita se este aparelho está
 * inscrito no Web Push (endpoint ativo e do próprio motorista).
 */
export async function POST(req: Request) {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return naoAutorizadoMotorista();
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.slice(0, 2000) : "";
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ erro: "Alerta inválido." }, { status: 400, headers: CAB });
  const r = await resolverAlerta(m.id, id, endpoint);
  if (!r.ok) {
    const erro = r.motivo === "sem_notificacao"
      ? "As notificações ainda não estão ativas neste aparelho."
      : "Este alerta já foi fechado.";
    return NextResponse.json({ erro, motivo: r.motivo }, { status: r.motivo === "sem_notificacao" ? 409 : 404, headers: CAB });
  }
  return NextResponse.json({ ok: true }, { headers: CAB });
}
