import type { LinhaFila, PontoDTO } from "@/lib/estado";

/**
 * O CARD PRINCIPAL — as três faixas da fila: “Último escalado”, “Pontos no
 * quadro TRUCK” e “Pontos no quadro CAVALO/C”.
 *
 * A fila vem da aba “Fila” do Portal do Motorista (a Tela de Ativos), que só é
 * lida para os livros configurados (o padrão é o Livro A). Quadro sem leitura
 * nunca entra na conta: a faixa mostra “—”, não um número velho nem a soma de
 * livros que ninguém leu.
 *
 * Com um ponto na tela, as faixas são do livro dele; sem ponto, de todos os
 * livros lidos. Só regras: nada de rede, nada de banco (roda no navegador).
 */

export type FaixaDoCard = {
  /** Quantos pontos estão na fila (“—” quando o quadro não tem leitura). */
  valor: string;
  /** Linha de baixo: o último ponto escalado do quadro, como a tela do portal mostra. */
  sub: string;
};

export type CardDaFila = {
  truck: FaixaDoCard;
  cavalo: FaixaDoCard;
  /** O quadro do ponto mostrado (tipo e livro dele), quando tem leitura. */
  linhaDoAlvo: LinhaFila | undefined;
  /** Último escalado do quadro do ponto mostrado (“A025”), ou “—”. */
  ultimoEscalado: string;
};

/** O portal escreve A183, B022, M069: sempre três dígitos. */
const codigoDaFila = (livro: string, numero: number) => `${livro}${String(numero).padStart(3, "0")}`;

export function cardDaFila(fila: LinhaFila[], alvo?: Pick<PontoDTO, "tipo" | "livro"> | null): CardDaFila {
  const lidas = fila.filter((l) => !l.semLeitura);
  const doQuadro = alvo ? lidas.filter((l) => l.livro === alvo.livro) : lidas;
  const faixa = (tipo: LinhaFila["tipo"]): FaixaDoCard => {
    const linhas = doQuadro.filter((l) => l.tipo === tipo);
    if (!linhas.length) return { valor: "—", sub: "sem leitura da fila" };
    return {
      valor: String(linhas.reduce((soma, l) => soma + l.naFila, 0)),
      // O último escalado só faz sentido quando a faixa é de um livro só.
      sub: linhas.length === 1 && linhas[0].ultimo ? `último escalado ${codigoDaFila(linhas[0].livro, linhas[0].ultimo)}` : "ponto ativo",
    };
  };
  const linhaDoAlvo = alvo ? lidas.find((l) => l.tipo === alvo.tipo && l.livro === alvo.livro) : undefined;
  return {
    truck: faixa("TRUCK"),
    cavalo: faixa("CAVALO"),
    linhaDoAlvo,
    ultimoEscalado: linhaDoAlvo?.ultimo ? codigoDaFila(linhaDoAlvo.livro, linhaDoAlvo.ultimo) : "—",
  };
}
