import { ErroComposio, composioConfigurado, painelSimportComposio } from "@/lib/composio";
import { resumirPainel } from "../analise";
import { leituraUtil, parsearPainelSimport } from "../painel";
import { ErroMetodo, type SaidaMetodo } from "../tipos";

/**
 * MÉTODO ADICIONAL — Composio (COMPOSIO_SEARCH_FETCH_URL_CONTENT).
 *
 * Fica por último e NUNCA é o único responsável pela leitura: a ferramenta do
 * Composio não executa JavaScript, então com o painel da APPA (montado no
 * navegador) ela costuma devolver `results` vazio. Resultado vazio, texto
 * vazio, erro ou timeout só viram uma linha do log — o orquestrador não trata
 * isso como falha do radar.
 */
export async function lerViaComposio(opcoes: { timeoutMs: number }): Promise<SaidaMetodo> {
  if (!(await composioConfigurado().catch(() => false))) {
    throw new ErroMetodo("Composio não configurado (método adicional, opcional)", "indisponivel");
  }
  let texto: string;
  try {
    texto = await painelSimportComposio(14_000, { timeoutMs: opcoes.timeoutMs });
  } catch (e) {
    const msg = e instanceof ErroComposio || e instanceof Error ? e.message : String(e);
    // "results vazio" = a página não veio (SPA sem JavaScript): é vazio, não falha de rede.
    throw new ErroMetodo(msg, /vazi|n[ãa]o devolveu/i.test(msg) ? "vazio" : "falhou");
  }
  const painel = parsearPainelSimport(texto);
  if (!painel || !leituraUtil(painel)) {
    throw new ErroMetodo(`o Composio devolveu ${texto.length} caracteres, mas sem os dados do painel`, "vazio");
  }
  return { painel, atualizadoEm: painel.atualizadoEm ?? null, resumo: resumirPainel(painel) };
}
