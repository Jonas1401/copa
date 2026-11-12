import { atributos, decodificarEntidades, destinoProibido, enderecoDeAcao, limparHtml } from "@/lib/portal-copadubo-parse";

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

/* ------------------------------------------------- os botões “Livro A · B · M” */

/**
 * Como o leitor “toca” no botão de um livro da Tela de Ativos: o pedido que o
 * navegador faria. O HTML de verdade nunca foi visto (só a tela, com três
 * botões lado a lado), então o botão é aceito nas formas em que um site de
 * páginas inteiras costuma fazê-lo: link, botão que leva a um endereço e botão
 * de formulário (GET ou POST).
 */
export type ToqueNoLivro = {
  livro: LivroDaFila;
  url: string;
  metodo: "GET" | "POST";
  /** Corpo do POST (`application/x-www-form-urlencoded`). */
  corpo?: string;
  /** De que forma de botão saiu (vai para o diagnóstico). */
  forma: "link" | "botão com endereço" | "formulário GET" | "formulário POST";
};

/** O texto do botão tem de ser EXATAMENTE o nome do livro: “Livro B”. */
const RE_TEXTO_DE_LIVRO = /^livro\s+([ABM])$/i;
/** Um formulário que fala disto não é a troca de livro: é uma ação. */
const RE_FORMULARIO_QUE_AGE = /dispensa|motivo|exclu|apag|remov|\bsair\b|senha|password/i;
/** Um botão não tem um texto maior que isto (com as tags de dentro). */
const MAIOR_BOTAO = 400;

/**
 * Os elementos que podem ser um botão feito à mão — `button`, `a`, `div`,
 * `span`, `li`, `label` — com o texto de dentro. Só as “folhas”: uma caixa que
 * contém outra da mesma tag não é o botão (os botões são os de dentro, e cada
 * um é visto com os SEUS atributos).
 */
