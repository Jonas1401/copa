import { NextResponse } from "next/server";
import { ehFertilizante, lerLineup, lerManobras, lerMares, manobraDo } from "@/lib/navios";

export const dynamic = "force-dynamic";

/**
 * GET /api/navios → navios de FERTILIZANTES em Paranaguá e Antonina (dados
 * públicos da APPA + SINPRAPAR) e as próximas marés. Sem dados de usuários.
 */
export async function GET() {
  try {
    const [lineup, manobras, mares] = await Promise.all([
      lerLineup(),
      lerManobras().catch(() => []),
      lerMares().catch(() => []),
    ]);
    const vistos = new Set<string>();
    const navios = lineup
      .filter((n) => ehFertilizante(n.mercadoria) && n.secao !== "DESPACHADOS")
      .filter((n) => { const k = `${n.programacao}:${n.secao}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
      .map((n) => ({ ...n, manobra: manobraDo(n, manobras) }));
    return NextResponse.json(
      { atualizadoEm: new Date().toISOString(), total: navios.length, navios, mares: mares.slice(0, 8) },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json({ erro: "Não foi possível ler o line-up da APPA agora." }, { status: 502 });
  }
}
