/**
 * O CARTÃO DO NÚMERO, na tela inicial — só as contas de tamanho e a regra do
 * aviso de leitura. Nada de rede, nada de banco (roda no navegador e nos testes).
 *
 * O cartão mostra, de cima para baixo: o quadro do ponto (“CAVALO/C - LIVRO A”),
 * o número com o selo do status AO LADO (ATIVO, ESCALADO, DISPENSA…), uma linha
 * fina e o saldo do motorista (“Você vai receber”). Para o selo caber sempre ao
 * lado do número, e o dinheiro caber sempre inteiro numa linha, o tamanho da
 * letra é calculado a partir da largura do texto.
 *
 * As larguras abaixo foram medidas nas fontes do app (Archivo e Space Grotesk),
 * em “em” — a unidade que acompanha o tamanho da letra.
 */

/* ------------------------------------------------------------ o número */

/** Avanço de cada caractere do número (Archivo 900), já sem o aperto de −0,04 em entre as letras. */
const AVANCO_ALGARISMO = 0.667;
const AVANCO_LETRA: Record<string, number> = { A: 0.778, B: 0.778, M: 0.972 };
/** Letra que ainda não foi medida conta como a mais larga. */
const AVANCO_LETRA_LARGA = 0.972;
const APERTO = 0.04;

/** Largura do código do ponto (“A32”, “M100”) em “em” da letra dele. */
export function larguraDoCodigoEm(codigo: string): number {
  let soma = 0;
  for (const c of codigo.toUpperCase()) soma += /\d/.test(c) ? AVANCO_ALGARISMO : (AVANCO_LETRA[c] ?? AVANCO_LETRA_LARGA);
  return Math.max(0, soma - APERTO * codigo.length);
}

/**
 * O tamanho da letra do número, em centésimos da largura da tela (vw): o código
 * de até 3 caracteres usa 18,3; o de 4 ou mais, 13,2 (as classes do número:
 * `clamp(54px,18.3vw,78px)` e `clamp(42px,13.2vw,56px)`).
 */
export const letraDoCodigoVw = (codigo: string) => (codigo.length > 3 ? 13.2 : 18.3);

/* -------------------------------------------------------------- o selo */

/** Largura da palavra do status (Archivo 700), em “em” da letra do selo. */
const PALAVRA_DO_STATUS: Record<string, number> = {
  ATIVO: 3.06,
  ESCALADO: 5.67,
  DISPENSA: 5.25,
  SAIU: 2.46,
  NA: 1.45,
  VEZ: 2.02,
  EM: 1.52,
  ATENDIMENTO: 7.48,
  AGUARDANDO: 7.44,
};
/** Palavra que ainda não foi medida: cada letra conta como uma das mais largas. */
const LETRA_DO_STATUS = 0.78;
const ESPACO_DO_STATUS = 0.24;

const palavraEm = (palavra: string) => PALAVRA_DO_STATUS[palavra] ?? palavra.length * LETRA_DO_STATUS;

/** A linha de baixo do selo é menor do que a palavra do status nesta proporção. */
export const LETRA_DA_SEGUNDA_LINHA = 0.676;

/** Largura da segunda linha (“2 na frente”, “sem leitura da fila”), em “em” da letra do SELO. */
function segundaLinhaEm(texto: string): number {
  const naFrente = /^(\d+) na frente$/.exec(texto);
  if (naFrente) return 3.16 + 0.435 * naFrente[1].length;
  if (texto === "sem leitura da fila") return 5.82;
  if (texto === "Varrendo…") return 3.51;
  return texto.length * 0.39;
}

/** O que há no selo além do texto: as duas folgas, a bolinha e o vão entre ela e o texto (em “em”). */
export const SELO = { folga: 0.82, bolinha: 0.8, vao: 0.78 } as const;
const FORA_O_TEXTO = 2 * SELO.folga + SELO.bolinha + SELO.vao;

/** A letra do selo na tela de 412 px (17 px), em vw — e o teto dela em telas largas. */
const LETRA_DO_SELO_VW = 4.15;
const LETRA_DO_SELO_MAX = 18;
const LETRA_DO_SELO_MIN = 9;
/** O que a linha do número tem de fixo, em px: margens e bordas do cartão, a folga da esquerda e uma sobra de segurança. */
const FIXO_DA_LINHA_PX = 62;
/** O vão entre o número e o selo, em vw (na tela ele para de crescer em 15 px). */
export const VAO_NUMERO_SELO_VW = 3.4;
export const VAO_NUMERO_SELO = `min(${VAO_NUMERO_SELO_VW}vw, 15px)`;

export type MedidasDoSelo = {
  /** O status como é escrito no selo: uma linha, ou uma palavra por linha quando é comprido. */
  linhas: string[];
  /** Largura do texto do selo (a linha mais comprida), em “em” da letra do selo. */
  textoEm: number;
  /** Largura do selo inteiro, em “em” da letra do selo. */
  seloEm: number;
  /** Largura do número, em vw. */
  numeroVw: number;
  /** O `font-size` do selo: o maior que cabe ao lado do número, até o tamanho do desenho. */
  letra: string;
};

/**
 * As medidas do selo para ele ficar SEMPRE ao lado do número.
 *
 * `status` com mais de uma palavra e mais de 8 letras (“EM ATENDIMENTO”) quebra
 * dentro do selo: a conta usa a palavra mais comprida. A letra nunca passa do
 * tamanho do desenho (17 px numa tela de 412 px) e encolhe o que for preciso
 * quando o número é largo (“M88”) ou a tela é estreita.
 */
