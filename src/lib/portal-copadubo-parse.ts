/**
 * Leitura do PORTAL DO MOTORISTA da Copadubo (`portal.copadubo.com.br`).
 *
 * Só funções puras: recebem HTML e devolvem dados. Nada de rede, banco ou
 * segredo aqui — o que permite testar o leitor com o HTML real da página
 * (`tests/portal-copadubo.test.ts`) sem abrir o site.
 *
 * Por que a leitura é GENÉRICA (`extrairSecoes`): a página de status é feita
 * pela Copadubo e pode mudar sem aviso. Em vez de amarrar o formato a um campo
 * fixo (que quebraria e mentiria), o leitor:
 *   1. descobre sozinho o formulário de login (o único com campo de senha);
 *   2. depois de entrar, transforma a página inteira em seções e linhas —
 *      títulos (`<h1>`…`<h4>`) viram seções e tabelas/listas viram linhas.
 * Assim qualquer campo novo aparece no painel do administrador sem mexer no
 * código, e o motorista recebe um aviso quando alguma linha importante muda.
 */

/** Uma seção da página: título (ou "Página") e as linhas que vieram abaixo. */
export type SecaoPortal = { titulo: string; linhas: string[] };

/** Campo de um formulário HTML. */
export type CampoPortal = {
  nome: string;
  tipo: string;
  valor: string;
  id: string;
  rotulo: string;
};

export type FormularioPortal = {
  action: string;
  method: string;
  campos: CampoPortal[];
  temSenha: boolean;
  temCaptcha: boolean;
  /** Botões de envio (`<input type=submit>`, `<button>`): muitos PHP exigem o nome deles no POST. */
  botoes: { nome: string; valor: string }[];
};

export type AnalisePortal = {
  titulo: string;
  secoes: SecaoPortal[];
  totalLinhas: number;
  /** A página devolveu um campo de senha: é (ou voltou a ser) a tela de login. */
  pareceLogin: boolean;
  /** Linhas com assunto do dia a dia do motorista (chamada, fila, status…). */
  sinais: string[];
};

/** Máximo de linhas guardadas por leitura: a tela fica legível e o banco leve. */
export const MAX_LINHAS = 400;
/** Tamanho máximo de cada linha (o resto é cortado). */
const MAX_CARACTER_LINHA = 220;

const ENTIDADES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  raquo: "»",
  laquo: "«",
  middot: "·",
  ordm: "º",
  ordf: "ª",
  deg: "°",
  sect: "§",
  times: "×",
  divide: "÷",
  brvbar: "|",
  aacute: "á",
  agrave: "à",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  iacute: "í",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  uacute: "ú",
  uuml: "ü",
  ccedil: "ç",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Eacute: "É",
  Ecirc: "Ê",
  Iacute: "Í",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Uacute: "Ú",
  Ccedil: "Ç",
};

/** Troca entidades HTML (nomeadas e numéricas) pelos caracteres reais. */
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (bruto, corpo: string) => {
    if (corpo.startsWith("#")) {
      const codigo = corpo[1]?.toLowerCase() === "x"
        ? Number.parseInt(corpo.slice(2), 16)
        : Number.parseInt(corpo.slice(1), 10);
      if (!Number.isFinite(codigo) || codigo <= 0 || codigo > 0x10ffff) return bruto;
      try {
        return String.fromCodePoint(codigo);
      } catch {
        return bruto;
      }
    }
    return ENTIDADES[corpo] ?? bruto;
  });
}

/** Atributos de uma tag (`name="x"` ou `name='x'` ou `name=x`). */
export function atributos(tag: string): Record<string, string> {
  const saida: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    saida[m[1].toLowerCase()] = decodificarEntidades(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return saida;
}

/** Remove comentários e blocos que nunca interessam (script, style, svg…). */
export function limparHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ");
}

/** Texto do `<title>` (para o cabeçalho do painel). */
function tituloDoHtml(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? normalizarEspacos(decodificarEntidades(limparHtml(m[1]))).slice(0, 120) : "";
}

function normalizarEspacos(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Rótulos (`<label for="…">`) para dar nome legível aos campos. */
function rotulosDoHtml(html: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = atributos(m[1]);
    const texto = normalizarEspacos(decodificarEntidades(m[2].replace(/<[^>]+>/g, " ")));
    if (a.for && texto) mapa.set(a.for.toLowerCase(), texto.slice(0, 60));
    if (a.name && texto && !mapa.has(a.name.toLowerCase())) mapa.set(a.name.toLowerCase(), texto.slice(0, 60));
  }
  return mapa;
}

/**
 * Lista os formulários da página. É assim que o leitor descobre os NOMES dos
 * campos de login sem conhecê-los de antemão (a versão do site pode mudar).
 */
export function extrairFormularios(html: string): FormularioPortal[] {
  const limpo = limparHtml(html);
  const rotulos = rotulosDoHtml(limpo);
  const formularios: FormularioPortal[] = [];
  const reForm = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let f: RegExpExecArray | null;
  while ((f = reForm.exec(limpo))) {
    const a = atributos(f[1]);
    const corpo = f[2];
    const campos: CampoPortal[] = [];
    const botoes: { nome: string; valor: string }[] = [];

    const reInput = /<input\b([^>]*?)\/?>/gi;
    let i: RegExpExecArray | null;
    while ((i = reInput.exec(corpo))) {
      const at = atributos(i[1]);
      const nome = at.name ?? "";
      const tipo = (at.type ?? "text").toLowerCase();
      if (tipo === "submit" || tipo === "image") {
        if (nome) botoes.push({ nome, valor: at.value ?? "" });
        continue;
      }
      if (tipo === "button" || tipo === "reset" || tipo === "file") continue;
      if (!nome) continue;
      const id = at.id ?? "";
      campos.push({
        nome,
        tipo,
        valor: at.value ?? "",
        id,
        rotulo: rotulos.get(id.toLowerCase()) ?? rotulos.get(nome.toLowerCase()) ?? "",
      });
    }

    // <select> e <textarea> também fazem parte do login em alguns sites.
    const reSelect = /<select\b([^>]*)>/gi;
    let s: RegExpExecArray | null;
    while ((s = reSelect.exec(corpo))) {
      const at = atributos(s[1]);
      if (!at.name) continue;
      campos.push({ nome: at.name, tipo: "select", valor: "", id: at.id ?? "", rotulo: rotulos.get((at.id ?? "").toLowerCase()) ?? "" });
    }
    const reTextarea = /<textarea\b([^>]*)>/gi;
    let t: RegExpExecArray | null;
    while ((t = reTextarea.exec(corpo))) {
      const at = atributos(t[1]);
      if (!at.name) continue;
      campos.push({ nome: at.name, tipo: "textarea", valor: "", id: at.id ?? "", rotulo: rotulos.get((at.id ?? "").toLowerCase()) ?? "" });
    }

    const reButton = /<button\b([^>]*)>/gi;
    let b: RegExpExecArray | null;
    while ((b = reButton.exec(corpo))) {
      const at = atributos(b[1]);
      if (at.name && (at.type ?? "submit").toLowerCase() === "submit") botoes.push({ nome: at.name, valor: at.value ?? "" });
    }

    const emTexto = normalizarEspacos(corpo.replace(/<[^>]+>/g, " "));
    formularios.push({
      action: a.action ?? "",
      method: (a.method ?? "get").toLowerCase(),
      campos,
      temSenha: campos.some((c) => c.tipo === "password" || /senha|password|passwd/i.test(`${c.nome} ${c.id} ${c.rotulo}`)),
      temCaptcha:
        campos.some((c) => /captcha/i.test(`${c.nome} ${c.id}`)) ||
        /recaptcha|hcaptcha|g-recaptcha|captcha/i.test(corpo),
      botoes,
    });
  }
  return formularios;
}

