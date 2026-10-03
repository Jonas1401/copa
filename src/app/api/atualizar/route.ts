import { NextResponse } from "next/server";
import { tickRadar } from "@/lib/clima-monitor";
import { getEstado } from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";

/**
 * Relê o quadro e devolve apenas os pontos da sessão deste aparelho.
 *
 * O aplicativo chama esta rota a cada 5 s enquanto está aberto, então ela é o
 * melhor lugar para manter o RADAR DA PREVISÃO vivo também sem o cron: a
 * batida (`tickRadar`) custa só uma comparação de horário na maioria das vezes
 * e, quando o intervalo vence, roda um ciclo leve com a previsão em cache.
 * Nunca atrasa nem quebra a resposta da fila (o radar não joga erro para cima).
 */
export async function POST() {
  const motorista = await motoristaDaSessao();
  const estado = await getEstado(motorista?.id ?? null, true);
  // Radar da previsão: barato no dia a dia, no máximo uma consulta por minuto.
  await tickRadar().catch(() => null);
  return NextResponse.json(estado, { headers: { "Cache-Control": "private, no-store" } });
}
