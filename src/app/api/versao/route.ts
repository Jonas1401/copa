import { VERSAO_DO_APP } from "@/lib/versao-app";

/**
 * GET /api/versao → { versao } — o carimbo da publicação que está no ar.
 *
 * A tela aberta pergunta de tempos em tempos (e sempre que volta a aparecer):
 * se o carimbo for outro, ela está com o código de uma publicação antiga e se
 * recarrega num momento em que não atrapalha (`VigiaDeVersao`).
 *
 * A resposta é fixa por publicação: fica pronta na compilação e é entregue sem
 * rodar função nenhuma. O navegador nunca a guarda (`Cache-Control: no-store`
 * no `next.config.ts`, e a tela pede com `cache: "no-store"`).
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json({ versao: VERSAO_DO_APP || null });
}
