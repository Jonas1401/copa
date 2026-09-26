import { NextResponse } from "next/server";
import { obterPrevisao, resumoEmTexto } from "@/lib/tempo";

export const dynamic = "force-dynamic";

/**
 * Previsão de Paranaguá (SIMPORT/APPA + estação do porto + Open-Meteo).
 *   GET /api/tempo            → previsão completa
 *   GET /api/tempo?forcar=1   → ignora o cache de 10 min (botão atualizar)
 *   GET /api/tempo?formato=texto → resumo em uma frase
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const p = await obterPrevisao(url.searchParams.get("forcar") === "1");
    if (url.searchParams.get("formato") === "texto") {
      return NextResponse.json({ texto: resumoEmTexto(p), atualizadoEm: p.atualizadoEm });
    }
    return NextResponse.json(p);
  } catch {
    return NextResponse.json({ erro: "Previsão indisponível no momento." }, { status: 503 });
  }
}
