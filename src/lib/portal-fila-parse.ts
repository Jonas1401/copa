import { decodificarEntidades, enderecoDeAcao, limparHtml } from "@/lib/portal-copadubo-parse";

/**
 * ABA “FILA” DO PORTAL DO MOTORISTA — a “Tela de Ativos”.
 *
 * O quadro público (intranet.copadubo.com.br/ponto) foi desligado: a página
 * agora diz “A tela de ativos mudou de endereço … fica no Portal Copadubo”.
 * A fila passou a ser esta tela, que só abre com a sessão de um motorista:
 *
 *   Tela de Ativos
 *   [Livro A] [Livro B] [Livro M]
 *   Seu ponto (A000) não está na fila deste livro no momento.
 *   Livro A - Truck
 *   ÚLTIMO PONTO ESCALADO
 *   A196
 *   SEQ   PONTO   TIPO
 *   1     A199    TRUCK BA 2E
 *   2     A009    TRUCK 4 EIXOS
 *   Total: 2
 *   Livro A - Carreta
 *   …
 *
 * Aqui só há interpretação de texto: nada de rede e nada de banco.
 *
 * A fila decide a posição de cada ponto e os avisos de “perto da vez” e “na
 * vez”, então a leitura é RÍGIDA: um quadro só vale se a sequência vai de 1 a
 * N sem pular, todos os pontos são do livro do quadro, nenhum se repete, o
 * “Total” da tela bate com as linhas e não sobra, dentro do quadro, nenhum
 * código de ponto que não tenha entrado em tabela nenhuma (tabela que esta
 * leitura não entendeu nunca vira “fila vazia”). Página cortada, quadro pela metade ou
 * tela diferente do esperado: o quadro é recusado e quem chama fica sem
 * leitura (e sabe o motivo).
 *
 * Um quadro que não aparece na tela — com a página inteira, o outro quadro do
 * livro lido e nenhum ponto escrito fora das tabelas — é uma fila vazia (o
 * portal não desenha o cartão de uma fila sem pontos). Quem guarda a fila
 * ainda confere se isso faz sentido (ver `motivoDaFilaSumida`).
 *
 * O HTML de verdade nunca foi visto (só a tela). Por isso a tabela é aceita em
 * três formas: células de tabela (“1 · A199 · TRUCK BA 2E”), tudo numa linha
 * (“1 A199 TRUCK BA 2E”) e uma célula por linha (“1” / “A199” / “TRUCK BA 2E”).
 */

export type LivroDaFila = "A" | "B" | "M";
export type TipoDaFila = "TRUCK" | "CAVALO";

export const LIVROS_DA_FILA: readonly LivroDaFila[] = ["A", "B", "M"];

export type QuadroDaFila = {
  livro: LivroDaFila;
  tipo: TipoDaFila;
  /** Título como o portal escreve (“Livro A - Truck”). */
  titulo: string;
  /** Número do último ponto escalado (0 = a tela não mostrou nenhum). */
  ultimo: number;
  /** A fila na ordem do portal: o primeiro é o SEQ 1. */
  codigos: number[];
  /** O que a tela escreve em “Total: N” (null = não trouxe). */
  total: number | null;
  /** O cartão deste quadro não apareceu na tela: fila vazia (ver `quadrosDoLivro`). */
  ausente?: true;
};

export type FilaDoPortal = {
  /** Quadros completos e coerentes. */
  quadros: QuadroDaFila[];
  /** Quadros achados na página e recusados, com o motivo. */
  recusados: { titulo: string; motivo: string }[];
  /** A página chegou até o fim (`</body>` ou `</html>`). */
  completa: boolean;
  /**
   * Códigos de ponto escritos fora dos quadros e que não são linha de tabela
   * nenhuma (sem contar o aviso “Seu ponto (…)”, que é da conta de quem abriu
   * a tela): pode ser um quadro que esta leitura não reconheceu.
   */
  foraDosQuadros: string[];
};

