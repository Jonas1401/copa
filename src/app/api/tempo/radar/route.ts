import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { leituraPublica, ROTULO_METODO } from "@/lib/appa/tipos";
import { lerPainelAgora, statusRadarClima, verificarMudancasPrevisao } from "@/lib/clima-monitor";
import { exigirAdmin } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * RADAR DA PREVISÃO — painel do monitoramento constante do tempo.
 *
 *   GET /api/tempo/radar            → situação do radar (ligado, última leitura,
 *                                     última mudança avisada e fontes em uso)
 *   POST /api/tempo/radar?forcar=1  → roda um ciclo agora
 *   POST /api/tempo/radar?painel=1  → lê o painel da APPA agora por todos os
 *                                     métodos (diagnóstico: não avisa ninguém)
 *
 * As duas rotas são restritas ao administrador: o cartão *Radar da previsão*
 * vive só na área do administrador (`/admin`). O ciclo de verdade roda no
 * `/api/cron` a cada minuto; este POST serve para o administrador conferir na
 * hora que o monitoramento está vivo, sem esperar.
 */
export async function GET() {
  const sessao = await exigirAdmin();
  if (sessao instanceof NextResponse) return sessao;
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
    if (url.searchParams.get("painel") === "1") {
      // Só leitura + log: confere na hora qual método está funcionando.
      const r = await lerPainelAgora();
      return NextResponse.json({
        leitura: r.leitura ? leituraPublica(r.leitura) : null,
        metodo: r.metodo,
        metodoRotulo: r.metodo ? ROTULO_METODO[r.metodo] : null,
        duracaoMs: r.duracaoMs,
        erro: r.erro,
        log: r.tentativas.map((t) => t.linha),
        status: await statusRadarClima(),
      });
    }
    const r = await verificarMudancasPrevisao({ forcar: url.searchParams.get("forcar") === "1" });
    return NextResponse.json({ ...r, status: await statusRadarClima() });
  } catch (e) {
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : "Falha ao rodar o radar." },
      { status: 500 },
    );
  }
}
