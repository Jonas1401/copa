/**
 * Memória local do CopaFlix (favoritos, histórico e "continuar assistindo").
 *
 * Fica SÓ no aparelho do usuário (localStorage), no mesmo espírito do chat e
 * do perfil do CopaLinks: nada é enviado ao servidor, nada entra no banco e
 * nada aparece para outro motorista. Se o navegador bloquear o armazenamento
 * (modo privado), as funções simplesmente devolvem listas vazias.
 */
import type { TipoTitulo } from "./tipos";

export const CHAVES = {
  favoritos: "copaflix:favoritos:v1",
  progresso: "copaflix:progresso:v1",
  historico: "copaflix:historico:v1",
} as const;

/** Evento disparado após qualquer mudança (a tela escuta para se atualizar). */
export const EVENTO_ALTERADO = "copaflix:alterado";

export type Favorito = {
  id: string;
  titulo: string;
  tipo: TipoTitulo;
  capa?: string;
  arte?: number;
  em: number;
};

export type Progresso = {
  id: string;
  titulo: string;
  tipo: TipoTitulo;
  capa?: string;
  arte?: number;
  /** Segundos assistidos. */
  posicao: number;
  /** Duração em segundos (0 quando o player ainda não sabe). */
  duracao: number;
  atualizadoEm: number;
  episodioId?: string;
  episodioTitulo?: string;
  temporada?: number;
  numero?: number;
};

export type ItemHistorico = {
  id: string;
  titulo: string;
  tipo: TipoTitulo;
  em: number;
};

/** Só o necessário do Storage — testável sem navegador. */
export type Armazem = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAXIMO_HISTORICO = 60;
const MAXIMO_PROGRESSO = 40;

function lerJson<T>(armazem: Armazem | null, chave: string, padrao: T): T {
  if (!armazem) return padrao;
  try {
    const bruto = armazem.getItem(chave);
    if (!bruto) return padrao;
    return JSON.parse(bruto) as T;
  } catch {
    return padrao;
  }
}

function gravar(armazem: Armazem | null, chave: string, valor: unknown) {
  if (!armazem) return false;
  try {
    armazem.setItem(chave, JSON.stringify(valor));
    return true;
  } catch {
    // Cota cheia / modo privado: o app continua funcionando sem histórico.
    return false;
  }
}

/* -------------------------------------------------------------- favoritos */

export function lerFavoritos(armazem: Armazem | null): Favorito[] {
  const lista = lerJson<unknown>(armazem, CHAVES.favoritos, []);
  if (!Array.isArray(lista)) return [];
  return lista.filter(
    (item): item is Favorito =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as Favorito).id === "string" &&
      typeof (item as Favorito).titulo === "string",
  );
}

export function ehFavorito(armazem: Armazem | null, id: string) {
  return lerFavoritos(armazem).some((f) => f.id === id);
}

/** Adiciona ou remove. Devolve a lista nova (e grava no aparelho). */
export function alternarFavorito(
  armazem: Armazem | null,
  favorito: Omit<Favorito, "em">,
): Favorito[] {
  const atual = lerFavoritos(armazem);
  const existe = atual.some((f) => f.id === favorito.id);
  const nova = existe
    ? atual.filter((f) => f.id !== favorito.id)
    : [{ ...favorito, em: Date.now() }, ...atual];
  gravar(armazem, CHAVES.favoritos, nova);
  return nova;
}

/* ------------------------------------------------------- progresso/histórico */

export function lerProgresso(armazem: Armazem | null): Progresso[] {
  const lista = lerJson<unknown>(armazem, CHAVES.progresso, []);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter(
      (item): item is Progresso =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as Progresso).id === "string" &&
        Number.isFinite((item as Progresso).posicao),
    )
    .sort((a, b) => b.atualizadoEm - a.atualizadoEm);
}

const PERCENTUAL_MINIMO = 0.02;
const PERCENTUAL_FINAL = 0.95;

/**
 * Só entra em "Continuar assistindo" o que começou e ainda não terminou.
 * Sem a duração (transmissão ao vivo), não há como retomar: fica de fora.
 */
export function continuaAssistindo(entrada: Progresso): boolean {
  if (!entrada.duracao || entrada.duracao <= 0) return false;
  const fracao = entrada.posicao / entrada.duracao;
  return entrada.posicao >= 3 && fracao >= PERCENTUAL_MINIMO && fracao < PERCENTUAL_FINAL;
}

export function salvarProgresso(
  armazem: Armazem | null,
  entrada: Omit<Progresso, "atualizadoEm"> & { atualizadoEm?: number },
): Progresso[] {
  const atual = lerProgresso(armazem).filter((p) => p.id !== entrada.id);
  const nova = [
    { ...entrada, atualizadoEm: entrada.atualizadoEm ?? Date.now() },
    ...atual,
  ].slice(0, MAXIMO_PROGRESSO);
  gravar(armazem, CHAVES.progresso, nova);
  return nova;
}

export function progressoDe(armazem: Armazem | null, id: string): Progresso | null {
  return lerProgresso(armazem).find((p) => p.id === id) ?? null;
}

export function removerProgresso(armazem: Armazem | null, id: string): Progresso[] {
  const nova = lerProgresso(armazem).filter((p) => p.id !== id);
  gravar(armazem, CHAVES.progresso, nova);
  return nova;
}

export function continuarAssistindoDe(armazem: Armazem | null): Progresso[] {
  return lerProgresso(armazem).filter(continuaAssistindo);
}

/* ------------------------------------------------------------------ histórico */

export function lerHistorico(armazem: Armazem | null): ItemHistorico[] {
  const lista = lerJson<unknown>(armazem, CHAVES.historico, []);
  if (!Array.isArray(lista)) return [];
  return lista.filter(
    (item): item is ItemHistorico =>
      Boolean(item) && typeof item === "object" && typeof (item as ItemHistorico).id === "string",
  );
}

export function registrarHistorico(
  armazem: Armazem | null,
  item: Omit<ItemHistorico, "em">,
): ItemHistorico[] {
  const atual = lerHistorico(armazem).filter((h) => h.id !== item.id);
  const nova = [{ ...item, em: Date.now() }, ...atual].slice(0, MAXIMO_HISTORICO);
  gravar(armazem, CHAVES.historico, nova);
  return nova;
}

export function limparHistorico(armazem: Armazem | null) {
  gravar(armazem, CHAVES.historico, []);
}

export function limparProgresso(armazem: Armazem | null) {
  gravar(armazem, CHAVES.progresso, []);
}

/** Apaga tudo o que o CopaFlix guardou neste aparelho. */
export function limparTudo(armazem: Armazem | null) {
  if (!armazem) return;
  for (const chave of Object.values(CHAVES)) {
    try {
      armazem.removeItem(chave);
    } catch {
      /* ignora */
    }
  }
}

/* ---------------------------------------------------------- acesso no navegador */

/** localStorage do aparelho, ou null no servidor / quando bloqueado. */
export function armazenamentoDoAparelho(): Armazem | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Avisa a tela (e outras abas) que favoritos/progresso mudaram. */
export function avisarMudanca() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(EVENTO_ALTERADO));
  } catch {
    /* ignora */
  }
}