const RE_QUADRO = /^livro\s+([ABM])\s*[-–—·:|]?\s*(trucks?|carretas?|cavalos?)\b/i;
const RE_ULTIMO = /[úu]ltimo\s+(?:ponto\s+)?escalado\s*:?\s*(.*)$/i;
const RE_CODIGO_NO_COMECO = /^([ABM])\s?-?(\d{1,3})\b/i;
const RE_TOTAL = /^total\b[^0-9]{0,20}(\d{1,4})?\s*(?:pontos?)?$/i;
// Linha da tabela: o SEQ (“1”, “1º”, “1.”, “#1”), o ponto e o que vier depois
// (o tipo, um selo “seu ponto”…). Quem garante que nada ficou de fora é a
// conferência da sequência e do Total.
const RE_LINHA_DE_TABELA = /^#?\s*(\d{1,3})\s*[ºª°.)]?\s*·\s*([ABM])\s?-?(\d{1,3})\b.*$/i;
const RE_LINHA_SOLTA = /^#?\s*(\d{1,3})\s*[ºª°.)]?\s+([ABM])\s?-?(\d{1,3})\b.*$/i;
const RE_SEQ_SOZINHO = /^#?\s*(\d{1,3})\s*[ºª°.)]?$/;
const RE_SO_NUMERO = /^\d{1,4}$/;
/** Código de ponto como o portal escreve (A009, B022, M107), em qualquer lugar da linha. */
const RE_CODIGOS_NA_LINHA = /\b[ABM]-?\d{3}\b/g;
/** “Seu ponto (A000) não está na fila deste livro no momento.” — é da conta de quem abriu a tela. */
const RE_AVISO_DA_CONTA = /\bseu\s+ponto\b/i;

/**
 * O texto da tela, linha a linha. Blocos (`div`, `p`, `tr`, títulos…) quebram
 * linha; as células de uma tabela ficam na mesma linha, separadas por “ · ”.
 * Sem limite de linhas: uma fila tem o tamanho que tiver.
 */
export function linhasDaTela(html: string): string[] {
  const corpo = limparHtml(html).replace(/<select\b[\s\S]*?<\/select>/gi, " ");
  const marcado = corpo
    .replace(/<\/t[dh]\s*>/gi, " · ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/?(?:p|div|li|tr|table|thead|tbody|tfoot|section|article|header|footer|nav|main|aside|dd|dt|label|h[1-6]|caption|legend|ul|ol|dl|form|button)\b[^>]*>/gi,
      "\n",
    );
  return decodificarEntidades(marcado.replace(/<[^>]*>/g, " "))
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(?:·\s*)+/, "")
        .replace(/(?:\s*·)+$/, "")
        .trim(),
    )
    .filter(Boolean);
}

type QuadroAberto = {
  livro: LivroDaFila;
  tipo: TipoDaFila;
  titulo: string;
  ultimo: number;
  /** Livro escrito no código do último escalado (tem de ser o do quadro). */
  livroDoUltimo: string | null;
  linhas: { seq: number; livro: string; numero: number }[];
  total: number | null;
  /** O “Total” já passou: o que vem depois (rodapé, menus) não é mais deste quadro. */
  fechado: boolean;
  /** Códigos de ponto escritos dentro do quadro que não são linha da tabela. */
  soltos: string[];
};

