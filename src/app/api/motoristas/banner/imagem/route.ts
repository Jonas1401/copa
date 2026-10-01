import { garantirTabelas } from "@/lib/estado";
import { imagemBanner } from "@/lib/banner";
import { motoristaDaSessao } from "@/lib/motorista-sessao";

export const dynamic = "force-dynamic";

/**
 * GET → a imagem do topo DESTE motorista (sessão httpOnly). Cada um só
 * recebe a própria. O ?v= muda a cada troca, então pode ficar em cache.
 */
export async function GET() {
  await garantirTabelas();
  const m = await motoristaDaSessao();
  if (!m) return new Response("Não autorizado", { status: 401 });
  const img = await imagemBanner(m.id);
  if (!img) return new Response("Sem imagem personalizada", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return new Response(new Uint8Array(img), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
