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
function atributos(tag: string): Record<string, string> {
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
  const corpo = limparHtml(html);

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
 *   A032   [ADG-1J42]                       ● EM DISPENSA
 *   ⏱ Desde hoje, 11:32   há 9 min
 *   MOTIVO
 *   001 - OFICINA
 *   👤 JONAS PAULO DE SOUZA
 *   [ Sair da dispensa ]
 *
 * A leitura é por LINHAS (o texto já vem limpo do `extrairSecoes`), então
 * continua valendo se o portal trocar o HTML por outro layout.
 * ========================================================================== */

export type TurnoPortal = "EM DISPENSA" | "EM ATENDIMENTO" | "DESCANSANDO" | "AGUARDANDO" | "FORA";

export type StatusPortal = {
  /** Código do ponto mostrado na tela (ex.: A032). */
  codigo: string | null;
  /** Cartão/veículo ao lado do ponto (ex.: ADG-1J42). */
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
};

/** Código de ponto no padrão do portal: uma letra de livro + 3 dígitos (A032). */
const RE_CODIGO = /\b([ABM])\s?-?(\d{3})\b/i;

/** Turnos que o portal escreve em maiúsculas no alto do cartão. */
const TURNOS: { chave: TurnoPortal; re: RegExp }[] = [
  { chave: "EM DISPENSA", re: /\bEM\s+DISPENSA\b/i },
  { chave: "EM ATENDIMENTO", re: /\bEM\s+ATENDIMENTO\b/i },
  { chave: "DESCANSANDO", re: /\bDESCANSANDO\b/i },
  { chave: "AGUARDANDO", re: /\bAGUARDANDO\b/i },
  { chave: "FORA", re: /\b(fora\s+de\s+servi[cç]o|sem\s+ponto)\b/i },
];

/** Ruídos que a leitura de seções deixa na frente dos valores. */
const limparValor = (linha: string) =>
  linha
    .replace(/^[\s·|•\-–—]+/, "")
    .replace(/\b(desde|motivo|ponto|semana|ticket)\b\s*[:·-]?\s*/gi, (m) => (m.trim().length === 0 ? m : ""))
    .trim();

/**
 * Interpreta a tela de status a partir das linhas da página.
 * Devolve `null`-safe: nada de exceção — campo que não veio fica `null`.
 */
export function interpretarStatus(secoes: SecaoPortal[]): StatusPortal | null {
  const linhas = todasAsLinhas(secoes);
  const texto = linhas.join(" · ");
  const tituloPagina = secoes.map((s) => s.titulo).join(" ");
  const ehTelaStatus = /status\s+do\s+ponto/i.test(`${tituloPagina} ${texto}`) || TURNOS.some((t) => t.re.test(texto));
  if (!ehTelaStatus) return null;

  // Código do ponto: a primeira ocorrência no texto (o cartão vem logo depois).
  const codigoM = RE_CODIGO.exec(texto);
  const codigo = codigoM ? `${codigoM[1].toUpperCase()}${codigoM[2]}` : null;

  // Cartão/placa: 3 letras, hífen, 4 caracteres (ADG-1J42) ou placa Mercosul.
  const cartaoM = /\b([A-Z]{3}-?[0-9][A-Z0-9][0-9]{2})\b/.exec(texto) ?? /\b([A-Z]{3}-?\d{4})\b/.exec(texto);
  const cartao = cartaoM ? cartaoM[1].toUpperCase() : null;

  let turno: TurnoPortal | null = null;
  let turnoTexto: string | null = null;
  for (const t of TURNOS) {
    const m = texto.match(t.re);
    if (m) {
      turno = t.chave;
      turnoTexto = m[0].toUpperCase();
      break;
    }
  }

  const desdeM = /(desde\s+(?:hoje|ontem|[^·]{0,24})[,]?\s*\d{1,2}[:h]\d{2})/i.exec(texto);
  const desde = desdeM ? desdeM[1].replace(/\s+/g, " ").trim() : null;
  const haM = /h[áa]\s+(\d{1,3})\s*min/i.exec(texto);
  const haMinutos = haM ? Number(haM[1]) : null;

  // MOTIVO: “MOTIVO · 001 - OFICINA” ou “001 - OFICINA” (código + descrição).
  const motivoM = /motivo\s*[:·-]?\s*([0-9]{1,3}\s*[-–]\s*[^·]{2,60})/i.exec(texto) ?? /\b([0-9]{3}\s*[-–]\s*[A-ZÀ-Ú][^·]{1,50})/.exec(texto);
  const motivo = motivoM ? motivoM[1].replace(/\s*[-–]\s*/, " - ").trim() : null;

  // Nome do motorista: linha em MAIÚSCULAS com 2+ palavras (evita “EM DISPENSA”).
  const nome =
    linhas
      .map((l) => l.trim())
      .find(
        (l) =>
          /^[A-ZÀ-Ú][A-ZÀ-Ú' ]{6,60}$/.test(l) &&
          l.split(/\s+/).length >= 2 &&
          !TURNOS.some((t) => t.re.test(l)) &&
          !/^(MOTIVO|DESDE|PONTO|STATUS)/.test(l),
      ) ?? null;

  return { codigo, cartao, turno, turnoTexto, desde, haMinutos, motivo, nome, ehTelaStatus: true };
}

/** Frase curta do status (a mesma que o motorista recebe no aviso). */
export function fraseStatus(s: StatusPortal): string {
  const ponto = s.codigo ?? "Seu ponto";
  if (s.turno === "EM DISPENSA") {
    const motivo = s.motivo ? ` · motivo ${s.motivo}` : "";
    const tempo = s.haMinutos != null ? ` · há ${s.haMinutos} min` : "";
    return `${ponto} está EM DISPENSA${motivo}${tempo}.`;
  }
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
