/**
 * Lista de fontes de um título/episódio e a escolha da próxima quando uma
 * falha.
 *
 * Fica separado do componente para poder ser testado sem navegador: o player
 * usa exatamente estas funções, então o comportamento de "tentar o espelho" é
 * verificável de verdade, e não só por leitura de código.
 */
import type { FonteMidia } from "./tipos";

/** Chave estável de uma fonte (tipo + endereço + item do Jellyfin). */
export function chaveDaFonte(fonte: FonteMidia | null | undefined): string {
  if (!fonte) return "vazio";
  return `${fonte.tipo}|${fonte.url ?? ""}|${fonte.itemId ?? ""}`;
}

/**
 * Junta a fonte principal com os espelhos, na ordem, sem repetir endereço.
 * Aceita lista vazia: aí o player mostra "nenhuma fonte autorizada".
 */
export function montarListaDeFontes(
  principal: FonteMidia | null | undefined,
  alternativas: FonteMidia[] = [],
): FonteMidia[] {
  return [principal, ...alternativas]
    .filter((fonte): fonte is FonteMidia => Boolean(fonte))
    .filter(
      (fonte, indice, lista) =>
        lista.findIndex((outra) => chaveDaFonte(outra) === chaveDaFonte(fonte)) === indice,
    );
}

/**
 * Próximo espelho depois de `indiceAtual`, com os rótulos para a mensagem
 * ("Internet Archive", "Mux (HLS)"...). `null` quando já tentou todas.
 */
export function proximaFonte(
  fontes: FonteMidia[],
  indiceAtual: number,
): { indice: number; de: FonteMidia; para: FonteMidia } | null {
  const proximo = indiceAtual + 1;
  if (proximo < 0 || proximo >= fontes.length) return null;
  const de = fontes[Math.max(indiceAtual, 0)];
  const para = fontes[proximo];
  if (!de || !para) return null;
  return { indice: proximo, de, para };
}

/** Nome legível da fonte para a tela. */
export function rotuloDaFonte(fonte: FonteMidia | null | undefined, padrao = "fonte"): string {
  if (!fonte) return padrao;
  return fonte.rotulo ?? fonte.provedor ?? padrao;
}