/** O formulário de login é o que tem senha (e, de preferência, sem captcha). */
export function escolherFormularioLogin(html: string): FormularioPortal | null {
  const formularios = extrairFormularios(html);
  const comSenha = formularios.filter((f) => f.temSenha);
  if (!comSenha.length) return null;
  return comSenha.find((f) => !f.temCaptcha) ?? comSenha[0];
}

/** Resolve `action` relativo contra o endereço da página. */
export function resolverUrl(base: string, alvo: string): string {
  const limpo = (alvo ?? "").trim();
  if (!limpo) return base;
  try {
    return new URL(limpo, base).toString();
  } catch {
    return base;
  }
}

// ------------------------------------------------------ escolha do ponto

/** Um ponto da lista da tela “Trocar Ponto”: o valor enviado e o código (A032). */
export type OpcaoDePonto = { valor: string; codigo: string };

/**
 * Formulário da tela “Trocar Ponto” do portal: uma lista com os pontos da conta
 * e o botão “Confirmar”. O portal mostra o Status de UM ponto por vez — o que
 * foi escolhido aqui.
 */
export type EscolhaDePonto = {
  action: string;
  method: "get" | "post";
  /** Nome do campo da lista de pontos. */
  campo: string;
  opcoes: OpcaoDePonto[];
  /** Campos escondidos do formulário, enviados como estão. */
  ocultos: { nome: string; valor: string }[];
  /** Botão de envio com nome (alguns PHP exigem o nome dele no pedido). */
  botao: { nome: string; valor: string } | null;
};

/** Opção cujo texto é um código de ponto (“A032”, “A032 - …”). */
const RE_OPCAO_PONTO = /^\s*(?:ponto\s*[:\-–]?\s*)?([ABM])\s?-?(\d{1,4})\b/i;
/** Um formulário que fala disto NÃO é a escolha do ponto: é uma ação. */
const RE_FORMULARIO_DE_ACAO = /dispensa|motivo|exclu|apag|remov|\bsair\b|senha|password/i;
/** Endereço para onde a escolha do ponto nunca é enviada. */
const RE_DESTINO_PROIBIDO = /sair|logout|logoff|deslog|dispensa|exclu|apag|remov|delet|senha|password/i;

/** O endereço (caminho + parâmetros) não pode receber a escolha do ponto. */
export function destinoProibido(caminhoEParametros: string): boolean {
  return RE_DESTINO_PROIBIDO.test(caminhoEParametros);
}

/**
 * Acha na página o formulário de ESCOLHA DO PONTO. Para não confundir com um
 * formulário de ação (entrar em dispensa, por exemplo), só vale o formulário
 * que tem UMA lista, feita de códigos de ponto, e nada para digitar ou marcar;
 * e que não fala de dispensa, motivo, exclusão, saída ou senha — nem no texto,
 * nem no endereço, nem nos campos escondidos.
 */
export function extrairEscolhaDePonto(html: string): EscolhaDePonto | null {
  const limpo = limparHtml(html);
  const reForm = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let f: RegExpExecArray | null;
  while ((f = reForm.exec(limpo))) {
    const a = atributos(f[1]);
    const corpo = f[2];
    const action = a.action ?? "";
    if (RE_DESTINO_PROIBIDO.test(action)) continue;

    const listas: { nome: string; opcoes: { valor: string; texto: string }[] }[] = [];
    const reSelect = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
    let s: RegExpExecArray | null;
    while ((s = reSelect.exec(corpo))) {
      const at = atributos(s[1]);
      const opcoes: { valor: string; texto: string }[] = [];
      const reOpcao = /<option\b([^>]*)>([^<]*)/gi;
      let o: RegExpExecArray | null;
      while ((o = reOpcao.exec(s[2]))) {
        const ao = atributos(o[1]);
        const texto = normalizarEspacos(decodificarEntidades(o[2]));
        opcoes.push({ valor: ao.value !== undefined ? ao.value : texto, texto });
      }
      listas.push({ nome: at.name ?? "", opcoes });
    }
    if (listas.length !== 1 || !listas[0].nome) continue;

    // A lista tem de ser de pontos: no máximo UMA opção com valor que não seja
    // um código (o “Escolha o Ponto...” de alguns formulários tem valor 0).
    const opcoes: OpcaoDePonto[] = [];
    let outras = 0;
    for (const op of listas[0].opcoes) {
      if (op.valor === "") continue;
      const m = RE_OPCAO_PONTO.exec(op.texto);
      if (m) opcoes.push({ valor: op.valor, codigo: `${m[1].toUpperCase()}${m[2].padStart(3, "0")}` });
      else outras += 1;
    }
    if (!opcoes.length || outras > 1) continue;

    const ocultos: { nome: string; valor: string }[] = [];
    let botao: { nome: string; valor: string } | null = null;
    let outroCampo = false;
    const reInput = /<input\b([^>]*?)\/?>/gi;
    let i: RegExpExecArray | null;
    while ((i = reInput.exec(corpo))) {
      const at = atributos(i[1]);
      const tipo = (at.type ?? "text").toLowerCase();
      if (tipo === "hidden") {
        if (at.name) ocultos.push({ nome: at.name, valor: at.value ?? "" });
      } else if (tipo === "submit" || tipo === "image") {
        if (at.name && !botao) botao = { nome: at.name, valor: at.value ?? "" };
      } else if (tipo !== "button" && tipo !== "reset") {
        outroCampo = true; // algo para digitar, marcar ou anexar: não é só uma escolha
      }
    }
    if (outroCampo || /<textarea\b/i.test(corpo)) continue;
    // Campo escondido que nomeia uma ação (acao=dispensa…): fora.
    if (ocultos.some((c) => /^[a-z_\- ]{3,40}$/i.test(c.valor) && RE_DESTINO_PROIBIDO.test(c.valor))) continue;
    const reButton = /<button\b([^>]*)>/gi;
    let b: RegExpExecArray | null;
    while ((b = reButton.exec(corpo))) {
      const at = atributos(b[1]);
      if (!botao && at.name && (at.type ?? "submit").toLowerCase() === "submit") botao = { nome: at.name, valor: at.value ?? "" };
    }
    const texto = normalizarEspacos(
      decodificarEntidades(corpo.replace(/<select\b[\s\S]*?<\/select>/gi, " ").replace(/<[^>]+>/g, " ")),
    );
    if (RE_FORMULARIO_DE_ACAO.test(texto)) continue;

    return {
      action,
      method: (a.method ?? "get").toLowerCase() === "post" ? "post" : "get",
      campo: listas[0].nome,
      opcoes,
      ocultos,
      botao,
    };
  }
  return null;
}

