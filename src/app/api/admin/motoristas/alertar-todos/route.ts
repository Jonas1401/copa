import { NextResponse } from "next/server";
import { exigirAdmin, ipDe, auditar } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { MENSAGEM_MAX, criarAlertaParaTodosSemNotificacao } from "@/lib/alerta-admin";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "no-store" };

/**
 * POST { mensagem? } → alerta para TODOS os motoristas sem notificações ativas.
 *
 * UM pedido só para a lista inteira: o trabalho é em lote dentro de
 * `criarAlertaParaTodosSemNotificacao`. O painel não deve mais abrir um pedido
 * por motorista — eram dezenas de Functions ao mesmo tempo, cada uma repetindo
 * a criação das tabelas, e o botão ficava preso em "Enviando…".
 */
export async function POST(req: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  const body = await req.json().catch(() => ({}));
  const bruta = typeof body?.mensagem === "string" ? body.mensagem.trim() : "";
  if (bruta.length > MENSAGEM_MAX) {
    return NextResponse.json({ erro: `Mensagem com no máximo ${MENSAGEM_MAX} caracteres.` }, { status: 400, headers: CAB });
  }
  const r = await criarAlertaParaTodosSemNotificacao(admin.nome, bruta || undefined);
  await auditar({ admin, integracao: "motoristas", acao: "alerta enviado para todos sem notificação", detalhe: `${r.enviados} motorista(s)`, ip: ipDe(req) }).catch(() => {});
  return NextResponse.json({ ok: true, ...r }, { headers: CAB });
}
