import { NextResponse } from "next/server";
import { dispositivoAutenticado } from "@/lib/auth";
import { garantirTabelas } from "@/lib/estado";
import { firebaseConfigurado } from "@/lib/firebase";
import { processarEventoMonitor, validarEventoMonitor } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CAB = { "Cache-Control": "private, no-store" };

/**
 * Recebe do NotificationListenerService SÓ os códigos já filtrados no Android.
 * Revalida no servidor e encontra os motoristas inscritos. Não recebe/guarda
 * remetente, telefone, grupo ou o texto completo de uma conversa WhatsApp.
 */
export async function POST(req: Request) {
  await garantirTabelas();
  const device = await dispositivoAutenticado(req, "MONITOR");
  if (!device) return NextResponse.json({ erro: "Android monitor não autorizado." }, { status: 401, headers: CAB });
  const body = await req.json().catch(() => null);
  const v = validarEventoMonitor(body);
  if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400, headers: CAB });
  if (!firebaseConfigurado()) {
    return NextResponse.json({ erro: "Firebase ainda não configurado no servidor." }, { status: 503, headers: CAB });
  }
  try {
    const result = await processarEventoMonitor(device, {
      eventId: v.evento.eventId,
      origem: v.evento.origem,
      codigos: v.codigos,
    });
    if (result.limite) {
      return NextResponse.json({ erro: "Muitos eventos; aguarde um minuto." }, { status: 429, headers: CAB });
    }
    return NextResponse.json({ ok: true, ...result }, { status: 202, headers: CAB });
  } catch {
    return NextResponse.json({ erro: "Falha temporária ao processar evento." }, { status: 503, headers: CAB });
  }
}
