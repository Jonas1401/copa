/**
 * Preferência do olho de ocultar os valores de ganhos na tela inicial.
 *
 * Quando o motorista ativa o ícone de olho para esconder os ganhos, a escolha
 * fica salva no aparelho (localStorage): mesmo se fechar o aplicativo e abrir
 * de novo, os valores continuam ocultos e só voltam a aparecer quando ele
 * tocar novamente no ícone do olho.
 */

export const CHAVE_GANHOS_OCULTOS = "copalinks-ganhos-ocultos";

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function armazenamentoPadrao(): Armazenamento | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Lê se o ícone de olho foi deixado ativo neste aparelho. */
export function lerGanhosOcultos(storage: Armazenamento | null = armazenamentoPadrao()): boolean {
  if (!storage) return false;
  try {
    const salvo = storage.getItem(CHAVE_GANHOS_OCULTOS);
    return salvo === "1" || salvo === "true";
  } catch {
    return false;
  }
}

/** Guarda (ou limpa) no aparelho o estado do ícone de olho. */
export function salvarGanhosOcultos(
  ocultos: boolean,
  storage: Armazenamento | null = armazenamentoPadrao(),
): boolean {
  if (!storage) return ocultos;
  try {
    if (ocultos) storage.setItem(CHAVE_GANHOS_OCULTOS, "1");
    else storage.removeItem(CHAVE_GANHOS_OCULTOS);
  } catch {
    /* navegador sem armazenamento: vale só enquanto a tela estiver aberta */
  }
  return ocultos;
}
