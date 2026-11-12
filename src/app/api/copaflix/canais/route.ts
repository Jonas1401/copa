import { NextResponse } from "next/server";
import { carregarAcervo, carregarEpg, lerConfiguracao } from "@/lib/copaflix/fontes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/copaflix/canais
 *
 * Canais das listas autorizadas + situação das fontes + programa que está no
 * ar (quando há guia configurado). A tela de TV usa esta rota para atualizar
 * sem recarregar a página inteira. Nenhuma chave ou endereço privado sai
 * daqui: só nome, categoria, logo e o endereço do fluxo que o player precisa.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const forcar = url.searchParams.get("atualizar") === "1";
  const config = lerConfiguracao();
  try {
    const [acervo, epg] = await Promise.all([
      carregarAcervo(config, { forcar }),
      carregarEpg(config, { forcar }),
    ]);
    return NextResponse.json(
      {
        canais: acervo.canais,
        epg,
        fontes: acervo.fontes,
        atualizadoEm: acervo.atualizadoEm,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (erro) {
    console.error("[copaflix] /api/copaflix/canais:", erro);
    return NextResponse.json(
      { canais: [], epg: [], fontes: [], erro: "Não foi possível ler as fontes agora." },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
