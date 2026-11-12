import type { LinhaFila, PontoDTO } from "@/lib/estado";

/**
 * O CARD PRINCIPAL — as três faixas da fila: “Último escalado”, “Pontos no
 * quadro TRUCK” e “Pontos no quadro CAVALO/C”.
 *
 * A fila vem da aba “Fila” do Portal do Motorista (a Tela de Ativos), que é
 * lida para os livros em uso: o Livro A e o livro de cada ponto cadastrado no
 * app. Quadro sem leitura nunca entra na conta: a faixa mostra “—”, não um
 * número velho nem a soma de livros que ninguém leu.
 *
 * Com um ponto na tela, as faixas são do livro DELE — ao arrastar para um
 * ponto do Livro B ou do Livro M, os dois quadros passam a ser os desse livro.
 * Sem ponto (visitante, ou quem ainda não cadastrou), são as do primeiro livro
 * lido, na ordem A, B, M: o Livro A, como sempre foi — nunca a soma dos livros
 * que os pontos de OUTROS motoristas fizeram o app ler.
 * Só regras: nada de rede, nada de banco (roda no navegador).
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
  /**
   * Hora da leitura real dos quadros mostrados — a do livro que está na tela
   * (null = sem leitura, ou fila guardada antes de a hora vir por quadro).
   */
  lidoEm: string | null;
  /** A leitura dos quadros mostrados passou da validade: os números são os últimos lidos, não os de agora. */
  velha: boolean;
};

/** Sem ponto na tela, o cartão mostra o primeiro livro lido nesta ordem. */
const ORDEM_DOS_LIVROS: readonly LinhaFila["livro"][] = ["A", "B", "M"];

/** O portal escreve A183, B022, M069: sempre três dígitos. */
const codigoDaFila = (livro: string, numero: number) => `${livro}${String(numero).padStart(3, "0")}`;

export function cardDaFila(fila: LinhaFila[], alvo?: Pick<PontoDTO, "tipo" | "livro"> | null): CardDaFila {
  const lidas = fila.filter((l) => !l.semLeitura);
  const livroDoQuadro = alvo ? alvo.livro : ORDEM_DOS_LIVROS.find((livro) => lidas.some((l) => l.livro === livro));
  const doQuadro = lidas.filter((l) => l.livro === livroDoQuadro);
  // Cada faixa é o quadro de UM livro: o número de pontos na fila e o último escalado dele.
  const faixa = (tipo: LinhaFila["tipo"]): FaixaDoCard => {
    const linha = doQuadro.find((l) => l.tipo === tipo);
    if (!linha) return { valor: "—", sub: "sem leitura da fila" };
    return {
      valor: String(linha.naFila),
      sub: linha.ultimo ? `último escalado ${codigoDaFila(linha.livro, linha.ultimo)}` : "ponto ativo",
    };
  };
  const linhaDoAlvo = alvo ? lidas.find((l) => l.tipo === alvo.tipo && l.livro === alvo.livro) : undefined;
  // Os dois quadros de um livro são lidos juntos; se as horas diferirem, vale a mais antiga.
  const horas = doQuadro.map((l) => l.lidoEm).filter((h): h is string => Boolean(h)).sort();
  return {
    truck: faixa("TRUCK"),
    cavalo: faixa("CAVALO"),
    linhaDoAlvo,
    ultimoEscalado: linhaDoAlvo?.ultimo ? codigoDaFila(linhaDoAlvo.livro, linhaDoAlvo.ultimo) : "—",
    lidoEm: horas[0] ?? null,
    velha: doQuadro.some((l) => l.velha === true),
  };
}
