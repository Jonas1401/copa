import { fonteTemporaria } from "@/lib/banner";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string }> };

/**
 * GET → foto original por no máximo 10 min, só para o gerador de imagem
 * (Composio) baixar durante o processamento. Endereço secreto e aleatório;
 * apagado ao terminar.
 */
export async function GET(_req: Request, { params }: Params) {
  const img = await fonteTemporaria((await params).token);
  if (!img) return new Response("Não encontrada", { status: 404 });
  return new Response(new Uint8Array(img), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
