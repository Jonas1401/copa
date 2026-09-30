import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/supabase";
import { configuracao, monitorDeliveries, monitorDevices } from "@/db/schema";
import { enviarTesteFCM, firebaseConfigurado } from "@/lib/firebase";
import { garantirTabelas } from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";

/** Histórico privado de FCM: somente códigos/status, nunca mensagem do WhatsApp. */
export async function GET() {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  if (!motorista) return NextResponse.json({ erro: "Entre no seu perfil neste aparelho." }, { status: 401 });
  const rows = await db.select({ codigo: monitorDeliveries.codigo, status: monitorDeliveries.status,
    criadoEm: monitorDeliveries.criadoEm })
    .from(monitorDeliveries).where(eq(monitorDeliveries.motoristaId, motorista.id))
    .orderBy(desc(monitorDeliveries.id)).limit(40);
  return NextResponse.json({ avisos: rows.map((r) => ({ ...r, criadoEm: r.criadoEm.toISOString() })) },
    { headers: { "Cache-Control": "private, no-store" } });
}

/** Teste explícito e privado: um único aparelho do próprio motorista por minuto. */
export async function POST(req: Request) {
  await garantirTabelas();
  const motorista = await motoristaDaSessao();
  const cab = { "Cache-Control": "private, no-store" };
  if (!motorista) return NextResponse.json({ erro: "Entre no seu perfil neste aparelho." }, { status: 401, headers: cab });
  if (!firebaseConfigurado()) return NextResponse.json({ erro: "Firebase ainda não configurado." }, { status: 503, headers: cab });
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.deviceId);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ erro: "Aparelho inválido." }, { status: 400, headers: cab });
  const [device] = await db.select({ fcmToken: monitorDevices.fcmToken }).from(monitorDevices)
    .where(and(eq(monitorDevices.id, id), eq(monitorDevices.motoristaId, motorista.id),
      eq(monitorDevices.tipo, "RECEIVER"), eq(monitorDevices.ativo, 1))).limit(1);
  if (!device?.fcmToken) return NextResponse.json({ erro: "Aparelho não encontrado." }, { status: 404, headers: cab });
  // Trava no PostgreSQL funciona entre Functions distintas da Vercel.
  const limit = await db.execute(sql`
    INSERT INTO configuracao (chave, valor) VALUES (${`monitor_teste_${id}`}, 'ok')
    ON CONFLICT (chave) DO UPDATE SET criado_em = now()
      WHERE configuracao.criado_em < now() - interval '1 minute'
    RETURNING chave`);
  if (!limit.rows.length) return NextResponse.json({ erro: "Espere um minuto para testar de novo." }, { status: 429, headers: cab });
  try {
    await enviarTesteFCM(device.fcmToken);
    return NextResponse.json({ ok: true, mensagem: "Aceito pelo Firebase. Confirme no aparelho Android." }, { headers: cab });
  } catch {
    return NextResponse.json({ erro: "Firebase recusou o teste; confira o projeto e o token do aparelho." }, { status: 502, headers: cab });
  }
}
