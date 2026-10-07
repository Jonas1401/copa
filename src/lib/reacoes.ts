/**
 * Curtidas com emoji nas mensagens do chat — parte que roda NA TELA.
 *
 * Este arquivo NÃO pode importar o banco (`@/db`) nem nada de servidor:
 * ele entra no pacote do navegador junto com o ChatMotoristas. As funções
 * que gravam/lem as curtidas estão em `@/lib/chat-reacoes` (servidor).
 */

/** Escolha rápida do seletor de reação (cabe numa linha no celular). */
export const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🔥"] as const;

export type ReacaoChat = {
  emoji: string;
  motoristaId: number;
  nome: string;
};

const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0f\u20e3]+$/u;

function contarGrafemas(texto: string) {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<unknown> } }).Segmenter;
  if (Seg) return [...new Seg("pt-BR", { granularity: "grapheme" }).segment(texto)].length;
  return Array.from(texto).length;
}

/**
 * A reação precisa ser UM emoji só (ex.: "👍", "❤️", "🚛💨" não vale — são 2).
 * Números e letras nunca contam como emoji.
 */
export function reacaoValida(emoji: string): boolean {
  const t = emoji.replace(/\s+/g, "");
  if (!t || t.length > 16) return false;
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(t) || !SO_EMOJI.test(t)) return false;
  return contarGrafemas(t) === 1;
}