/** Corpo do pedido que escolhe um ponto: os campos escondidos, a lista e o botão. */
export function montarCorpoEscolha(escolha: EscolhaDePonto, valor: string): string {
  const campos = new URLSearchParams();
  for (const c of escolha.ocultos) campos.append(c.nome, c.valor);
  campos.append(escolha.campo, valor);
  if (escolha.botao) campos.append(escolha.botao.nome, escolha.botao.valor);
  return campos.toString();
}

/**
 * Formulários da página, só a ESTRUTURA (endereço e nomes dos campos, nunca os
 * valores): vai para o diagnóstico quando a escolha do ponto não é encontrada.
 */
export function resumoFormularios(html: string, limite = 3): string[] {
  return extrairFormularios(html)
    .slice(0, limite)
    .map((f) => {
      const campos = f.campos.map(
        (c) => `${c.nome.slice(0, 24)}${c.tipo === "select" ? " (lista)" : c.tipo === "hidden" ? " (oculto)" : c.tipo === "password" ? " (senha)" : ""}`,
      );
      return `${f.method.toUpperCase()} ${(f.action || "(a própria página)").split("?")[0].slice(0, 60)} — campos: ${campos.join(", ").slice(0, 140) || "nenhum"}`;
    });
}

/** Link de navegação do portal (uma aba do menu do motorista). */
export type LinkPortal = { texto: string; url: string };

/** Abas que o leitor pode abrir. Só navegação: nada que mude o ponto. */
const RE_ABA_DO_MENU =
  /^(ponto|meu ponto|trocar ponto|status|status do ponto|ticket|tickets|fila|filas|ativos|tela de ativos|escala|escalas|in[íi]cio)$/i;
/** Endereço com cara de AÇÃO (sair, dispensa, excluir…): nunca é aberto. */
const RE_ENDERECO_DE_ACAO =
  /sair|logout|logoff|deslog|dispensa|exclu|apag|remov|delet|cancel|confirm|aceit|recus|salv|grav|senha|password|cadastr|alter|edit|nov[oa]|baix|download|pdf|imprim|print/i;
/**
 * “acao”/“action” só como palavra inteira (`?acao=sair`, `/acao.php`,
 * `fazerAcao`): dentro de “situacao” ou “informacao” é só o nome de uma tela.
 */
const RE_PALAVRA_ACAO = /(?:^|[^a-z])(?:acao|acoes|action|actions)(?:[^a-z]|$)/;

/** O endereço (caminho + parâmetros) tem cara de ação: o leitor não abre. */
export function enderecoDeAcao(caminhoEParametros: string): boolean {
  if (RE_ENDERECO_DE_ACAO.test(caminhoEParametros)) return true;
  const palavras = caminhoEParametros.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return RE_PALAVRA_ACAO.test(palavras);
}

/**
 * Abas do menu do motorista que aparecem na página (Ponto, Status, Ticket,
 * Fila…), para o leitor abrir as telas pelo endereço que o PRÓPRIO portal
 * informa, sem adivinhar caminhos.
 *
 * O leitor entra com a conta do motorista, então a regra é só olhar: entra na
 * lista apenas o link cujo texto é exatamente o nome de uma aba e cujo
 * endereço não tem cara de ação. “Sair da dispensa”, “Entrar em dispensa”,
 * “Sair” e qualquer botão ficam de fora — abrir um deles mudaria a situação
 * do ponto de verdade.
 */
export function extrairLinksMenu(html: string, paginaUrl: string, ignorados?: LinkPortal[]): LinkPortal[] {
  const limpo = limparHtml(html);
  const saida: LinkPortal[] = [];
  const vistos = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpo))) {
    const a = atributos(m[1]);
    const href = (a.href ?? "").trim();
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data|blob):/i.test(href)) continue;
    if (a["data-method"] || a.download !== undefined) continue;
    const texto = normalizarEspacos(decodificarEntidades(m[2].replace(/<[^>]+>/g, " ")));
    const rotulo = (texto || a.title || a["aria-label"] || "").trim();
    if (!RE_ABA_DO_MENU.test(rotulo)) continue;
    let url: URL;
    try {
      url = new URL(href, paginaUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    const chave = url.toString();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (enderecoDeAcao(`${url.pathname}${url.search}`)) {
      // Tem nome de aba, mas o endereço parece uma ação: fica só no diagnóstico.
      ignorados?.push({ texto: rotulo.slice(0, 40), url: chave });
      continue;
    }
    saida.push({ texto: rotulo.slice(0, 40), url: chave });
  }
  return saida;
}

/**
 * Página que respondeu sem texto mas manda o navegador para outro endereço
 * (`<meta http-equiv="refresh">` ou `location.href = "…"`): devolve o destino.
 * Alguns PHP respondem assim ao login em vez de usar o cabeçalho Location.
 */
