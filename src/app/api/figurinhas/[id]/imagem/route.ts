import { NextResponse } from "next/server";
import { garantirTabelas } from "@/lib/estado";
import { obterFigurinhaComImagem } from "@/lib/figurinhas-admin";
import { MIME_FIGURINHA } from "@/lib/figurinhas-catalogo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/figurinhas/:id/imagem → a imagem (PNG, WebP ou GIF) da figurinha.
 * Endereço estável: os bytes de cada id nunca mudam, então o cache é longo —
 * leve no polling e no Android. Mensagens antigas não dependem disto (a
 * mensagem guarda a própria cópia), mas o seletor e prévias usam esta rota.
 */
export async function GET(_req: Request, { params }: Params) {
  await garantirTabelas();
  const { id: valorId } = await params;
  const id = Number(valorId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ erro: "Figurinha não encontrada." }, { status: 404 });
  }
  const figurinha = await obterFigurinhaComImagem(id);
  if (!figurinha?.dados || !MIME_FIGURINHA[figurinha.mime]) {
    return NextResponse.json({ erro: "Figurinha não encontrada." }, { status: 404 });
  }
  const bytes = Buffer.from(figurinha.dados, "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": figurinha.mime,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
