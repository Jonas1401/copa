/**
 * Códigos do monitor WhatsApp — APENAS A, B e M seguidos de 001..999.
 * Ex.: A184, "A 184", "B-022" → A184, B22. Evita A1840/placas,
 * e não usa IA para determinar quem receberá uma notificação.
 */
const EXPRESSAO = /(?:^|[^\p{L}\p{N}])([ABM])\s*[-–]?\s*(\d{1,3})(?![\p{L}\p{N}])/giu;
const EXATO = /^([ABM])\s*[-–]?\s*(\d{1,3})$/i;

export function normalizarCodigo(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const m = entrada.trim().match(EXATO);
  if (!m) return null;
  const numero = Number(m[2]);
  if (!Number.isInteger(numero) || numero < 1 || numero > 999) return null;
  return `${m[1].toUpperCase()}${numero}`;
}

export function extrairCodigos(texto: unknown, limite = 12): string[] {
  if (typeof texto !== "string" || texto.length > 1000) return [];
  const codigos = new Set<string>();
  for (const match of texto.matchAll(EXPRESSAO)) {
    const codigo = normalizarCodigo(`${match[1]}${match[2]}`);
    if (codigo) codigos.add(codigo);
    if (codigos.size >= limite) break;
  }
  return [...codigos];
}