/** Por que o quadro não serve (null = serve). */
function motivoDaRecusa(q: QuadroAberto, paginaCompleta: boolean): string | null {
  if (q.livroDoUltimo && q.livroDoUltimo !== q.livro) {
    return `o último escalado (${q.livroDoUltimo}${String(q.ultimo).padStart(3, "0")}) é de outro livro`;
  }
  const deOutroLivro = q.linhas.find((l) => l.livro !== q.livro);
  if (deOutroLivro) {
    return `a fila traz um ponto de outro livro (${deOutroLivro.livro}${String(deOutroLivro.numero).padStart(3, "0")})`;
  }
  // Sobrou ponto escrito no quadro que não entrou na tabela: a tela tem linhas
  // em um formato que esta leitura não entendeu. Nunca vira fila mais curta.
  if (q.soltos.length) {
    const lista = [...new Set(q.soltos)];
    return `a tela mostra ${lista.length === 1 ? "um ponto" : `${lista.length} pontos`} fora da tabela (${lista.slice(0, 3).join(", ")}${lista.length > 3 ? "…" : ""}): não reconheci todas as linhas`;
  }
  for (let i = 0; i < q.linhas.length; i += 1) {
    const { seq, numero } = q.linhas[i];
    if (seq !== i + 1) {
      return i === 0 ? `a sequência começa em ${seq}, não em 1` : `a sequência pula de ${q.linhas[i - 1].seq} para ${seq}`;
    }
    if (numero < 1 || numero > 999) return `ponto com número fora do esperado (${numero})`;
  }
  if (new Set(q.linhas.map((l) => l.numero)).size !== q.linhas.length) return "o mesmo ponto aparece duas vezes na fila";
  if (q.total !== null && q.total !== q.linhas.length) {
    return `a tela diz Total: ${q.total}, mas trouxe ${q.linhas.length} linha(s)`;
  }
  // Sem o “Total” para conferir, só vale a página que chegou até o fim.
  if (q.total === null && !paginaCompleta) return "a página veio cortada (sem o Total e sem o fim da página)";
  return null;
}

/**
 * Lê os quadros da “Tela de Ativos”. Um quadro por livro e tipo: “Livro A -
 * Truck”, “Livro A - Carreta”. O que não passa na conferência vai para
 * `recusados` — nunca vira uma fila vazia.
 */
