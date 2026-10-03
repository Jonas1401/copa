import { NextResponse } from "next/server";
import { tickRadar } from "@/lib/clima-monitor";
import {
  montarEstado,
  temPontoCadastrado,
  varrerSeVelho,
} from "@/lib/estado";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";

const PRAZO_RESPOSTA = 1500;

function comPrazo<T>(tarefa: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    tarefa.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

export async function GET() {
  try {
    // Com ponto monitorado, cada chamada pode carregar uma varredura nova do
    // site — nunca mais que 1,5s de espera; o resto termina em segundo plano.
    if (await temPontoCadastrado()) {
      await comPrazo(varrerSeVelho(), PRAZO_RESPOSTA);
    }
    const motorista = await motoristaDaSessao();
    const estado = await montarEstado(motorista?.id ?? null);
    // Radar da previsão: o app aberto chama esta rota o tempo todo, então é
    // aqui que o monitoramento do tempo continua vivo quando o /api/cron do
    // provedor não roda a cada minuto. Custa uma comparação de horário na
    // maior parte das vezes; nunca joga erro nem atrasa a resposta da fila.
    await tickRadar().catch(() => null);
    return NextResponse.json(estado, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (erro) {
    return NextResponse.json(
      { erro: "Falha ao ler o monitor" + String(erro) },
      { status: 500 },
    );
  }
}
