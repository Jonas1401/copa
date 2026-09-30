import { NextResponse } from "next/server";
import { dispositivoAutenticado } from "@/lib/auth";
import { garantirTabelas } from "@/lib/estado";
import { TEXTO_MAX } from "@/lib/grupo-filtro";
import { processarMensagemGrupo } from "@/lib/grupo-aviso";
import { PACOTES_WHATSAPP } from "@/lib/monitor";
import { HASH_GRUPO_MONITORADO } from "@/lib/monitor-group";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CAB = { "Cache-Control": "private, no-store" };
const erro = (msg: string, status: number) => NextResponse.json({ erro: msg }, { status, headers: CAB });

/**
 * POST /api/monitor/grupo — filtro automático do grupo "INFO. OP PORTO / FOSPAR **".
 *
 * Chamado SÓ pelo Monitor Android pareado (Authorization: Bearer <segredo do
 * aparelho>), com o texto da mensagem mais recente que o WhatsApp publicou na
 * notificação desse grupo. O servidor identifica "PONTOS NA VEZ" e
 * "... PULADAS", compara o código completo com o ponto de cada motorista e
 * avisa só o dono pelo Web Push existente. O texto não é gravado.
 * Não depende do Firebase (o Firebase continua opcional para o /api/monitor/messages).
 *
 * Corpo: { eventId: sha256 hex, origem: "com.whatsapp" | "com.whatsapp.w4b",
 *          grupoHash: sha256 do nome do grupo, texto: string }
 */
export async function POST(req: Request) {
  await garantirTabelas();
  const device = await dispositivoAutenticado(req, "MONITOR");
  if (!device) return erro("Android monitor não autorizado.", 401);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return erro("Evento inválido.", 400);
  const { eventId, origem, grupoHash, texto } = body;
  if (typeof eventId !== "string" || !/^[a-f0-9]{64}$/i.test(eventId)) return erro("ID do evento inválido.", 400);
  if (!PACOTES_WHATSAPP.includes(origem as (typeof PACOTES_WHATSAPP)[number])) return erro("Origem não permitida.", 400);
  if (typeof grupoHash !== "string" || grupoHash.toLowerCase() !== HASH_GRUPO_MONITORADO) {
    return erro("Grupo monitorado não autorizado.", 400);
  }
  if (typeof texto !== "string" || !texto.trim()) return erro("Mensagem vazia.", 400);
  if (texto.length > TEXTO_MAX) return erro("Mensagem grande demais.", 413);

  try {
    const r = await processarMensagemGrupo(device, { eventId: eventId.toLowerCase(), origem: origem as string, texto });
    if (r.limite) return erro("Muitos eventos; aguarde um minuto.", 429);
    return NextResponse.json({ ok: true, ...r }, { status: r.ignorada ? 200 : 202, headers: CAB });
  } catch {
    return erro("Falha temporária ao processar a mensagem.", 503);
  }
}
