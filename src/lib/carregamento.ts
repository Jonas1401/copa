/**
 * Tela de carregamento com a logo (src/components/inicio/CarregamentoLogo.tsx).
 * Funções puras: fáceis de testar e sem depender do navegador.
 */

/** Fica pelo menos isto na tela, para não "piscar" em internet rápida. */
export const TEMPO_MINIMO_MS = 900;
/** Nunca prende o app: some depois disto mesmo que algo não responda. */
export const TEMPO_MAXIMO_MS = 10_000;
/** Duração da saída (caminhão chega ao fim + esmaece). */
export const TEMPO_SAIDA_MS = 550;

/** Frases que vão trocando enquanto carrega. */
export const FRASES = [
  "Ligando o motor…",
  "Conectando ao porto…",
  "Lendo o quadro da Copadubo…",
  "Conferindo os seus pontos…",
] as const;

/**
 * Progresso mostrado na estrada (0 a 1). Enquanto carrega, anda rápido no
 * começo e vai desacelerando sem nunca passar de 92%; quando o app fica
 * pronto, vai a 100%.
 */
export function progressoCarregamento(decorridoMs: number, pronto: boolean): number {
  if (pronto) return 1;
  const t = Math.max(0, Number.isFinite(decorridoMs) ? decorridoMs : 0);
  return 0.92 * (1 - Math.exp(-t / 2200));
}

/** Hora de sair: pronto e já passou o mínimo, ou estourou o máximo. */
export function deveSair(decorridoMs: number, pronto: boolean): boolean {
  return (pronto && decorridoMs >= TEMPO_MINIMO_MS) || decorridoMs >= TEMPO_MAXIMO_MS;
}

/** Frase da vez (troca a cada 1,3 s; no fim mostra "Pronto!"). */
export function fraseDaVez(decorridoMs: number, pronto: boolean): string {
  if (pronto) return "Pronto!";
  const i = Math.floor(Math.max(0, decorridoMs) / 1300) % FRASES.length;
  return FRASES[i];
}