function elementosClicaveis(limpo: string): { tag: string; at: Record<string, string>; texto: string }[] {
  const saida: { tag: string; at: Record<string, string>; texto: string }[] = [];
  const minusculo = limpo.toLowerCase();
  const reAbre = /<(button|a|div|span|li|label)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = reAbre.exec(limpo))) {
    const tag = m[1].toLowerCase();
    const inicio = m.index + m[0].length;
    const fim = minusculo.indexOf(`</${tag}`, inicio);
    if (fim < 0 || fim - inicio > MAIOR_BOTAO) continue;
    const dentro = limpo.slice(inicio, fim);
    if (new RegExp(`<${tag}\\b`, "i").test(dentro)) continue;
    saida.push({ tag, at: atributos(m[2]), texto: textoDoHtml(dentro) });
  }
  return saida;
}
const textoDoHtml = (html: string) => decodificarEntidades(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const livroDoTexto = (texto: string): LivroDaFila | null => (RE_TEXTO_DE_LIVRO.exec(texto)?.[1].toUpperCase() as LivroDaFila | undefined) ?? null;

/** O endereço para onde um botão feito à mão leva: `data-href` (e parecidos) ou `onclick="location.href='…'"`. */
function enderecoDoControle(at: Record<string, string>): string | null {
  for (const nome of ["data-href", "data-url", "data-link", "data-location"]) {
    if (at[nome]?.trim()) return at[nome].trim();
  }
  const m = /(?:location(?:\.href)?\s*=\s*|location\.(?:assign|replace)\s*\(\s*|window\.open\s*\(\s*)(["'])([^"']+)\1/i.exec(at.onclick ?? "");
  return m ? m[2].trim() : null;
}

/** Endereço de navegação do próprio portal (http/https, sem cara de ação), já resolvido — ou `null`. */
function enderecoDeNavegacao(bruto: string, paginaUrl: string): URL | null {
  if (!bruto || bruto.startsWith("#") || /^(javascript|mailto|tel|data|blob):/i.test(bruto)) return null;
  let url: URL;
  try {
    url = new URL(bruto, paginaUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = "";
  const caminho = `${url.pathname}${url.search}`;
  return enderecoDeAcao(caminho) || destinoProibido(caminho) ? null : url;
}

/** Os botões de livro que são de formulário: um pedido por botão “Livro X”. */
function toquesDeFormulario(limpo: string, paginaUrl: string): ToqueNoLivro[] {
  const saida: ToqueNoLivro[] = [];
  const reForm = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi;
  let f: RegExpExecArray | null;
  while ((f = reForm.exec(limpo))) {
    const doForm = atributos(f[1]);
    const corpo = f[2];
    // Só uma ESCOLHA: nada para digitar, marcar, anexar ou selecionar.
    if (/<(?:textarea|select)\b/i.test(corpo)) continue;
    const ocultos: [string, string][] = [];
    const botoes: { at: Record<string, string>; texto: string }[] = [];
    let outroCampo = false;
    const reInput = /<input\b([^>]*?)\/?>/gi;
    let i: RegExpExecArray | null;
    while ((i = reInput.exec(corpo))) {
      const at = atributos(i[1]);
      const tipo = (at.type ?? "text").toLowerCase();
      if (tipo === "hidden") {
        if (at.name) ocultos.push([at.name, at.value ?? ""]);
      } else if (tipo === "submit") {
        botoes.push({ at, texto: (at.value ?? "").replace(/\s+/g, " ").trim() });
      } else if (tipo !== "button" && tipo !== "reset") {
        outroCampo = true;
      }
    }
    if (outroCampo) continue;
    const reButton = /<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi;
    let b: RegExpExecArray | null;
    while ((b = reButton.exec(corpo))) {
      const at = atributos(b[1]);
      if ((at.type ?? "submit").toLowerCase() === "submit") botoes.push({ at, texto: textoDoHtml(b[2]) });
    }
    if (!botoes.some((x) => livroDoTexto(x.texto))) continue;
    // Campo escondido que nomeia uma ação (acao=excluir…), ou formulário que fala de uma: fora.
    if (ocultos.some(([, valor]) => /^[a-z_\- ]{3,40}$/i.test(valor) && destinoProibido(valor))) continue;
    if (RE_FORMULARIO_QUE_AGE.test(textoDoHtml(corpo))) continue;

    for (const botao of botoes) {
      const livro = livroDoTexto(botao.texto);
      if (!livro) continue;
      const metodo = (botao.at.formmethod ?? doForm.method ?? "get").toLowerCase();
      if (metodo !== "get" && metodo !== "post") continue;
      const destino = enderecoDeNavegacao((botao.at.formaction ?? doForm.action ?? "").trim() || paginaUrl, paginaUrl);
      if (!destino) continue;
      const campos = new URLSearchParams();
      for (const [nome, valor] of ocultos) campos.append(nome, valor);
      if (botao.at.name) campos.append(botao.at.name, botao.at.value ?? "");
      if (metodo === "get") {
        // Como o navegador faz: os campos do formulário ENTRAM NO LUGAR dos parâmetros do endereço.
        destino.search = campos.toString();
        if (enderecoDeAcao(`${destino.pathname}${destino.search}`)) continue;
        saida.push({ livro, url: destino.toString(), metodo: "GET", forma: "formulário GET" });
      } else {
        saida.push({ livro, url: destino.toString(), metodo: "POST", corpo: campos.toString(), forma: "formulário POST" });
      }
    }
  }
  return saida;
}

/**
 * Os botões “Livro A · Livro B · Livro M” da tela, cada um com o pedido que o
 * toque nele faz. Um por livro, na ordem de preferência: link, botão que leva
 * a um endereço, formulário GET, formulário POST.
 *
 * O leitor entra com a conta do motorista, então a regra é a mesma do resto:
 * só o controle cujo texto é exatamente “Livro X”; nunca um endereço com cara
 * de ação; formulário só se não tem nada para digitar nem fala de dispensa,
 * exclusão, saída ou senha. E dois livros que dariam O MESMO pedido não valem
 * (três botões sem nome no mesmo formulário: quem troca o livro é um script,
 * e esta leitura não saberia qual livro pediu).
 */
export function extrairToquesDeLivro(html: string, paginaUrl: string): ToqueNoLivro[] {
  const limpo = limparHtml(html);
  const candidatos: ToqueNoLivro[] = extrairLinksDeLivro(html, paginaUrl).map((l) => ({ ...l, metodo: "GET" as const, forma: "link" as const }));

  const comEndereco = (livro: LivroDaFila | null, at: Record<string, string>) => {
    if (!livro) return;
    const url = enderecoDeNavegacao(enderecoDoControle(at) ?? "", paginaUrl);
    if (url) candidatos.push({ livro, url: url.toString(), metodo: "GET", forma: "botão com endereço" });
  };
  for (const e of elementosClicaveis(limpo)) comEndereco(livroDoTexto(e.texto), e.at);
  let m: RegExpExecArray | null;
  const reInputBotao = /<input\b([^>]*?)\/?>/gi;
  while ((m = reInputBotao.exec(limpo))) {
    const at = atributos(m[1]);
    if ((at.type ?? "").toLowerCase() === "button") comEndereco(livroDoTexto((at.value ?? "").replace(/\s+/g, " ").trim()), at);
  }

  candidatos.push(...toquesDeFormulario(limpo, paginaUrl));

  const pedido = (t: ToqueNoLivro) => `${t.metodo} ${t.url} ${t.corpo ?? ""}`;
  const ordem: ToqueNoLivro["forma"][] = ["link", "botão com endereço", "formulário GET", "formulário POST"];
  const saida: ToqueNoLivro[] = [];
  for (const forma of ordem) {
    for (const t of candidatos) {
      if (t.forma !== forma || saida.some((x) => x.livro === t.livro)) continue;
      // O mesmo pedido para livros diferentes não diz qual livro abre.
      if (candidatos.some((x) => x.livro !== t.livro && pedido(x) === pedido(t))) continue;
      saida.push(t);
    }
  }
  return saida;
}

/** Para o diagnóstico: texto curto que COMEÇA pelo nome de um livro (“Livro B”, “Livro B (27)”…) e só fala de UM livro. */
const pareceBotaoDeLivro = (texto: string) => /^livro\s+[ABM]\b.{0,24}$/i.test(texto) && (texto.match(/\blivro\s+[ABM]\b/gi) ?? []).length === 1;

/**
 * Para o diagnóstico (só do administrador), quando o botão de um livro não foi
 * encontrado: o que a tela TEM com um texto curto que começa por “Livro X” — a
 * tag e os atributos, nunca o conteúdo da fila. É o que permite ensinar a
 * forma nova numa rodada só. Mais frouxo que a leitura de propósito: um botão
 * escrito “Livro B (27)” não é tocado, mas aparece aqui.
 */
export function descreverBotoesDeLivro(html: string, limite = 4): string[] {
  const limpo = limparHtml(html);
  const saida: string[] = [];
  const formularios: string[] = [];
  const curto = (v: string) => v.replace(/\d{6,}/g, "…").replace(/\s+/g, " ").trim().slice(0, 70);
  const descrever = (tag: string, at: Record<string, string>, texto: string) => {
    const partes = Object.entries(at)
      .filter(([nome]) => nome !== "class" && nome !== "style" && nome !== "id")
      .map(([nome, valor]) => (/^(href|type|name|value|onclick|formaction|formmethod|role)$|^data-/.test(nome) ? `${nome}="${curto(valor)}"` : nome));
    const linha = `${texto}: <${tag}${partes.length ? ` ${partes.join(" ")}` : ""}>`;
    if (!saida.includes(linha)) saida.push(linha);
  };
  for (const e of elementosClicaveis(limpo)) {
    if (pareceBotaoDeLivro(e.texto)) descrever(e.tag, e.at, e.texto);
  }
  let m: RegExpExecArray | null;
  const reInput = /<input\b([^>]*?)\/?>/gi;
  while ((m = reInput.exec(limpo))) {
    const at = atributos(m[1]);
    const texto = (at.value ?? "").replace(/\s+/g, " ").trim();
    if (/^(submit|button)$/i.test(at.type ?? "") && pareceBotaoDeLivro(texto)) descrever("input", at, texto);
  }
  const reForm = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi;
  while ((m = reForm.exec(limpo))) {
    if (!/livro\s+[ABM]\b/i.test(textoDoHtml(m[2]) + " " + m[2])) continue;
    const at = atributos(m[1]);
    const campos = [...m[2].matchAll(/<(?:input|select|textarea)\b([^>]*?)\/?>/gi)]
      .map((c) => atributos(c[1]))
      .filter((c) => c.name)
      .map((c) => `${curto(c.name)}${(c.type ?? "").toLowerCase() === "hidden" ? " (oculto)" : ""}`);
    formularios.push(`formulário ${(at.method ?? "get").toUpperCase()} ${curto((at.action ?? "(a própria página)").split("?")[0])} — campos: ${[...new Set(campos)].join(", ") || "nenhum"}`);
  }
  // Os controles (os três botões e mais um, se houver) e, depois, até dois formulários.
  return [...saida.slice(0, limite), ...formularios.slice(0, 2)];
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
