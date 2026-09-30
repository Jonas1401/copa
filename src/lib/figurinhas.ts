/**
 * Emojis e figurinhas do chat dos motoristas.
 *
 * Figurinha = mensagem de texto comum no formato "<emoji> <frase>" que está
 * nesta lista: o chat desenha em tamanho grande e o Push mostra o mesmo texto.
 * Não há upload de imagem (nada novo no banco). Para criar uma figurinha,
 * basta acrescentar um item em FIGURINHAS.
 */

export type Figurinha = { emoji: string; texto: string };

export const FIGURINHAS: Figurinha[] = [
  { emoji: "☕", texto: "Bom dia, motoristas!" },
  { emoji: "🌙", texto: "Boa noite, pessoal!" },
  { emoji: "🚛💨", texto: "Saindo pro trabalho!" },
  { emoji: "🎉", texto: "Carregado!" },
  { emoji: "⏳", texto: "Fila parada" },
  { emoji: "🏁", texto: "Fila andando rápido!" },
  { emoji: "⚖️", texto: "Na balança" },
  { emoji: "🅿️", texto: "Cheguei no pátio" },
  { emoji: "🌧️", texto: "Chuva no porto" },
  { emoji: "⚠️", texto: "Atenção na estrada" },
  { emoji: "🔧", texto: "Caminhão quebrou, alguém ajuda?" },
  { emoji: "🍽️", texto: "Parada pro almoço" },
  { emoji: "👍", texto: "Valeu, obrigado!" },
  { emoji: "🤝", texto: "Tamo junto!" },
  { emoji: "🙏", texto: "Deus abençoe a viagem" },
  { emoji: "😂", texto: "Kkkkkk" },
];

export const EMOJIS: string[] = [
  "😀", "😂", "🤣", "😅", "😊", "😍", "😎", "🤔", "😴", "😤", "😡", "😭",
  "👍", "👎", "👏", "🙏", "🤝", "💪", "👋", "🙌", "✅", "❌", "⚠️", "🔥",
  "🚛", "🚚", "🚗", "⛽", "🛣️", "🚧", "⚓", "🚢", "🏗️", "⚖️", "🔧", "🛞",
  "☕", "🍽️", "🌧️", "⛈️", "☀️", "🌙", "💨", "🎉", "📍", "⏰", "📢", "❤️",
];

export const textoDaFigurinha = (f: Figurinha) => `${f.emoji} ${f.texto}`;

const PORTEXTO = new Map(FIGURINHAS.map((f) => [textoDaFigurinha(f), f]));

/** A mensagem é exatamente uma figurinha da lista? */
export function figurinhaDe(texto: string): Figurinha | null {
  return PORTEXTO.get(texto.trim()) ?? null;
}

const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0f\u20e3\s]+$/u;

function contarGrafemas(texto: string) {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<unknown> } }).Segmenter;
  if (Seg) return [...new Seg("pt-BR", { granularity: "grapheme" }).segment(texto)].length;
  return Array.from(texto).length;
}

/**
 * Mensagem só com 1 a 3 emojis (ex.: "👍", "😂😂", "🚛💨"): o chat mostra grande,
 * como figurinha. Números e letras nunca contam como emoji.
 */
export function soEmojis(texto: string): boolean {
  const t = texto.replace(/\s+/g, "");
  // Bandeiras (🇧🇷) são pares de Regional_Indicator, não Extended_Pictographic.
  if (!t || !/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(t) || !SO_EMOJI.test(t)) return false;
  return contarGrafemas(t) <= 3;
}
