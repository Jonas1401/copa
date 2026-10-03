import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { statusRadarClima, verificarMudancasPrevisao } from "@/lib/clima-monitor";
import { exigirAdmin } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * RADAR DA PREVISÃO — painel do monitoramento constante do tempo.
 *
 *   GET /api/tempo/radar            → situação do radar (ligado, última leitura,
 *                                     última mudança avisada e fontes em uso)
 *   POST /api/tempo/radar?forcar=1  → roda um ciclo agora (somente administrador)
 *
 * O ciclo de verdade roda no `/api/cron` a cada minuto; este POST serve para o
 * administrador conferir na hora que o monitoramento está vivo, sem esperar.
 */
export async function GET() {
  try {
    await garantirTabelas();
    return NextResponse.json(await statusRadarClima());
  } catch {
    return NextResponse.json({ erro: "Radar indisponível no momento." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  // Forçar um ciclo escreve no chat e dispara Push para todos os motoristas:
  // por isso só o administrador autenticado pode pedir.
  const sessao = await exigirAdmin();
  if (sessao instanceof NextResponse) return sessao;
  const url = new URL(req.url);
  try {
    await garantirTabelas();
    const r = await verificarMudancasPrevisao({ forcar: url.searchParams.get("forcar") === "1" });
    return NextResponse.json({ ...r, status: await statusRadarClima() });
  } catch (e) {
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : "Falha ao rodar o radar." },
      { status: 500 },
    );
  }
}
