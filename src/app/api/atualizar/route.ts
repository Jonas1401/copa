import { NextResponse } from "next/server";
import { getEstado } from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";
import {
  deveRodarFallback,
  dispararAlertasEmBackground,
  ultimoResultadoAlertas,
} from "@/lib/alertas-fallback";

export const dynamic = "force-dynamic";

/**
 * Relê o quadro e devolve apenas os pontos da sessão deste aparelho.
 *
 * Esta rota é chamada a cada 5 segundos pelo MonitorApp enquanto o
 * navegador está aberto. Aqui também aproveitamos para disparar os
 * alertas de chuva e navios EM BACKGROUND (sem atrasar a resposta),
 * como fallback quando o /api/cron externo (Vercel/Supabase) não está
 * rodando a cada minuto. Os módulos de alerta já têm antispam próprio,
 * então não há risco de mandar notificação duplicada.
 */
export async function POST() {
  const motorista = await motoristaDaSessao();
  const estado = await getEstado(motorista?.id ?? null, true);

  // Dispara os alertas em "fogo e esquece" só se já passou o intervalo
  // mínimo (2 min), para não bater toda hora na APPA/Simport.
  if (await deveRodarFallback().catch(() => false)) {
    dispararAlertasEmBackground();
  }

  return NextResponse.json(
    { ...estado, _alertasFallback: ultimoResultadoAlertas() ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