export function interpretarFilaDoPortal(html: string): FilaDoPortal {
  const linhas = linhasDaTela(html);
  const paginaCompleta = /<\/body\s*>|<\/html\s*>/i.test(html);
  const abertos: QuadroAberto[] = [];
  let atual: QuadroAberto | null = null;
  let esperaUltimo = false;
  let esperaTotal = false;
  const foraDosQuadros: string[] = [];
  const daConta = new Set<string>();
  const codigosDe = (linha: string) => (linha.match(RE_CODIGOS_NA_LINHA) ?? []).map((c) => c.replace("-", ""));
  /** Linha que não é título, último escalado, total nem linha de tabela: tem ponto escrito nela? */
  const sobra = (linha: string) => {
    const achados = codigosDe(linha);
    if (!achados.length) return;
    if (RE_AVISO_DA_CONTA.test(linha)) {
      for (const c of achados) daConta.add(c);
      return;
    }
    if (atual && !atual.fechado) atual.soltos.push(...achados);
    else foraDosQuadros.push(...achados);
  };

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];
    const quadro = RE_QUADRO.exec(linha);
    if (quadro) {
      const livro = quadro[1].toUpperCase() as LivroDaFila;
      const tipo: TipoDaFila = /^truck/i.test(quadro[2]) ? "TRUCK" : "CAVALO";
      atual = {
        livro,
        tipo,
        titulo: `Livro ${livro} - ${tipo === "TRUCK" ? "Truck" : "Carreta"}`,
        ultimo: 0,
        livroDoUltimo: null,
        linhas: [],
        total: null,
        fechado: false,
        soltos: [],
      };
      abertos.push(atual);
      esperaUltimo = false;
      esperaTotal = false;
      continue;
    }
    if (!atual) {
      sobra(linha);
      continue;
    }

    if (esperaUltimo) {
      esperaUltimo = false;
      const codigo = RE_CODIGO_NO_COMECO.exec(linha);
      if (codigo) {
        atual.livroDoUltimo = codigo[1].toUpperCase();
        atual.ultimo = Number(codigo[2]);
        continue;
      }
    }
    if (esperaTotal) {
      esperaTotal = false;
      if (RE_SO_NUMERO.test(linha)) {
        atual.total = Number(linha);
        atual.fechado = true;
        continue;
      }
    }

    const ultimo = RE_ULTIMO.exec(linha);
    if (ultimo) {
      // “ÚLTIMO PONTO ESCALADO A196”, “…: A196” ou, em célula de tabela, “… · A196”.
      const codigo = RE_CODIGO_NO_COMECO.exec(ultimo[1].replace(/^[\s·:\-–]+/, ""));
      if (codigo) {
        atual.livroDoUltimo = codigo[1].toUpperCase();
        atual.ultimo = Number(codigo[2]);
      } else {
        esperaUltimo = true;
      }
      continue;
    }

    const total = RE_TOTAL.exec(linha);
    if (total) {
      if (total[1] !== undefined) {
        atual.total = Number(total[1]);
        atual.fechado = true;
      } else {
        esperaTotal = true;
      }
      continue;
    }

    const daTabela = RE_LINHA_DE_TABELA.exec(linha) ?? RE_LINHA_SOLTA.exec(linha);
    if (daTabela) {
      atual.linhas.push({ seq: Number(daTabela[1]), livro: daTabela[2].toUpperCase(), numero: Number(daTabela[3]) });
      continue;
    }

    // Uma célula por linha: “1” / “A199” / “TRUCK BA 2E”.
    const seq = RE_SEQ_SOZINHO.exec(linha);
    if (seq && i + 1 < linhas.length) {
      const codigo = RE_CODIGO_NO_COMECO.exec(linhas[i + 1]);
      if (codigo) {
        atual.linhas.push({ seq: Number(seq[1]), livro: codigo[1].toUpperCase(), numero: Number(codigo[2]) });
        i += 1;
        continue;
      }
    }
    sobra(linha);
  }

  // Um ponto citado em outro lugar da tela que JÁ é linha de uma tabela não é
  // linha perdida (“Sua posição: 12º — A132”, a fila repetida em outro formato
  // para a tela pequena…). Só conta o código que não entrou em tabela nenhuma.
  const naTabela = new Set(abertos.flatMap((q) => q.linhas.map((l) => `${l.livro}${String(l.numero).padStart(3, "0")}`)));
  for (const q of abertos) q.soltos = q.soltos.filter((c) => !naTabela.has(c));

  const quadros: QuadroDaFila[] = [];
  const recusados: FilaDoPortal["recusados"] = [];
  for (const q of abertos) {
    const repetido = abertos.filter((x) => x.livro === q.livro && x.tipo === q.tipo).length > 1;
    const motivo = repetido ? "o quadro aparece mais de uma vez na página" : motivoDaRecusa(q, paginaCompleta);
    if (motivo) {
      recusados.push({ titulo: q.titulo, motivo });
      continue;
    }
    quadros.push({
      livro: q.livro,
      tipo: q.tipo,
      titulo: q.titulo,
      ultimo: q.ultimo,
      codigos: q.linhas.map((l) => l.numero),
      total: q.total,
    });
  }
  return {
    quadros,
    recusados,
    completa: paginaCompleta,
    foraDosQuadros: [...new Set(foraDosQuadros)].filter((c) => !daConta.has(c) && !naTabela.has(c)),
  };
}

export type LivroLido = { truck: QuadroDaFila; cavalo: QuadroDaFila };

/**
 * Os dois quadros de um livro (Truck e Carreta), ou o motivo de não servirem.
 *
 * Só UM dos dois na tela: o outro vale como fila vazia quando a página chegou
 * até o fim e não há ponto escrito fora das tabelas — o portal não desenha o
 * cartão de uma fila sem pontos. Página cortada, ou com pontos que a leitura
 * não soube de que quadro são, nunca vira fila vazia. Nenhum dos dois na tela:
 * não dá para saber de que livro é a página, e o livro fica sem leitura.
 */
