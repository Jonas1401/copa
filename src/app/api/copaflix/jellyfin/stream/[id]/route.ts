import { NextResponse } from "next/server";
import { lerConfiguracao } from "@/lib/copaflix/fontes";
import { cabecalhoJellyfin } from "@/lib/copaflix/jellyfin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const MIMES_PERMITIDOS = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "application/octet-stream",
];

/**
 * GET /api/copaflix/jellyfin/stream/:id
 *
 * Reprodução direta (sem transcodificação) de um item do Jellyfin, com
 * suporte a Range para o usuário arrastar a barra de progresso. A chave fica
 * no servidor do CopaLinks: o player só conhece esta rota interna.
 *
 * Se o arquivo precisar de transcodificação (codec incompatível, legenda
 * embutida etc.), o Jellyfin pode recusar — a tela avisa e oferece abrir o
 * item no próprio Jellyfin.
 */
export async function GET(request: Request, { params }: Params) {
  const config = lerConfiguracao();
  if (!config.jellyfin) {
    return NextResponse.json({ erro: "Jellyfin não configurado." }, { status: 404 });
  }
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ erro: "Item inválido." }, { status: 400 });
  }

  const base = config.jellyfin.base.endsWith("/") ? config.jellyfin.base : `${config.jellyfin.base}/`;
  const destino = new URL(
    `Videos/${encodeURIComponent(id)}/stream?static=true&api_key=${encodeURIComponent(config.jellyfin.chave)}`,
    base,
  );

  const headers: Record<string, string> = { ...cabecalhoJellyfin(config.jellyfin.chave) };
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  try {
    const resposta = await fetch(destino, {
      headers,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
      redirect: "follow",
    });
    if (!resposta.ok || !resposta.body) {
      return NextResponse.json(
        { erro: `O servidor de mídia recusou a reprodução (HTTP ${resposta.status}).` },
        { status: resposta.status === 404 ? 404 : 502 },
      );
    }

    const tipo = (resposta.headers.get("content-type") ?? "video/mp4").split(";")[0].trim().toLowerCase();
    if (!MIMES_PERMITIDOS.includes(tipo)) {
      return NextResponse.json({ erro: "Formato de vídeo não suportado no app." }, { status: 415 });
    }

    const saida = new Headers({
      "Content-Type": tipo,
      "Cache-Control": "no-store, max-age=0",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });
    for (const chave of ["content-length", "content-range"] as const) {
      const valor = resposta.headers.get(chave);
      if (valor) saida.set(chave === "content-length" ? "Content-Length" : "Content-Range", valor);
    }

    return new NextResponse(resposta.body, { status: resposta.status, headers: saida });
  } catch {
    return NextResponse.json({ erro: "Servidor de mídia indisponível." }, { status: 502 });
  }
}
