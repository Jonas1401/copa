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