export function quadrosDoLivro(fila: FilaDoPortal, livro: LivroDaFila): LivroLido | { motivo: string } {
  const recusado = fila.recusados.find((r) => r.titulo.startsWith(`Livro ${livro} `));
  if (recusado) return { motivo: `${recusado.titulo}: ${recusado.motivo}` };
  const truck = fila.quadros.find((q) => q.livro === livro && q.tipo === "TRUCK");
  const cavalo = fila.quadros.find((q) => q.livro === livro && q.tipo === "CAVALO");
  if (!truck && !cavalo) return { motivo: `a tela não trouxe os quadros do Livro ${livro} (Truck e Carreta)` };
  if (truck && cavalo) return { truck, cavalo };

  const tipo: TipoDaFila = truck ? "CAVALO" : "TRUCK";
  const titulo = `Livro ${livro} - ${tipo === "TRUCK" ? "Truck" : "Carreta"}`;
  if (!fila.completa) return { motivo: `a tela não trouxe o quadro “${titulo}” e a página veio cortada` };
  if (fila.foraDosQuadros.length) {
    return {
      motivo: `a tela não trouxe o quadro “${titulo}”, mas mostra pontos fora das tabelas (${fila.foraDosQuadros.slice(0, 3).join(", ")}${fila.foraDosQuadros.length > 3 ? "…" : ""})`,
    };
  }
  const vazio: QuadroDaFila = { livro, tipo, titulo, ultimo: 0, codigos: [], total: null, ausente: true };
  return { truck: truck ?? vazio, cavalo: cavalo ?? vazio };
}

/** “Truck 5 na fila (último A196) · Carreta 55 na fila (último A025)”. */
export function resumoDoLivro(livro: LivroDaFila, lido: LivroLido): string {
  const parte = (nome: string, q: QuadroDaFila) =>
    q.ausente
      ? `${nome} 0 na fila (o quadro não apareceu na tela)`
      : `${nome} ${q.codigos.length} na fila (${q.ultimo ? `último ${livro}${String(q.ultimo).padStart(3, "0")}` : "sem último escalado"})`;
  return `${parte("Truck", lido.truck)} · ${parte("Carreta", lido.cavalo)}`;
}

/**
 * As abas “Livro A · Livro B · Livro M” da tela: o endereço de cada livro, como
 * o próprio portal informa. Só links de navegação: o que tem cara de ação fica
 * de fora.
 */
export function extrairLinksDeLivro(html: string, paginaUrl: string): { livro: LivroDaFila; url: string }[] {
  const limpo = limparHtml(html);
  const saida: { livro: LivroDaFila; url: string }[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpo))) {
    const texto = decodificarEntidades(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const aba = /^livro\s+([ABM])$/i.exec(texto);
    if (!aba) continue;
    if (/\bdata-method\s*=|\bdownload\b/i.test(m[1])) continue;
    const bruto = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[1]);
    const href = decodificarEntidades((bruto?.[1] ?? bruto?.[2] ?? bruto?.[3] ?? "").trim());
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data|blob):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, paginaUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    if (enderecoDeAcao(`${url.pathname}${url.search}`)) continue;
    const livro = aba[1].toUpperCase() as LivroDaFila;
    if (!saida.some((x) => x.livro === livro)) saida.push({ livro, url: url.toString() });
  }
  return saida;
}

/**
 * Primeiras linhas da tela, para o diagnóstico (só do administrador) quando
 * ela não foi reconhecida. Fica de fora o aviso “Seu ponto (…)”, que é da
 * conta de quem abriu a tela, e sequências longas de dígitos (documentos) saem
 * mascaradas.
 */
export function amostraDaTela(html: string, limite = 8): string[] {
  return linhasDaTela(html)
    .filter((l) => !/^seu\s+ponto\b/i.test(l))
    .slice(0, limite)
    .map((l) => l.replace(/\d{6,}/g, "…").slice(0, 60));
}
