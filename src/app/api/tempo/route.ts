import { NextResponse } from "next/server";
import { obterPrevisao, resumoEmTexto } from "@/lib/tempo";
import {
  deveRodarFallback,
  dispararAlertasEmBackground,
} from "@/lib/alertas-fallback";

export const dynamic = "force-dynamic";

/**
 * Previsão de Paranaguá (SIMPORT/APPA + estação do porto + Open-Meteo).
 *   GET /api/tempo            → previsão completa
 *   GET /api/tempo?forcar=1   → ignora o cache de 10 min (botão atualizar)
 *   GET /api/tempo?formato=texto → resumo em uma frase
 *
 * Quando a tela de tempo é aberta (com ou sem "forcar"), também damos uma
 * chance aos alertas de clima e navios rodarem (em background), caso o
 * cron externo não esteja chegando.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const p = await obterPrevisao(url.searchParams.get("forcar") === "1");
    if (await deveRodarFallback().catch(() => false)) {
      dispararAlertasEmBackground();
    }
    if (url.searchParams.get("formato") === "texto") {
      return NextResponse.json({ texto: resumoEmTexto(p), atualizadoEm: p.atualizadoEm });
    }
    return NextResponse.json(p);
  } catch {
    return NextResponse.json({ erro: "Previsão indisponível no momento." }, { status: 503 });
  }
}
