/**
 * Vinheta de abertura do CopaLinks (src/components/inicio/VinhetaAbertura.tsx).
 *
 * Este arquivo não chegou ao GitHub junto com a vinheta; foi restaurado com os
 * MESMOS valores da versão que estava no ar em copa-links.vercel.app:
 *  - a vinheta dura 5 s;
 *  - na abertura normal, acelera conforme o app termina de carregar;
 *  - leva 0,6 s para sumir no fim;
 *  - na primeira vez, roda completa (a chave abaixo marca que já foi vista).
 */

/** Duração da vinheta completa. */
export const DURACAO_VINHETA_MS = 5_000;
/** Tempo mínimo total antes de encerrar quando o app já está pronto. */
export const DURACAO_MINIMA_MS = 5_000;
/** Tempo do esmaecimento final (e menor intervalo para terminar). */
export const DURACAO_ENCERRAMENTO_MS = 600;

const CHAVE_VISTA = "copalinks-vinheta-vista";

function limitar(v: number, min: number, max: number) {
  return !Number.isFinite(v) || v < min ? min : v > max ? max : v;
}

/** Quanto do carregamento já foi (0 a 1). Sem sinal de pronto, sobe até 85% em 12 s. */
export function progressoDoCarregamento({ pronto, decorridoMs }: { pronto: boolean; decorridoMs: number }) {
  return pronto ? 1 : Math.min(0.85, Math.max(0, decorridoMs) / 12_000);
}

/** Velocidade da animação enquanto carrega: de 1x até 3,2x conforme o progresso. */
export function calcularVelocidade(carga: number) {
  return 1 + 2.2 * limitar(carga, 0, 1);
}

/** A vinheta completa já foi vista neste aparelho? */
export function lerVinhetaVista(): boolean {
  try {
    if (!window.localStorage) return false;
    return window.localStorage.getItem(CHAVE_VISTA) === "1";
  } catch {
    return false;
  }
}

export function marcarVinhetaVista() {
  try {
    if (!window.localStorage) return;
    window.localStorage.setItem(CHAVE_VISTA, "1");
  } catch {
    /* navegador sem armazenamento: mostra de novo na próxima vez */
  }
}