export function destinoDeRedirecionamentoNaPagina(html: string, paginaUrl: string): string | null {
  const meta = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i.exec(html);
  const doMeta = meta ? /url\s*=\s*['"]?([^'"\s>;]+)/i.exec(meta[0])?.[1] : null;
  const doScript =
    /(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*["']([^"']{1,300})["']/i.exec(html)?.[1] ??
    /location\.(?:replace|assign)\(\s*["']([^"']{1,300})["']\s*\)/i.exec(html)?.[1] ??
    null;
  const alvo = decodificarEntidades((doMeta ?? doScript ?? "").trim());
  if (!alvo || /^(javascript|data|blob):/i.test(alvo)) return null;
  try {
    return new URL(alvo, paginaUrl).toString();
  } catch {
    return null;
  }
}

/** A página veio sem texto mas com scripts: provavelmente é montada no navegador. */
export function pareceMontadaPorScript(html: string): boolean {
  return html.length > 600 && /<script\b/i.test(html) && extrairSecoes(html).totalLinhas <= 2;
}

/**
 * Monta o corpo do login com os nomes REAIS dos campos: usuário (CPF/e-mail) e
 * senha são os que têm cara disso; os demais (token, hidden, submit) mantêm o
 * valor original da página.
 */
export function montarCorpoLogin(
  formulario: FormularioPortal,
  credenciais: { cpf: string; senha: string },
): URLSearchParams {
  const corpo = new URLSearchParams();
  const ehSenha = (c: CampoPortal) => c.tipo === "password" || /senha|password|passwd/i.test(`${c.nome} ${c.id} ${c.rotulo}`);
  const ehUsuario = (c: CampoPortal) =>
    /cpf|cnpj|email|e-mail|usuario|usuário|login|user|identific/i.test(`${c.nome} ${c.id} ${c.rotulo}`);

  for (const c of formulario.campos) {
    if (c.tipo === "checkbox" || c.tipo === "radio" || c.tipo === "button") continue;
    if (ehSenha(c)) {
      corpo.append(c.nome, credenciais.senha);
      continue;
    }
    if (ehUsuario(c)) {
      corpo.append(c.nome, credenciais.cpf);
      continue;
    }
    if (c.tipo === "hidden" || c.tipo === "submit") {
      corpo.append(c.nome, c.valor);
      continue;
    }
    // Campo de texto que não é login (ex.: "código da empresa"): usa o que veio.
    if (c.valor) corpo.append(c.nome, c.valor);
  }
  for (const b of formulario.botoes) {
    if (b.nome) corpo.append(b.nome, b.valor);
  }
  return corpo;
}

/**
 * Converte a página inteira em seções + linhas.
 *
 * Títulos (`h1`…`h4`, `legend`, `caption`) abrem uma seção; cada célula de
 * tabela vira uma coluna separada por " · "; `br`, `p`, `div`, `li` e `tr`
 * quebram linha. O resultado é estável: duas leituras iguais produzem
 * exatamente as mesmas linhas (é o que permite avisar só o que mudou).
 */
export function extrairSecoes(html: string): { titulo: string; secoes: SecaoPortal[]; totalLinhas: number; pareceLogin: boolean } {
  const formularioLogin = escolherFormularioLogin(html);
  // As opções de uma lista (<select>) são escolhas de um formulário, não texto
  // da página: a lista de pontos de “Trocar Ponto” não é um cartão, e os motivos
  // de dispensa do formulário não são dados do ponto.
  const corpo = limparHtml(html).replace(/<select\b[\s\S]*?<\/select>/gi, " ");

  const comMarcas = corpo
    // títulos → marcador de seção
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\u0001")
    .replace(/<caption\b[^>]*>/gi, "\n\u0001")
    .replace(/<legend\b[^>]*>/gi, "\n\u0001")
    // colunas de tabela
    .replace(/<\/t[dh]>/gi, " · ")
    // quebras de linha explícitas
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|table|section|article|header|footer|dd|dt|option|label|h[1-6]|caption|legend|ul|ol|dl|form|td|th)>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n");

  const semTags = decodificarEntidades(comMarcas.replace(/<[^>]*>/g, " "));

  const secoes: SecaoPortal[] = [];
  let atual: SecaoPortal = { titulo: "", linhas: [] };
  let total = 0;

  const guardar = () => {
    if (atual.linhas.length) secoes.push(atual);
    atual = { titulo: "", linhas: [] };
  };

  for (const bruta of semTags.split(/\r?\n/)) {
    const novaSecao = bruta.includes("\u0001");
    for (const pedaco of bruta.split("\u0001")) {
      const linha = normalizarEspacos(pedaco).replace(/(\s*·\s*)+$/, "").replace(/^(\s*·\s*)+/, "");
      if (!linha) continue;
      const cortada = linha.slice(0, MAX_CARACTER_LINHA);
      if (novaSecao && !atual.linhas.length) {
        // Título logo no começo: nomeia a seção em vez de virar uma linha.
        atual.titulo = cortada.slice(0, 90);
        continue;
      }
      if (novaSecao) {
        guardar();
        atual.titulo = cortada.slice(0, 90);
        continue;
      }
      if (total >= MAX_LINHAS) break;
      // Evita repetir a mesma linha em sequência (menus, espaçadores…).
      if (atual.linhas[atual.linhas.length - 1] === cortada) continue;
      atual.linhas.push(cortada);
      total++;
    }
    if (total >= MAX_LINHAS) break;
  }
  guardar();

  const secoesLimpas = secoes.map((s) => ({
    titulo: s.titulo || (secoes.length > 1 ? "Página" : "Página"),
    linhas: s.linhas,
  }));

  return {
    titulo: tituloDoHtml(html),
    secoes: secoesLimpas,
    totalLinhas: secoesLimpas.reduce((n, s) => n + s.linhas.length, 0),
    pareceLogin: Boolean(formularioLogin),
  };
}

/** Assunto do dia a dia: o que o motorista realmente quer ver primeiro. */
export const TERMOS_INTERESSE = [
  "senha",
  "atendimento",
  "chamada",
  "chamado",
  "fila",
  "posi",
  "status",
  "situa",
  "ponto",
  "agenda",
  "previs",
  "horário",
  "horario",
  "veículo",
  "veiculo",
  "placa",
  "carreta",
  "cavalo",
  "truck",
  "liberado",
  "aguard",
  "livro",
];

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Linhas que falam do trabalho do motorista (vai para aviso e para a IA). */
export function linhasDeInteresse(secoes: SecaoPortal[], limite = 12): string[] {
  const termos = TERMOS_INTERESSE.map(semAcento);
  const saida: string[] = [];
  for (const s of secoes) {
    for (const linha of s.linhas) {
      const alvo = semAcento(`${s.titulo} ${linha}`);
      if (termos.some((t) => alvo.includes(t))) saida.push(linha);
      if (saida.length >= limite) return saida;
    }
  }
  return saida;
}

/** Análise completa da página (o que o painel e o aviso usam). */
export function analisarPortal(html: string): AnalisePortal {
  const { titulo, secoes, totalLinhas, pareceLogin } = extrairSecoes(html);
  return { titulo, secoes, totalLinhas, pareceLogin, sinais: linhasDeInteresse(secoes) };
}

/**
 * Filtra as seções pelas linhas de interesse. O painel mostra estas primeiro e
 * deixa o resto recolhido — a página inteira continua disponível.
 */
export function filtrarSecoes(secoes: SecaoPortal[], termos: string[] = TERMOS_INTERESSE): SecaoPortal[] {
  const busca = termos.map(semAcento).filter(Boolean);
  if (!busca.length) return secoes;
  return secoes
    .map((s) => ({
      titulo: s.titulo,
      linhas: s.linhas.filter((l) => busca.some((t) => semAcento(`${s.titulo} ${l}`).includes(t))),
    }))
    .filter((s) => s.linhas.length);
}

/** Impressão digital estável do conteúdo (para saber se a página mudou). */
export function hashConteudo(secoes: SecaoPortal[]): string {
  const texto = secoes.map((s) => `${s.titulo}\u0002${s.linhas.join("\u0002")}`).join("\u0003");
  // Hash simples e determinístico (FNV-1a 32 bits em duas sementes).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Contador que o portal recalcula sozinho a cada minuto (“há 9 min”, “há 2 h”). */
const RE_CONTADOR_DE_TEMPO =
  /\bh[áa]\s+\d+\s*(?:min(?:utos?)?|h(?:oras?)?|d(?:ias?)?|s(?:eg(?:undos?)?)?)(?:\s*(?:e\s+)?\d+\s*(?:min(?:utos?)?|h(?:oras?)?|s(?:eg(?:undos?)?)?))*\b/gi;

/**
 * Impressão digital que NÃO muda quando só o relógio da página andou
 * (“há 9 min” → “há 10 min”). É o que diz se duas leituras seguidas mostram a
 * mesma coisa — a leitura de minuto em minuto não vira uma linha nova no
 * histórico a cada minuto.
 */
export function hashEstavel(secoes: SecaoPortal[]): string {
  return hashConteudo(
    secoes.map((s) => ({ titulo: s.titulo, linhas: s.linhas.map((l) => l.replace(RE_CONTADOR_DE_TEMPO, "há N")) })),
  );
}

/** Lista simples (sem ordem) de todas as linhas. */
export function todasAsLinhas(secoes: SecaoPortal[]): string[] {
  return secoes.flatMap((s) => s.linhas);
}

/**
 * O que mudou entre duas leituras — é o corpo do aviso ("Chegou sua vez").
 * Compara linhas inteiras: uma linha alterada aparece como uma remoção e uma
 * inclusão. Limitado para o aviso não virar um romance.
 */
export function linhasAlteradas(
  antes: SecaoPortal[],
  depois: SecaoPortal[],
  limite = 8,
): { novas: string[]; removidas: string[] } {
  const a = todasAsLinhas(antes);
  const d = todasAsLinhas(depois);
  const conjuntoA = new Map<string, number>();
  for (const l of a) conjuntoA.set(l, (conjuntoA.get(l) ?? 0) + 1);
  const novas: string[] = [];
  for (const l of d) {
    const n = conjuntoA.get(l) ?? 0;
    if (n > 0) conjuntoA.set(l, n - 1);
    else if (novas.length < limite) novas.push(l);
  }
  const conjuntoD = new Map<string, number>();
  for (const l of d) conjuntoD.set(l, (conjuntoD.get(l) ?? 0) + 1);
  const removidas: string[] = [];
  for (const l of a) {
    const n = conjuntoD.get(l) ?? 0;
    if (n > 0) conjuntoD.set(l, n - 1);
    else if (removidas.length < limite) removidas.push(l);
  }
  return { novas, removidas };
}

/** Texto curto e legível das seções (para log, diagnóstico e IA). */
export function resumoTexto(secoes: SecaoPortal[], limiteLinhas = 40): string {
  const partes: string[] = [];
  let n = 0;
  for (const s of secoes) {
    if (n >= limiteLinhas) break;
    partes.push(`# ${s.titulo}`);
    for (const l of s.linhas) {
      if (n >= limiteLinhas) break;
      partes.push(`- ${l}`);
      n++;
    }
  }
  return partes.join("\n");
}

/** Mantém só os dígitos do CPF (o portal aceita com ou sem pontuação). */
export function limparCpf(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "").slice(0, 11);
}

/** Confere se o CPF tem 11 dígitos e não é uma sequência repetida (000…). */
export function cpfPlausivel(cpf: string): boolean {
  return /^\d{11}$/.test(cpf) && !/^(\d)\1{10}$/.test(cpf);
}

/** CPF mascarado para exibir (`***.***.789-01`) — o número inteiro nunca sai do servidor. */
export function mascararCpf(cpf: string): string {
  const d = limparCpf(cpf);
  if (d.length !== 11) return "***.***.***-**";
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Os 3 últimos dígitos do CPF (o suficiente para o motorista se reconhecer). */
export function finalCpf(cpf: string): string {
  const d = limparCpf(cpf);
  return d.slice(-3) || "***";
}

/* ==========================================================================
 * TELA DE STATUS DO PONTO (print do portal, 09/11/2026)
 *
 * “Status do Ponto”
 *   A032   [placa]                          ● EM DISPENSA
 *   ⏱ Desde hoje, 11:32   há 9 min
 *   MOTIVO
 *   001 - OFICINA
 *   👤 NOME DO MOTORISTA
 *   [ Sair da dispensa ]
 *
 * Situações que o portal mostra para o ponto: ATIVO (na fila), ESCALADO
 * (chamado para o trabalho) e EM DISPENSA. As demais (EM ATENDIMENTO,
 * DESCANSANDO, AGUARDANDO) ficaram de versões anteriores da tela.
 *
 * A leitura é por LINHAS (o texto já vem limpo do `extrairSecoes`) e sempre
 * dentro do CARTÃO do ponto pedido: a situação é a primeira que aparece junto
 * do código do ponto. Assim “Último Ponto Escalado”, o botão “Entrar em
 * dispensa” ou o cartão de outro ponto nunca viram a situação deste.
 * ========================================================================== */

export type TurnoPortal =
  | "ATIVO"
  | "ESCALADO"
  | "EM DISPENSA"
  | "EM ATENDIMENTO"
  | "DESCANSANDO"
  | "AGUARDANDO"
  | "FORA";

export type StatusPortal = {
  /** Código do ponto mostrado na tela (ex.: A032). */
  codigo: string | null;
  /** Cartão/veículo ao lado do ponto (ex.: ABC-1D23). */
  cartao: string | null;
  turno: TurnoPortal | null;
  /** Texto exato do turno como o portal escreve (ex.: "EM DISPENSA"). */
  turnoTexto: string | null;
  /** Trecho do “Desde hoje, 11:32 · há 9 min”. */
  desde: string | null;
  /** Há quantos minutos está nesse estado (o portal já calcula). */
  haMinutos: number | null;
  /** Código + descrição do motivo da dispensa (ex.: "001 - OFICINA"). */
  motivo: string | null;
  /** O motorista mostrado na tela. */
  nome: string | null;
  /** É a tela de status do ponto (e não outra página do portal). */
  ehTelaStatus: boolean;
  /**
   * As demais linhas do cartão do ponto, como o portal escreve. Quando o ponto
   * está ESCALADO, é aqui que vêm os dados da escala (o leitor não supõe o
   * nome dos campos: leva a linha inteira).
   */
  detalhes: string[];
};

/** Situações do ponto, como o portal escreve no cartão. */
const TURNOS: { chave: TurnoPortal; re: RegExp }[] = [
  { chave: "EM DISPENSA", re: /\bEM\s+DISPENSA\b/i },
  { chave: "EM ATENDIMENTO", re: /\bEM\s+ATENDIMENTO\b/i },
  { chave: "ESCALADO", re: /\bESCALADO\b/i },
  { chave: "DESCANSANDO", re: /\bDESCANSANDO\b/i },
  { chave: "AGUARDANDO", re: /\bAGUARDANDO\b/i },
  { chave: "ATIVO", re: /\bATIVO\b/i },
  { chave: "FORA", re: /\b(fora\s+de\s+servi[cç]o|sem\s+ponto)\b/i },
];

/** Código de ponto em qualquer lugar da linha (A032, A-32, M28). */
const RE_CODIGOS_NA_LINHA = /\b([ABM])\s?-?(\d{2,4})\b/gi;
/** Linha que COMEÇA com um código: é o começo do cartão de um ponto. */
const RE_COMECA_COM_CODIGO = /^\s*(?:ponto\s*[:\-–]?\s*)?([ABM])\s?-?(\d{2,4})\b/i;
/** Rótulo do quadro de ativos — nunca é a situação do ponto do motorista. */
const RE_ULTIMO_ESCALADO = /[úu]ltim[oa]s?\s+(?:pontos?\s+)?escalad[oa]s?/i;
const RE_NEGADO = /\bn[ãa]o\s+(?:est[áa]\s+)?(?:escalad[oa]|ativ[oa])\b/gi;
/** Botões e links de ação (“Sair da dispensa”, “Entrar em dispensa”…). */
const RE_BOTAO = /^(sair|entrar|solicitar|pedir|encerrar|iniciar|registrar|confirmar|cancelar|voltar|abrir|atualizar|alterar|trocar)\b/i;
/** Botão de dispensa do cartão (“Entrar na dispensa”, “Sair da dispensa”): é o último item dele. */
const RE_BOTAO_DISPENSA = /^(?:entrar|sair)\s+(?:n[ao]|d[ao]|em)\s+dispensa\b/i;
/** Linha da fila do quadro: “1 · A109 · TRUCK 4 EIXOS”. */
const RE_LINHA_FILA = /^\d{1,3}\s*[·|.\-–]\s*[A-Z]{1,3}\s?-?\d{1,4}\b/i;
const RE_FORA_DA_FILA = /seu\s+ponto\b.*\bn[ãa]o\s+est[áa]\s+na\s+fila/i;
const RE_CABECALHO_LIVRO = /^\s*livro\s+[ABM]\b/i;
/** Abas e rótulos do próprio portal: não são dado do ponto. */
const RE_ABA = /^(ponto|status|status do ponto|ticket|fila|ativos|tela de ativos|sair|menu|in[íi]cio|voltar|copadubo|motivo)$/i;
/** Quantas linhas, no máximo, formam o cartão de um ponto. */
const MAX_LINHAS_CARTAO = 14;

function codigosDaLinha(linha: string): string[] {
  const saida: string[] = [];
  const re = new RegExp(RE_CODIGOS_NA_LINHA.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(linha))) saida.push(`${m[1].toUpperCase()}${m[2].padStart(3, "0")}`);
  return saida;
}

/** Placa ao lado do ponto: antiga (ABC-1234) ou Mercosul (ABC1D23). */
const RE_PLACA = /\b[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}\b/gi;

/** A situação escrita numa linha (a que aparece primeiro), ou null. */
function turnoDaLinha(linha: string): { chave: TurnoPortal; texto: string } | null {
  const l = linha.trim();
  if (!l || RE_BOTAO.test(l)) return null;
  const limpa = l.replace(new RegExp(RE_ULTIMO_ESCALADO.source, "gi"), " ").replace(RE_NEGADO, " ");
  let melhor: { chave: TurnoPortal; texto: string; i: number } | null = null;
  let quantas = 0;
  for (const t of TURNOS) {
    const m = t.re.exec(limpa);
    if (!m) continue;
    quantas += 1;
    if (!melhor || m.index < melhor.i) melhor = { chave: t.chave, texto: m[0].toUpperCase(), i: m.index };
  }
  // Várias situações na mesma linha, sem o código de um ponto, é legenda ou
  // filtro da tela (“Ativo · Escalado · Em dispensa”), não a situação do ponto.
  if (quantas >= 2 && !codigosDaLinha(l).length) return null;
  return melhor ? { chave: melhor.chave, texto: melhor.texto } : null;
}

/**
 * A situação escrita SOZINHA na linha — o selo do cartão (“● EM DISPENSA”,
 * “A032 · placa · ESCALADO”, “Situação: ATIVO”). Vale mais que a mesma palavra
 * no meio de uma frase (“Cadastro ativo desde 2020”).
 */
function turnoIsolado(linha: string): { chave: TurnoPortal; texto: string } | null {
  const turno = turnoDaLinha(linha);
  if (!turno) return null;
  const resto = linha
    .replace(new RegExp(RE_CODIGOS_NA_LINHA.source, "gi"), " ")
    .replace(new RegExp(RE_PLACA.source, "gi"), " ")
    .replace(new RegExp(TURNOS.find((t) => t.chave === turno.chave)!.re.source, "gi"), " ")
    .replace(/\b(status|situa[çc][ãa]o|do|ponto|atual)\b/gi, " ");
  return /[0-9A-Za-zÀ-ú]/.test(resto) ? null : turno;
}

/**
 * Interpreta a tela de status a partir das linhas da página.
 *
 * `codigoMonitorado`: o ponto que o app acompanha (A032). Com ele, a leitura
 * procura o cartão DESSE ponto; se a página só mostra outro ponto, devolve o
 * que a página mostra (quem chama compara os códigos e descarta).
 * Nada de exceção — campo que não veio fica `null`.
 */
export function interpretarStatus(secoes: SecaoPortal[], codigoMonitorado?: string | null): StatusPortal | null {
  const linhas = todasAsLinhas(secoes);
  const textoTodo = linhas.join(" · ");
  const falaDeStatus = /status\s+do\s+ponto/i.test(`${secoes.map((s) => s.titulo).join(" ")} ${textoTodo}`);

  // Títulos de seção também contam como linha: o código do ponto pode estar num <h2>.
  const plano: string[] = [];
  for (const s of secoes) {
    if (s.titulo && s.titulo !== "Página") plano.push(s.titulo);
    plano.push(...s.linhas);
  }

  const alvo = codigoMonitorado ? normalizarCodigoPortal(codigoMonitorado) : null;

  // Linhas que podem ser o cartão de um ponto: têm um código e NÃO são do
  // quadro de ativos (fila numerada, “Último Ponto Escalado”, aviso de fora da fila).
  const candidatas: { i: number; codigo: string }[] = [];
  for (let i = 0; i < plano.length; i++) {
    const l = plano[i];
    if (RE_LINHA_FILA.test(l.trim()) || RE_FORA_DA_FILA.test(l) || RE_ULTIMO_ESCALADO.test(l)) continue;
    if (i > 0 && RE_ULTIMO_ESCALADO.test(plano[i - 1])) continue;
    for (const codigo of codigosDaLinha(l)) candidatas.push({ i, codigo });
  }
  const cartaoUnico = new Set(candidatas.map((c) => c.codigo)).size <= 1;

  if (!candidatas.length) {
    if (!falaDeStatus) return null;
    return { codigo: null, cartao: null, turno: null, turnoTexto: null, desde: null, haMinutos: null, motivo: null, nome: null, ehTelaStatus: true, detalhes: [] };
  }

  const cartaoDe = (c: { i: number; codigo: string }) => {
    // O cartão vai da linha do código até o próximo ponto, o quadro de ativos,
    // o botão de dispensa (último item do cartão) ou o limite de linhas.
    const linhasDoCartao: string[] = [plano[c.i]];
    for (let j = c.i + 1; j < plano.length && linhasDoCartao.length < MAX_LINHAS_CARTAO; j++) {
      const l = plano[j];
      if (RE_ULTIMO_ESCALADO.test(l) || RE_CABECALHO_LIVRO.test(l) || RE_LINHA_FILA.test(l.trim()) || /^seq\b/i.test(l.trim())) break;
      const comeco = RE_COMECA_COM_CODIGO.exec(l);
      if (comeco && `${comeco[1].toUpperCase()}${comeco[2].padStart(3, "0")}` !== c.codigo) break;
      if (RE_BOTAO_DISPENSA.test(l.trim())) break;
      linhasDoCartao.push(l);
    }

    // Situação: o selo do cartão (a situação escrita sozinha); sem ele, a
    // primeira escrita no cartão; depois, até duas linhas acima do código (selo
    // antes do número).
    let achado: { chave: TurnoPortal; texto: string } | null = null;
    for (const l of linhasDoCartao) {
      achado = turnoIsolado(l);
      if (achado) break;
    }
    if (!achado) {
      for (const l of linhasDoCartao) {
        achado = turnoDaLinha(l);
        if (achado) break;
      }
    }
    if (!achado) {
      for (let j = c.i - 1; j >= Math.max(0, c.i - 2); j--) {
        const l = plano[j];
        if (RE_ULTIMO_ESCALADO.test(l) || RE_CABECALHO_LIVRO.test(l) || codigosDaLinha(l).length) break;
        achado = turnoDaLinha(l);
        if (achado) break;
      }
    }
    return { linhasDoCartao, achado };
  };

  // O código do ponto pode aparecer antes do cartão dele (num cabeçalho, numa
  // lista): vale a primeira ocorrência que traz a situação.
  const doAlvo = alvo ? candidatas.filter((c) => c.codigo === alvo) : [];
  const ordem = doAlvo.length ? doAlvo : candidatas.filter((c) => c.codigo === candidatas[0].codigo);
  let escolhida = ordem[0];
  let lido = cartaoDe(escolhida);
  for (let k = 1; k < ordem.length && !lido.achado; k++) {
    const outro = cartaoDe(ordem[k]);
    if (outro.achado) {
      escolhida = ordem[k];
      lido = outro;
    }
  }
  const bloco = lido.linhasDoCartao;
  let turno = lido.achado;
  if (!turno && falaDeStatus && cartaoUnico) {
    for (const l of plano) {
      if (RE_LINHA_FILA.test(l.trim()) || RE_FORA_DA_FILA.test(l)) continue;
      turno = turnoDaLinha(l);
      if (turno) break;
    }
  }
  if (!turno && !falaDeStatus) return null;

  const textoBloco = bloco.join(" · ");
  // Numa tela de um ponto só, o dado pode estar fora do cartão (layout antigo).
  const achar = (re: RegExp) => re.exec(textoBloco) ?? (cartaoUnico ? re.exec(textoTodo) : null);

  // Cartão/placa: 3 letras, hífen, 4 caracteres (ABC-1D23) ou placa Mercosul.
  const cartaoM = achar(/\b([A-Z]{3}-?[0-9][A-Z0-9][0-9]{2})\b/) ?? achar(/\b([A-Z]{3}-?\d{4})\b/);
  const cartao = cartaoM ? cartaoM[1].toUpperCase() : null;

  const desdeM = achar(/(desde\s+(?:hoje|ontem|[^·]{0,24})[,]?\s*\d{1,2}[:h]\d{2})/i);
  const desde = desdeM ? desdeM[1].replace(/\s+/g, " ").trim() : null;
  // “há 9 min”, “há 2 h 27 min”, “há 3 h”.
  const haHM = achar(/h[áa]\s+(\d{1,3})\s*h(?:oras?)?\s*(?:e\s+)?(\d{1,2})\s*min/i);
  const haM = haHM ? null : achar(/h[áa]\s+(\d{1,3})\s*min/i);
  const haH = haHM || haM ? null : achar(/h[áa]\s+(\d{1,3})\s*h(?:oras?)?(?![a-zà-ú])/i);
  const haMinutos = haHM ? Number(haHM[1]) * 60 + Number(haHM[2]) : haM ? Number(haM[1]) : haH ? Number(haH[1]) * 60 : null;

  // MOTIVO: “MOTIVO · 001 - OFICINA” ou “001 - OFICINA” (código + descrição).
  const motivoM =
    achar(/motivo\s*[:·-]?\s*([0-9]{1,3}\s*[-–]\s*[^·]{2,60})/i) ?? achar(/\b([0-9]{3}\s*[-–]\s*[A-ZÀ-Ú][^·]{1,50})/);
  const motivo = motivoM ? motivoM[1].replace(/\s*[-–]\s*/, " - ").trim() : null;

  // Nome do motorista: linha em MAIÚSCULAS com 2+ palavras (evita “EM DISPENSA”).
  const pareceNome = (l: string) =>
    /^[A-ZÀ-Ú][A-ZÀ-Ú' ]{6,60}$/.test(l) &&
    l.split(/\s+/).length >= 2 &&
    !TURNOS.some((t) => t.re.test(l)) &&
    !/^(MOTIVO|DESDE|PONTO|STATUS)/.test(l);
  const nome =
    bloco.map((l) => l.trim()).find(pareceNome) ??
    (cartaoUnico ? linhas.map((l) => l.trim()).find(pareceNome) : undefined) ??
    null;

  // Demais linhas do cartão, sem o que já foi lido acima (código, placa, selo).
  const detalhes: string[] = [];
  for (let k = 0; k < bloco.length && detalhes.length < 12; k++) {
    let l = bloco[k].trim();
    if (RE_BOTAO.test(l)) continue;
    if (k === 0) {
      l = l.replace(new RegExp(RE_CODIGOS_NA_LINHA.source, "gi"), " ");
      if (cartao) l = l.split(cartao).join(" ");
    }
    if (turno) l = l.replace(new RegExp(TURNOS.find((t) => t.chave === turno!.chave)!.re.source, "gi"), " ");
    l = l.replace(/^[\s·|•\-–—:]+|[\s·|•\-–—:]+$/g, "").replace(/\s*·\s*(·\s*)+/g, " · ").replace(/\s+/g, " ").trim();
    if (l.replace(/[^0-9A-Za-zÀ-ú]/g, "").length < 3 || RE_ABA.test(l)) continue;
    if (!detalhes.includes(l)) detalhes.push(l.slice(0, 160));
  }

  return {
    codigo: escolhida.codigo,
    cartao,
    turno: turno?.chave ?? null,
    turnoTexto: turno?.texto ?? null,
    desde,
    haMinutos,
    motivo,
    nome,
    ehTelaStatus: true,
    detalhes,
  };
}

/** Frase curta do status (a mesma que o motorista recebe no aviso). */
export function fraseStatus(s: StatusPortal): string {
  const ponto = s.codigo ?? "Seu ponto";
  if (s.turno === "EM DISPENSA") {
    const motivo = s.motivo ? ` · motivo ${s.motivo}` : "";
    const tempo = s.haMinutos != null ? ` · há ${s.haMinutos} min` : "";
    return `${ponto} está EM DISPENSA${motivo}${tempo}.`;
  }
  if (s.turno === "ESCALADO") return `${ponto} foi ESCALADO (saiu para o trabalho).`;
  if (s.turno === "ATIVO") return `${ponto} está ATIVO (na fila).`;
  if (s.turno === "EM ATENDIMENTO") return `${ponto} está em atendimento (saiu para o trabalho).`;
  if (s.turno === "DESCANSANDO") return `${ponto} está em descanso.`;
  if (s.turno === "AGUARDANDO") return `${ponto} está aguardando.`;
  if (s.turno === "FORA") return `${ponto} está fora de serviço.`;
  return `${ponto}: sem situação na tela agora.`;
}

/* ==========================================================================
 * TELA DE ATIVOS (“Fila”): Livro A/B/M com Último Ponto Escalado e a fila
 *
 *   Livro A - Truck
 *   ÚLTIMO PONTO ESCALADO
 *   A102
 *   SEQ  PONTO  TIPO
 *   1    A109   TRUCK 4 EIXOS
 *   2    A115   TRUCK 4 EIXOS
 *   ...
 * ========================================================================== */

export type ItemFilaPortal = { seq: number; codigo: string; tipo: string };

export type LivroAtivosPortal = {
  livro: "A" | "B" | "M";
  /** Cabeçalho do quadro (ex.: "Livro A - Truck"). */
  titulo: string;
  ultimo: string | null;
  /** Tipo do último escalado, quando o portal escreve (ex.: "TRUCK 4 EIXOS"). */
  ultimoTipo: string | null;
  fila: ItemFilaPortal[];
  /** O aviso “Seu ponto (A032) não está na fila deste livro no momento.” */
  pontoForaDaFila: boolean;
};

const RE_LIVRO_TITULO = /livro\s+([ABM])\s*[-–·]?\s*([A-Za-zÀ-Ú ]{0,30})/i;
const RE_CODIGO_EXATO = /\b([ABM])\s?-?(\d{3})\b/i;
/** Código do portal em forma comparável: letra + 3 dígitos (A32 → A032). */
export function normalizarCodigoPortal(valor: string): string {
  const m = /([ABM])\s?-?(\d{1,4})/i.exec(valor.replace(/\s|-/g, " "));
  if (!m) return valor.replace(/[\s-]/g, "").toUpperCase();
  return `${m[1].toUpperCase()}${m[2].padStart(3, "0")}`;
}

/**
 * Interpreta um bloco como quadro de um livro (ou devolve null).
 * `cabecalhoNasLinhas`: o nome do livro pode estar nas linhas (página sem
 * títulos) — na seção normal ele tem de estar no TÍTULO, senão as abas
 * “Livro A · Livro B · Livro M” da Tela de Ativos viram quadros vazios.
 */
function interpretarLivroDeLinhas(
  tituloSecao: string,
  linhas: string[],
  cabecalhoNasLinhas = false,
): LivroAtivosPortal | null {
  const doTitulo = RE_LIVRO_TITULO.exec(tituloSecao);
  const m = doTitulo ?? (cabecalhoNasLinhas ? RE_LIVRO_TITULO.exec(linhas.slice(0, 3).join(" ")) : null);
  if (!m) return null;
  const livro = m[1].toUpperCase() as "A" | "B" | "M";

  // Tudo depois de “ÚLTIMO PONTO ESCALADO” até o começo da tabela.
  const iUltimo = linhas.findIndex((l) => /[ÚU]ltimo\s+ponto\s+escalado/i.test(l));
  const fila: ItemFilaPortal[] = [];
  let ultimo: string | null = null;
  let ultimoTipo: string | null = null;

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    // “1 · A109 · TRUCK 4 EIXOS” (a leitura de tabela já junta as colunas).
    const seqM = /^(\d{1,3})\s*[·|.\-–]\s*([A-Z]{1,3}\s?-?\d{1,4})\s*(?:[·|.\-–]\s*(.+))?$/i.exec(l);
    if (seqM) {
      fila.push({ seq: Number(seqM[1]), codigo: seqM[2].replace(/\s|-/g, "").toUpperCase(), tipo: (seqM[3] ?? "").trim() });
      continue;
    }
    // “SEQ · PONTO · TIPO” é cabeçalho de tabela: ignora.
    if (/^seq\b/i.test(l)) continue;
    const codigoSozinho = /\b([ABM])\s?-?(\d{1,4})\b/i.exec(l);
    if (!codigoSozinho) continue;
    // Mantém o código como o portal escreve (A102, M28): só a comparação normaliza.
    const codigo = `${codigoSozinho[1].toUpperCase()}${codigoSozinho[2]}`;
    // O primeiro código depois do rótulo “Último Ponto Escalado” é o último.
    if (iUltimo >= 0 && i > iUltimo && !ultimo) {
      ultimo = codigo;
      const seguinte = linhas[i + 1]?.trim();
      if (
        seguinte &&
        !/^\d/.test(seguinte) &&
        !RE_CODIGO_EXATO.test(seguinte) &&
        /truck|cavalo|carreta|eixos|ba\s?2e|bitrem|rodotrem/i.test(seguinte)
      ) {
        ultimoTipo = seguinte;
      }
    }
  }

  if (!ultimo && !fila.length) return null;
  return {
    livro,
    titulo: `Livro ${livro}${m[2]?.trim() ? ` - ${m[2].trim().replace(/\s+/g, " ")}` : ""}`,
    ultimo,
    ultimoTipo,
    fila,
    pontoForaDaFila: false,
  };
}

/**
 * Lê os quadros de ativos de uma página. Aceita o formato do app
 * (`Livro A · Truck · …`) e o da “Tela de Ativos” do portal.
 */
export function interpretarAtivos(secoes: SecaoPortal[]): LivroAtivosPortal[] {
  const livros: LivroAtivosPortal[] = [];
  for (const s of secoes) {
    // A seção só é um quadro se o TÍTULO fala de livro ou se ela traz a fila
    // (“Último Ponto Escalado” / linhas “1 · A109 · …”).
    const temFila = s.linhas.some((l) => /[ÚU]ltimo\s+ponto\s+escalado/i.test(l) || /^\d{1,3}\s*[·|.\-–]/.test(l.trim()));
    if (!RE_LIVRO_TITULO.test(s.titulo) && !temFila) continue;
    const livro = interpretarLivroDeLinhas(s.titulo, s.linhas, !RE_LIVRO_TITULO.test(s.titulo));
    if (livro) livros.push(livro);
  }
  // Um único bloco “Página” com os três livros juntos (tabela larga).
  if (!livros.length) {
    const todas = todasAsLinhas(secoes);
    let atual: { titulo: string; linhas: string[] } | null = null;
    for (const l of todas) {
      if (RE_LIVRO_TITULO.test(l)) {
        if (atual) {
          const lv = interpretarLivroDeLinhas(atual.titulo, atual.linhas, true);
          if (lv) livros.push(lv);
        }
        atual = { titulo: l, linhas: [] };
        continue;
      }
      atual?.linhas.push(l);
    }
    if (atual) {
      const lv = interpretarLivroDeLinhas(atual.titulo, atual.linhas, true);
      if (lv) livros.push(lv);
    }
  }

  // “Seu ponto (A032) não está na fila deste livro no momento.” → marca o livro
  // do código, mesmo que a mensagem tenha ficado em outra seção da página.
  for (const s of secoes) {
    for (const linha of s.linhas) {
      const m = /seu\s+ponto\s*\(?([ABM])\s?-?\d{1,4}\)?\s*n[ãa]o\s+est[áa]\s+na\s+fila/i.exec(linha);
      if (!m) continue;
      const alvo = livros.find((l) => l.livro === m[1].toUpperCase());
      if (alvo) alvo.pontoForaDaFila = true;
    }
  }
  return livros;
}

/** Onde o código está em cada quadro (1 = na vez; null = fora da fila). */
export function posicaoNoPortal(
  livros: LivroAtivosPortal[],
  codigo: string,
): { livro: LivroAtivosPortal; posicao: number; item: ItemFilaPortal } | null {
  const alvo = normalizarCodigoPortal(codigo);
  for (const livro of livros) {
    const i = livro.fila.findIndex((f) => normalizarCodigoPortal(f.codigo) === alvo);
    if (i >= 0) return { livro, posicao: i + 1, item: livro.fila[i] };
  }
  return null;
}
