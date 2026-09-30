import { NextResponse } from "next/server";
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
    return NextResponse.json(await montarEstado(motorista?.id ?? null), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (erro) {
    return NextResponse.json(
      { erro: "Falha ao ler o monitor" + String(erro) },
      { status: 500 },
    );
  }
}
