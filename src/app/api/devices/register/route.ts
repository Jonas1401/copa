import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/supabase";
import { monitorDevices } from "@/db/schema";
import { exigirAdmin } from "@/lib/admin/auth";
import { dispositivoAutenticado, fcmTokenValido, gerarPareamento, marcarAtivo, parearAparelho } from "@/lib/auth";
import { garantirTabelas } from "@/lib/estado";
import { firebaseConfigurado } from "@/lib/firebase";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";
const CAB = { "Cache-Control": "private, no-store" };
const erro = (msg: string, status: number) => NextResponse.json({ erro: msg }, { status, headers: CAB });

/** Somente os receptores deste motorista, sem segredos nem tokens Firebase. */
export async function GET() {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return erro("Entre no seu perfil neste aparelho.", 401);
  const devices = await db.select({ id: monitorDevices.id, nome: monitorDevices.nome,
    ativo: monitorDevices.ativo, ultimoContatoEm: monitorDevices.ultimoContatoEm })
    .from(monitorDevices).where(eq(monitorDevices.motoristaId, motorista.id));
  return NextResponse.json({ aparelhos: devices.map((d) => ({ ...d,
    ultimoContatoEm: d.ultimoContatoEm?.toISOString() ?? null })) }, { headers: CAB });
}

/**
 * POST /api/devices/register
 * - create-monitor-code: admin (cookie ou sessão Bearer) gera ativação do monitor;
 * - create-receiver-code: motorista logado gera ativação do próprio Android;
 * - pair: Android troca o código de uso único pela credencial do aparelho;
 * - refresh: Android receptor atualiza o token FCM;
 * - revoke: Android revoga a própria credencial;
 * - admin-revoke: admin desativa um aparelho pelo ID.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "create-monitor-code") {
    const admin = await exigirAdmin();
    if (admin instanceof NextResponse) return admin;
    return NextResponse.json(await gerarPareamento("MONITOR", null), { headers: CAB });
  }
  if (action === "create-receiver-code") {
    const motorista = await motoristaDaSessao();
    if (!motorista) return erro("Entre no seu perfil neste aparelho para parear o Android.", 401);
    if (!firebaseConfigurado()) return erro("Firebase ainda não configurado no servidor.", 503);
    return NextResponse.json(await gerarPareamento("RECEIVER", motorista.id), { headers: CAB });
  }
  if (action === "pair") {
    const tipo = body?.tipo === "MONITOR" ? "MONITOR" : body?.tipo === "RECEIVER" ? "RECEIVER" : null;
    if (!tipo) return erro("Tipo de aparelho inválido.", 400);
    if (tipo === "RECEIVER" && !firebaseConfigurado()) return erro("Firebase ainda não configurado no servidor.", 503);
    const resultado = await parearAparelho(tipo, body?.codigo, body?.nome, body?.fcmToken);
    if (!resultado) return erro("Código inválido, vencido ou já usado. Gere outro no CopaLinks.", 403);
    return NextResponse.json(resultado, { headers: CAB });
  }
  if (action === "refresh") {
    const device = await dispositivoAutenticado(req, "RECEIVER");
    if (!device) return erro("Aparelho não autorizado.", 401);
    if (!fcmTokenValido(body?.fcmToken)) return erro("Token FCM inválido.", 400);
    await db.update(monitorDevices).set({ fcmToken: body.fcmToken, ultimoContatoEm: new Date() })
      .where(eq(monitorDevices.id, device.id));
    return NextResponse.json({ ok: true }, { headers: CAB });
  }
  if (action === "revoke") {
    const device = await dispositivoAutenticado(req);
    if (!device) return erro("Aparelho não autorizado.", 401);
    await db.update(monitorDevices).set({ ativo: 0, fcmToken: null }).where(eq(monitorDevices.id, device.id));
    return NextResponse.json({ ok: true }, { headers: CAB });
  }
  if (action === "admin-revoke") {
    const admin = await exigirAdmin();
    if (admin instanceof NextResponse) return admin;
    const id = Number(body?.deviceId);
    if (!Number.isSafeInteger(id) || id < 1) return erro("Aparelho inválido.", 400);
    const [revogado] = await db.update(monitorDevices).set({ ativo: 0, fcmToken: null })
      .where(eq(monitorDevices.id, id)).returning({ id: monitorDevices.id });
    return revogado ? NextResponse.json({ ok: true }, { headers: CAB }) : erro("Aparelho não encontrado.", 404);
  }
  if (action === "heartbeat") {
    const device = await dispositivoAutenticado(req);
    if (!device) return erro("Aparelho não autorizado.", 401);
    await marcarAtivo(device.id);
    return NextResponse.json({ ok: true }, { headers: CAB });
  }
  return erro("Ação desconhecida.", 400);
}
