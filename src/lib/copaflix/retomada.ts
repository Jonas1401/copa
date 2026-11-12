/**
 * Regra de retomada ("continuar de onde parou").
 *
 * Fica em um arquivo próprio porque é fácil de errar: se a conta considerar só
 * "faltam X segundos", um curta de 20 s ou um episódio de 2 min nunca retoma —
 * o vídeo recomeça do zero e o progresso salvo é sobrescrito.
 *
 * Regras:
 *  - posição precisa passar de 5 s (senão o usuário nem começou);
 *  - tem que faltar mais que 10 s OU mais que 10% do vídeo, o que for menor;
 *  - sem duração conhecida (ao vivo, fluxo sem metadados) não há retomada.
 */
export const MINIMO_PARA_RETOMAR_SEGUNDOS = 5;

export function deveRetomar(posicao: number, duracao: number): boolean {
  if (!Number.isFinite(posicao) || posicao <= MINIMO_PARA_RETOMAR_SEGUNDOS) return false;
  if (!Number.isFinite(duracao) || duracao <= 0) return false;
  const restante = duracao - posicao;
  return restante > Math.min(10, duracao * 0.1);
}