export function medidasDoSelo(codigo: string, status: string, segundaLinha?: string | null): MedidasDoSelo {
  const palavras = status.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const inteiro = palavras.reduce((soma, p) => soma + palavraEm(p), 0) + ESPACO_DO_STATUS * Math.max(0, palavras.length - 1);
  const maiorPalavra = palavras.reduce((maior, p) => Math.max(maior, palavraEm(p)), 0);
  // Status curto fica numa linha só; o comprido de várias palavras quebra entre elas.
  const quebra = palavras.length > 1 && palavras.join(" ").length > 8;
  const statusEm = quebra ? maiorPalavra : inteiro;
  const textoEm = Math.max(statusEm, segundaLinha ? segundaLinhaEm(segundaLinha) : 0);
  // 2% de sobra: a largura real de uma letra muda um fio de aparelho para aparelho.
  const seloEm = (FORA_O_TEXTO + textoEm) * 1.02;
  const numeroVw = larguraDoCodigoEm(codigo) * letraDoCodigoVw(codigo);
  const sobraVw = 100 - VAO_NUMERO_SELO_VW - numeroVw;
  const arredondar = (n: number) => Math.round(n * 1000) / 1000;
  return {
    linhas: quebra ? palavras : [palavras.join(" ")],
    textoEm: arredondar(textoEm),
    seloEm: arredondar(seloEm),
    numeroVw: arredondar(numeroVw),
    letra: `clamp(${LETRA_DO_SELO_MIN}px, min(${LETRA_DO_SELO_VW}vw, calc((${arredondar(sobraVw)}vw - ${FIXO_DA_LINHA_PX}px) / ${arredondar(seloEm)})), ${LETRA_DO_SELO_MAX}px)`,
  };
}

/** A letra do selo, em px, numa tela de `largura` px — a mesma conta do CSS, para os testes. */
export function letraDoSeloPx(m: MedidasDoSelo, largura: number): number {
  const vw = largura / 100;
  const cabe = ((100 - VAO_NUMERO_SELO_VW - m.numeroVw) * vw - FIXO_DA_LINHA_PX) / m.seloEm;
  return Math.max(LETRA_DO_SELO_MIN, Math.min(LETRA_DO_SELO_VW * vw, cabe, LETRA_DO_SELO_MAX));
}

/* ------------------------------------------------------------- o saldo */

/** Largura de “R$ 1.234,56” (Archivo 900), em “em”: “R$ ” 1,57 · algarismo 0,667 · ponto ou vírgula 0,333. */
export function larguraDoSaldoEm(valor: string): number {
  if (!/^R\$\s[\d.,]+$/.test(valor)) {
    // “Falta %” (3,90 em) e “R$ —” (2,57 em) cabem em 4 em, como o “R$ 0,00” (3,90 em).
    // Texto mais comprido que não é dinheiro neste formato: cada caractere conta como largo.
    return valor.length <= 7 ? 4 : Math.round(valor.length * 0.72 * 1000) / 1000;
  }
  const algarismos = (valor.match(/\d/g) ?? []).length;
  const separadores = (valor.match(/[.,]/g) ?? []).length;
  return Math.round((1.57 + 0.667 * algarismos + 0.333 * separadores) * 1000) / 1000;
}

/** A letra do saldo na tela de 412 px (≈ 41,2 px), em vw, com piso e teto equilibrados. */
const LETRA_DO_SALDO_VW = 10;
const LETRA_DO_SALDO_MIN = 24;
const LETRA_DO_SALDO_MAX = 44;
/** Margens e bordas do cartão, o recuo do valor e a folga da direita, em px. */
const FIXO_DO_SALDO_PX = 72;

/**
 * O `font-size` do valor: o do desenho, encolhendo só o que for preciso para o
 * dinheiro caber INTEIRO numa linha (nunca cortado, nunca quebrado).
 */
export function letraDoSaldo(valor: string): string {
  return `clamp(${LETRA_DO_SALDO_MIN}px, min(${LETRA_DO_SALDO_VW}vw, calc((100vw - ${FIXO_DO_SALDO_PX}px) / ${larguraDoSaldoEm(valor)})), ${LETRA_DO_SALDO_MAX}px)`;
}

/** A letra do saldo, em px, numa tela de `largura` px — a mesma conta do CSS, para os testes. */
export function letraDoSaldoPx(valor: string, largura: number): number {
  const cabe = (largura - FIXO_DO_SALDO_PX) / larguraDoSaldoEm(valor);
  return Math.max(LETRA_DO_SALDO_MIN, Math.min((LETRA_DO_SALDO_VW * largura) / 100, cabe, LETRA_DO_SALDO_MAX));
}

/* -------------------------------------------------- a leitura do monitor */

/** Sem resposta do monitor por mais do que isto (com a tela aberta), o aparelho está sem conexão. */
export const SEM_RESPOSTA_MS = 60_000;

/**
 * A leitura do monitor está em dia? Com tudo em dia a tela inicial não mostra
 * nada sobre a leitura (o cartão fica só com o número e o saldo). O aviso
 * “Atualizado há… · OFFLINE” aparece quando:
 *   • o monitor ainda não tem a 1ª leitura da fila;
 *   • o servidor não conseguiu ler a fila, ou a leitura dele ficou velha (OFFLINE);
 *   • este aparelho está há mais de 1 minuto sem resposta do monitor (sem
 *     conexão): o que está na tela parou no tempo.
 */
export function monitorEmDia(estado: { temLeitura?: boolean; online: boolean }, msSemResposta: number): boolean {
  return estado.temLeitura !== false && estado.online && msSemResposta <= SEM_RESPOSTA_MS;
}
