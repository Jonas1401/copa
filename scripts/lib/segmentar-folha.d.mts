export type Caixa = [number, number, number, number];

export type FigurinhaManifesto = {
  slug: string;
  caixa: Caixa;
  sobreposicao?: Caixa[];
};

export const PADRAO: {
  limiarFundo: number;
  alphaMinimo: number;
  componenteMinimo: number;
  distanciaSatelite: number;
  margemSemente: number;
  raioDivisa: number;
  passosDivisa: number;
};

export function segmentarFolha(entrada: {
  dados: Uint8Array | Buffer;
  largura: number;
  altura: number;
  figurinhas: FigurinhaManifesto[];
  opcoes?: Partial<typeof PADRAO>;
}): {
  /** Índice da figurinha dona de cada pixel (-1 = fundo/ruído). */
  dono: Int32Array;
  /** Alpha depois da remoção do fundo. */
  alpha: Uint8Array;
  /** Pares de figurinhas que estavam grudadas e foram separadas. */
  separadas: string[][];
  /** Pixels devolvidos por sobreposição declarada no manifesto. */
  sobreposicoes: { slug: string; movidos: number }[];
};

export function contarPixels(
  dono: Int32Array,
  alpha: Uint8Array,
  total: number,
  alphaMinimo?: number,
): { contagem: number[]; desenho: number };
