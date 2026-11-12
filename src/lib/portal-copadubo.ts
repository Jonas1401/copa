import { and, asc, desc, eq, sql } from "drizzle-orm";
import { comBanco, temBancoConfigurado } from "@/db";
import { db } from "@/db";
import {
  motoristas,
  pontos,
  portalEventos,
  portalFila,
  portalLeituras,
  portalMotoristaAcessos,
  portalSaidasPendentes,
  portalSituacoes,
  portalTicketConfig,
  portalTicketPorcentagens,
  portalTickets,
} from "@/db/schema";
import { cifrarParaColuna, decifrarDeColuna } from "@/lib/admin/segredos";
import { enviarPush } from "@/lib/push";
import { SessaoPortal, type PedidoPortal, type RespostaPortal } from "@/lib/portal-sessao";
import {
  analisarPortal,
  cpfPlausivel,
  destinoDeRedirecionamentoNaPagina,
  interpretarAtivos,
  interpretarStatus,
  escolherFormularioLogin,
  extrairLinksMenu,
  extrairSecoes,
  hashConteudo,
  hashEstavel,
  limparCpf,
  linhasAlteradas,
  linhasDeInteresse,
  destinoProibido,
  enderecoDeAcao,
  extrairEscolhaDePonto,
  montarCorpoEscolha,
  montarCorpoLogin,
  normalizarCodigoPortal,
  pareceMontadaPorScript,
  resolverUrl,
  resumoFormularios,
  type EscolhaDePonto,
  type FormularioPortal,
  type LinkPortal,
  type LivroAtivosPortal,
  type SecaoPortal,
  type StatusPortal,
} from "@/lib/portal-copadubo-parse";
import {
  amostraDaTela,
  extrairLinksDeLivro,
  interpretarFilaDoPortal,
  quadrosDoLivro,
  resumoDoLivro,
  type FilaDoPortal,
  type LivroDaFila,
  type LivroLido,
} from "@/lib/portal-fila-parse";
import {
  diaMes,
  ehAbaDoTicket,
  extrairFormularioDeTicket,
  hojeEmBrasilia,
  interpretarTickets,
  juntarLancamentos,
  montarPedidoDeTicket,
  semanaDeHoje,
  type FormularioDeTicket,
  type LancamentoDoTicket,
} from "@/lib/portal-ticket-parse";

/**
 * Monitoramento do PORTAL DO MOTORISTA da Copadubo (`portal.copadubo.com.br`).
 *
 * O motorista cadastra o PRÓPRIO CPF e a senha dentro do aplicativo. Os dois
 * ficam cifrados (AES-256-GCM, mesma chave mestra do cofre de API Keys) e são
 * usados por ESTE módulo apenas para:
 *   1. abrir a área do motorista, que leva à tela de login, e descobrir
 *      sozinho os nomes dos campos;
 *   2. ENVIAR o login e conferir que a sessão abriu de verdade;
 *   3. abrir a tela de status (e as abas que o próprio menu informa);
 *   4. transformar cada tela em seções/linhas (leitura genérica);
 *   5. guardar um resumo por leitura e a situação de cada ponto (ATIVO /
 *      ESCALADO / EM DISPENSA) — é a troca dela que avisa o motorista.
 *
 * Regras de segurança que este arquivo NÃO abre exceção:
 *   - a senha nunca é devolvida para o navegador, nem para o /admin (só o CPF
 *     mascarado e os 4 últimos caracteres da senha);
 *   - a senha nunca vai para log, auditoria, aviso ou IA;
 *   - CPF e senha só são enviados para o endereço do próprio portal;
 *   - o leitor só OLHA: abre telas e abas de navegação, nunca um botão ou link
 *     de ação (“Sair da dispensa”, “Entrar em dispensa”…). Além do login, a
 *     única coisa que ele ENVIA é a escolha do ponto em “Trocar Ponto” (a lista
 *     de pontos da conta + “Confirmar”): o portal mostra o Status de um ponto
 *     por vez, e só é escolhido um ponto que o motorista cadastrou no app;
 *     e, para quem ligou o “Saldo de Ganhos”, a consulta da aba “Ticket” (a
 *     lista de pontos + a lista de semanas + “Gerar”), que só mostra as viagens
 *     — o “Gerar PDF” nunca é aberto;
 *   - o conteúdo lido é do PRÓPRIO motorista e só ele (e o administrador,
 *     para diagnóstico) vê. A exceção é a aba “Fila” (a Tela de Ativos): é a
 *     fila geral, igual para todos, e alimenta o card, a posição e os avisos
 *     de vez de todos os motoristas (`lerFilaNaSessaoGuardada`). Dela só se
 *     guarda a fila — nada da conta de quem abriu a tela;
 *   - a sessão aberta no portal fica guardada CIFRADA (como a senha) para a
 *     leitura de minuto em minuto ser um pedido só; o login só se repete
 *     quando o portal encerra a sessão — e, se ele a encerrar a toda hora, no
 *     máximo um login automático a cada 10 min (`esperaParaLoginAutomatico`).
 *     O cookie nunca vai para log, diagnóstico ou navegador;
 *   - login recusado duas vezes seguidas PAUSA o acesso, para a conta do
 *     motorista não ser bloqueada por tentativas repetidas.
 */

export const PORTAL_BASE = "https://portal.copadubo.com.br";
/** Área do motorista: sem sessão, o portal manda daqui para a tela de login. */
export const CAMINHO_AREA = "moto/";
/** Tela “Status do Ponto”, dentro da área do motorista. */
export const CAMINHO_STATUS = "moto/status";
export const PORTAL_STATUS = `${PORTAL_BASE}/${CAMINHO_STATUS}`;
export const PORTAL_LOGIN = `${PORTAL_BASE}/login`;

/**
 * Intervalo mínimo entre leituras PERIÓDICAS do mesmo motorista. Cada leitura
 * é um login de verdade na conta dele, então ela só acontece enquanto um ponto
 * do motorista está fora do quadro (ver `motoristasComLeituraDevida`).
 */
export const INTERVALO_LEITURA_MS = 10 * 60_000;
/** Por quantas horas, depois da saída do quadro, a leitura periódica continua. */
export const JANELA_LEITURA_APOS_SAIDA_H = 6;
/** Depois de 3 falhas seguidas, a leitura periódica espera este tempo. */
const ESPERA_APOS_FALHAS_MS = 30 * 60_000;
/** Recusas de login seguidas que pausam o acesso do motorista. */
export const RECUSAS_PARA_PAUSAR = 2;
/** Cota de avisos: no máximo 6 por hora e 20 por dia, por motorista. */
const AVISO_MIN_MS = 10 * 60_000;
const AVISO_MAX_HORA = 6;
const AVISO_MAX_DIA = 20;
/** Abas do menu abertas, no máximo, numa mesma visita ao portal. */
const MAX_ABAS = 4;
/** Máximo de escolhas de ponto (“Trocar Ponto”) numa mesma visita. */
const MAX_TROCAS_DE_PONTO = 6;

/** Códigos pedidos, como o portal escreve (A032), sem repetição. */
function codigosPedidos(opcoes: { codigo?: string | null; codigos?: string[] }): string[] {
  const lista = opcoes.codigos?.length ? opcoes.codigos : opcoes.codigo ? [opcoes.codigo] : [];
  return [...new Set(lista.map((c) => normalizarCodigoPortal(c)).filter(Boolean))];
}

/**
 * As seções mostram a SITUAÇÃO do ponto pedido? Com um código, tem de ser o
 * cartão DELE: o portal mostra um ponto por vez, e o cartão de outro não vale.
 */
export function mostraSituacao(secoes: SecaoPortal[], codigo: string | null): boolean {
  const status = interpretarStatus(secoes, codigo);
  return Boolean(status?.turno) && (!codigo || status?.codigo === codigo);
}

/** Endereço do portal, trocável por ambiente (teste/homologação). */
export function urlPortal(caminho: string = CAMINHO_STATUS): string {
  // `||` e não `??`: a variável criada VAZIA no painel da hospedagem vale o padrão.
  const configurada = (process.env.PORTAL_MOTORISTA_URL || "").trim();
  const base = (configurada || PORTAL_BASE).replace(/\/+$/, "").replace(/\/moto$/i, "");
  if (!caminho) return base;
  return `${base}/${caminho.replace(/^\/+/, "")}`;
}

export type CredenciaisPortal = { cpf: string; senha: string };

export type LeituraPortal = {
  ok: boolean;
  /** O portal recusou o login (CPF/senha). */
  loginRecusado: boolean;
  /** O portal pediu captcha: não dá para entrar por HTTP. */
  captcha: boolean;
  /** A página de status voltou mas veio vazia/incompleta. */
  vazia: boolean;
  statusHttp: number | null;
  urlFinal: string | null;
  titulo: string;
  secoes: SecaoPortal[];
  totalLinhas: number;
  hash: string;
  /** Linhas que falam do dia a dia (chamada, fila, status…). */
  sinais: string[];
  /** Linhas que mudaram em relação à leitura anterior. */
  novas: string[];
  /** Falhou nesta leitura E na anterior: vale avisar (não é piscada). */
  avisoPreciso: boolean;
  removidas: string[];
  /** Diagnóstico legível (nunca inclui CPF, senha ou cookies). */
  diagnostico: string[];
  ms: number;
  /** Conteúdo da página só para IA/administrador (não vai para o celular). */
  texto: string;
  /** Esta leitura ENVIOU um login (não reaproveitou a sessão guardada). */
  fezLogin?: boolean;
  /** O freio entre logins segurou a leitura: quando vale tentar de novo. */
  tentarEmMs?: number;
};

export type ResultadoLogin =
  | { ok: true; sessao: SessaoPortal; pagina: RespostaPortal; diagnostico: string[] }
  | { ok: false; leitura: LeituraPortal };

function leituraFalha(motivo: string, extra: Partial<LeituraPortal> = {}): LeituraPortal {
  return {
    ok: false,
    loginRecusado: false,
    captcha: false,
    vazia: false,
    statusHttp: null,
    urlFinal: null,
    titulo: "",
    secoes: [],
    totalLinhas: 0,
    hash: "",
    sinais: [],
    novas: [],
    removidas: [],
    avisoPreciso: true,
    diagnostico: [motivo],
    ms: 0,
    texto: "",
    ...extra,
  };
}

const pareceErroDeCredencial = (html: string) =>
  /senha\s+(inv[áa]lida|incorreta)|usu[áa]rio\s+(inv[áa]lido|n[ãa]o)|login\s+inv[áa]lido|dados\s+incorretos|cpf\s+ou\s+senha|credenciais|n[ãa]o\s+encontrad|falha\s+no\s+login|e-?mail\s+ou\s+cpf/i.test(
    html.replace(/<[^>]+>/g, " "),
  );

/** Caminho de um endereço do portal para o diagnóstico: sem domínio e sem parâmetros. */
function caminhoDe(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+/, "") || "início";
  } catch {
    return "?";
  }
}

/**
 * Formulário de ENTRADA do portal: o que tem uma senha só. Um “trocar senha”
 * dentro da área logada (duas ou três senhas) não é a tela de login.
 */
function formularioDeEntrada(html: string): FormularioPortal | null {
  const formulario = escolherFormularioLogin(html);
  if (!formulario) return null;
  return formulario.campos.filter((c) => c.tipo === "password").length <= 1 ? formulario : null;
}

/**
 * Abre uma página do portal. Se ela vier sem texto e mandar o navegador para
 * outro endereço pelo HTML (`meta refresh` / `location.href`), segue também.
 */
async function abrir(sessao: SessaoPortal, url: string, pedido?: PedidoPortal): Promise<RespostaPortal> {
  let resposta = await sessao.pedir(url, pedido);
  for (let n = 0; n < 2 && resposta.ok && resposta.status < 400; n += 1) {
    if (extrairSecoes(resposta.html).totalLinhas > 0) break;
    const destino = destinoDeRedirecionamentoNaPagina(resposta.html, resposta.url);
    if (!destino || destino === resposta.url || !sessao.mesmoSite(destino)) break;
    resposta = await sessao.pedir(destino, { referer: resposta.url });
  }
  return resposta;
}

/**
 * Entra no portal com CPF + senha e devolve a sessão aberta.
 *
 * Passos: GET na área do motorista (que redireciona ao login) → descobre o
 * formulário pelo campo de senha → POST com os nomes REAIS dos campos → confere
 * se a resposta ainda é a tela de login.
 *
 * Só existe “Login aceito” depois do POST: uma página qualquer que responda
 * sem pedir senha (um 404, por exemplo) NÃO é a área do motorista.
 */
export async function entrarNoPortal(
  credenciais: CredenciaisPortal,
  opcoes: { buscar?: typeof fetch; inicio?: string; /** Chamado quando o login vai ser ENVIADO. */ aoEnviar?: () => void } = {},
): Promise<ResultadoLogin> {
  const sessao = new SessaoPortal(opcoes.buscar ?? fetch, urlPortal(""));
  const inicio = opcoes.inicio ?? urlPortal(CAMINHO_AREA);

  let pagina = await abrir(sessao, inicio);
  if (!pagina.ok) {
    return { ok: false, leitura: leituraFalha(`Sem resposta do portal: ${(pagina.erro ?? "falha de rede").slice(0, 120)}`) };
  }
  if (pagina.status >= 500) {
    return { ok: false, leitura: leituraFalha(`Portal respondeu ${pagina.status}.`, { statusHttp: pagina.status, urlFinal: pagina.url }) };
  }

  let formulario = formularioDeEntrada(pagina.html);
  if (!formulario) {
    // A área do motorista não levou ao login: tenta a tela de login do portal.
    const login = await abrir(sessao, urlPortal("login"));
    const doLogin = login.ok && login.status < 400 ? formularioDeEntrada(login.html) : null;
    if (doLogin) {
      formulario = doLogin;
      pagina = login;
    }
  }
  if (!formulario) {
    return {
      ok: false,
      leitura: leituraFalha(
        `Não encontrei o formulário de login na página (${caminhoDe(pagina.url)} respondeu HTTP ${pagina.status}).`,
        { statusHttp: pagina.status, urlFinal: pagina.url },
      ),
    };
  }
  if (formulario.temCaptcha) {
    return {
      ok: false,
      leitura: leituraFalha("O portal pediu captcha neste acesso — a leitura automática não consegue passar por ele.", {
        captcha: true,
        avisoPreciso: false,
        statusHttp: pagina.status,
        urlFinal: pagina.url,
      }),
    };
  }
  const temUsuario = formulario.campos.some((c) => c.tipo !== "hidden" && !/senha|password|passwd/i.test(`${c.nome} ${c.id} ${c.rotulo}`));
  if (!temUsuario) {
    return { ok: false, leitura: leituraFalha("O formulário de login não tem campo de usuário reconhecível.", { urlFinal: pagina.url }) };
  }

  const acao = resolverUrl(pagina.url, formulario.action);
  if (!sessao.mesmoSite(acao)) {
    // CPF e senha só saem daqui para o próprio portal.
    return { ok: false, leitura: leituraFalha("O formulário de login aponta para outro site — nada foi enviado.", { urlFinal: pagina.url }) };
  }
  const corpo = montarCorpoLogin(formulario, credenciais);
  opcoes.aoEnviar?.();
  const envio = await abrir(sessao, acao, { metodo: "POST", corpo: corpo.toString(), referer: pagina.url });

  if (!envio.ok) {
    return { ok: false, leitura: leituraFalha(`Envio do login falhou: ${(envio.erro ?? "falha de rede").slice(0, 120)}`) };
  }
  if (envio.status >= 500) {
    return {
      ok: false,
      leitura: leituraFalha(`O portal respondeu ${envio.status} ao receber o login.`, { statusHttp: envio.status, urlFinal: envio.url }),
    };
  }

  // Voltou com formulário de senha → a sessão não abriu (credencial recusada).
  // Sem formulário e com a página cheia, entrou de verdade: a mensagem de erro
  // só é considerada quando a página veio SEM conteúdo (evita falso positivo
  // de uma página logada que apenas fala de "senha" no menu).
  const formularioDepois = formularioDeEntrada(envio.html);
  const analiseDepois = analisarPortal(envio.html);
  const erroNaPagina = pareceErroDeCredencial(envio.html);
  const recusado = (motivo: string, resposta: RespostaPortal): ResultadoLogin => ({
    ok: false,
    leitura: leituraFalha(motivo, { loginRecusado: true, avisoPreciso: false, statusHttp: resposta.status, urlFinal: resposta.url }),
  });
  if (formularioDepois || (analiseDepois.totalLinhas === 0 && erroNaPagina)) {
    return recusado(
      erroNaPagina || analiseDepois.totalLinhas === 0
        ? "O portal recusou o CPF/senha cadastrados."
        : "Depois do login o portal voltou para a tela de entrada (sessão não abriu).",
      envio,
    );
  }
  // Erro HTTP ao receber o login (404, 403, 419…) não é a área do motorista —
  // e também não prova que a senha está errada: é falha, sem contar recusa.
  if (envio.status >= 400) {
    return {
      ok: false,
      leitura: leituraFalha(
        `O portal respondeu ${envio.status} ao receber o login (${caminhoDe(envio.url)}).`,
        { statusHttp: envio.status, urlFinal: envio.url },
      ),
    };
  }
  // Resposta em branco: só vale como login se a área do motorista abrir agora.
  if (analiseDepois.totalLinhas === 0) {
    const area = await abrir(sessao, inicio, { referer: envio.url });
    if (!area.ok) {
      return { ok: false, leitura: leituraFalha(`Sem resposta do portal depois do login: ${(area.erro ?? "falha de rede").slice(0, 120)}`) };
    }
    if (formularioDeEntrada(area.html)) {
      return recusado("Depois do login o portal voltou para a tela de entrada (sessão não abriu).", area);
    }
    if (area.status >= 400) {
      return {
        ok: false,
        leitura: leituraFalha(
          `Depois do login, a área do motorista respondeu ${area.status} (${caminhoDe(area.url)}).`,
          { statusHttp: area.status, urlFinal: area.url },
        ),
      };
    }
    return { ok: true, sessao, pagina: area, diagnostico: ["Login aceito pelo portal."] };
  }

  return { ok: true, sessao, pagina: envio, diagnostico: ["Login aceito pelo portal."] };
}

export type TelaLida = {
  /** Caminho da tela no portal (sem domínio e sem parâmetros). */
  caminho: string;
  url: string;
  titulo: string;
  secoes: SecaoPortal[];
  totalLinhas: number;
  statusHttp: number;
};

export type TelasDoMotorista = {
  ok: boolean;
  loginRecusado: boolean;
  captcha: boolean;
  telas: TelaLida[];
  diagnostico: string[];
  /** Esta visita ENVIOU um login (não reaproveitou a sessão guardada). */
  fezLogin?: boolean;
};

type VisitaAoPortal = TelasDoMotorista & { falha: LeituraPortal | null };

/**
 * O que fica guardado (cifrado) entre uma leitura e outra do mesmo motorista:
 * a sessão aberta no portal. Com ela, olhar o Status é UM pedido — o login só
 * se repete quando o portal encerra a sessão.
 */
export type SessaoGuardada = {
  /** Cookies da sessão aberta no portal. */
  cookies: Record<string, string>;
  /** Endereço em que a tela de Status foi encontrada (a leitura vai direto a ele). */
  statusUrl: string | null;
  /** Endereço da aba “Fila” (a Tela de Ativos), como o menu do portal informou. */
  filaUrl?: string | null;
  /** Endereço da aba “Ticket” (a 2ª Via de Ticket), como o menu do portal informou. */
  ticketUrl?: string | null;
  /** Momento (ms) dos últimos logins ENVIADOS (o último é a referência do freio). */
  logins: number[];
  /**
   * Momento (ms) do último login enviado que NÃO abriu a sessão (senha
   * recusada, resposta que não deu para entender). Vazio depois de um login
   * aceito.
   */
  falhouEm: number | null;
  /** Fichas do freio que sobraram logo depois do último login enviado. */
  fichas: number;
};

/** Logins automáticos que podem acontecer em seguida antes de o freio segurar. */
export const LOGINS_SEGUIDOS = 2;
/** Depois deles, um login automático a cada 10 min (uma ficha do freio volta nesse tempo). */
const INTERVALO_FREIO_LOGINS_MS = 10 * 60_000;

export const sessaoVazia = (): SessaoGuardada => ({
  cookies: {},
  statusUrl: null,
  filaUrl: null,
  ticketUrl: null,
  logins: [],
  falhouEm: null,
  fichas: LOGINS_SEGUIDOS,
});

/** O link do menu é o da aba “Fila” (a Tela de Ativos). */
export const ehAbaDaFila = (texto: string) => /^(filas?|ativos|tela de ativos)$/i.test(texto.trim());

/** Fichas do freio disponíveis agora: cabem `LOGINS_SEGUIDOS`; volta uma a cada `intervaloMs`. */
function fichasDoFreio(sessao: SessaoGuardada, intervaloMs: number, agora: number): number {
  const anteriores = sessao.logins.filter((t) => t <= agora);
  if (!anteriores.length) return LOGINS_SEGUIDOS;
  const sobraram = Number.isFinite(sessao.fichas) ? Math.max(0, sessao.fichas) : 0;
  return Math.min(LOGINS_SEGUIDOS, sobraram + (agora - Math.max(...anteriores)) / intervaloMs);
}

/**
 * FREIO DOS LOGINS AUTOMÁTICOS — quanto falta (ms) para a leitura periódica
 * poder enviar um login nesta conta; 0 = pode agora.
 *
 * Com a sessão guardada o login é raro: só quando o portal a encerra. O freio
 * existe para o caso ruim, sem deixar o ponto sem leitura no caso comum:
 *
 *   - o portal encerrou a sessão (o site reiniciou, o motorista entrou no
 *     portal pelo celular…): a leitura seguinte entra de novo NA HORA — até
 *     `LOGINS_SEGUIDOS` logins em seguida;
 *   - o portal continua derrubando a sessão: daí em diante, um login a cada
 *     `intervaloMs` (10 min). A leitura de minuto em minuto nunca vira um
 *     login por minuto na conta do motorista;
 *   - o último login NÃO abriu a sessão (senha recusada, resposta que não deu
 *     para entender): espera `intervaloMs` antes de tentar outro.
 *
 * É um balde de fichas: cabem `LOGINS_SEGUIDOS`, cada login gasta uma
 * (`registrarLoginEnviado`) e uma ficha volta a cada `intervaloMs`. O login
 * pedido por uma pessoa (“Ler agora”) não espera o freio, mas gasta ficha.
 */
export function esperaParaLoginAutomatico(sessao: SessaoGuardada, intervaloMs: number, agora = Date.now()): number {
  if (!(intervaloMs > 0)) return 0;
  if (sessao.falhouEm != null && sessao.falhouEm <= agora) {
    const falta = sessao.falhouEm + intervaloMs - agora;
    if (falta > 0) return falta;
  }
  const fichas = fichasDoFreio(sessao, intervaloMs, agora);
  return fichas >= 1 ? 0 : Math.ceil((1 - fichas) * intervaloMs);
}

/**
 * Anota na sessão guardada um login ENVIADO agora: gasta uma ficha do freio e,
 * até a sessão abrir, o login conta como “não abriu a conta” (quem chama limpa
 * `falhouEm` quando o portal aceita).
 */
export function registrarLoginEnviado(sessao: SessaoGuardada, agora = Date.now(), intervaloMs = INTERVALO_FREIO_LOGINS_MS) {
  sessao.fichas = Math.max(0, fichasDoFreio(sessao, intervaloMs, agora) - 1);
  sessao.logins = [...sessao.logins.filter((t) => agora - t < 3_600_000), agora].slice(-12);
  sessao.falhouEm = agora;
}

type OpcoesVisita = {
  buscar?: typeof fetch;
  extras?: string[];
  ateOStatus?: boolean;
  codigo?: string | null;
  /**
   * Todos os pontos do motorista (A032…). O portal mostra o Status de um ponto
   * por vez: a visita escolhe cada um em “Trocar Ponto” e lê o Status dele.
   */
  codigos?: string[];
  /** Sessão guardada do motorista: a visita USA e ATUALIZA este objeto. */
  sessao?: SessaoGuardada | null;
  /**
   * Intervalo do freio dos logins AUTOMÁTICOS na mesma conta (ver
   * `esperaParaLoginAutomatico`); 0 = sem freio: leitura pedida por uma
   * pessoa. Só vale junto com `sessao`.
   */
  esperaEntreLoginsMs?: number;
};

/**
 * UMA visita ao portal: as telas da área do motorista.
 *
 * Com uma sessão guardada, começa direto pela tela de Status — sem login. O
 * login só acontece quando não há sessão ou quando o portal a encerrou (a
 * página pedida volta como tela de login), e respeita o freio
 * `esperaEntreLoginsMs` para a conta do motorista não receber um login atrás do
 * outro se o portal estiver derrubando a sessão.
 *
 * Ordem das telas: a página em que a visita caiu → a tela de status → os
 * caminhos extras do administrador → as abas que o menu do portal informa
 * (Ponto, Status, Ticket, Fila). Nenhum caminho é adivinhado: o que não está
 * aqui vem do menu.
 *
 * O portal mostra o Status de UM ponto por vez — o escolhido na tela “Trocar
 * Ponto” (uma lista com os pontos da conta e o botão “Confirmar”). Para cada
 * ponto pedido que não apareceu na tela de Status, a visita faz essa escolha e
 * lê o Status de novo. É a única coisa que ela envia além do login.
 *
 * `ateOStatus`: para assim que a situação do ponto for lida (leitura periódica:
 * menos pedidos ao portal).
 */
async function visitarPortal(credenciais: CredenciaisPortal, opcoes: OpcoesVisita = {}): Promise<VisitaAoPortal> {
  const buscar = opcoes.buscar ?? fetch;
  const guardada = opcoes.sessao ?? null;
  const diagnostico: string[] = [];
  let fezLogin = false;
  const falhou = (leitura: LeituraPortal): VisitaAoPortal => {
    const linhas = [...diagnostico, ...leitura.diagnostico];
    return {
      ok: false,
      loginRecusado: leitura.loginRecusado,
      captcha: leitura.captcha,
      telas: [],
      diagnostico: linhas,
      falha: { ...leitura, diagnostico: linhas, fezLogin },
      fezLogin,
    };
  };
  const alvos = codigosPedidos(opcoes);
  const mostraAlgum = (secoes: SecaoPortal[]) => (alvos.length ? alvos.some((c) => mostraSituacao(secoes, c)) : mostraSituacao(secoes, null));
  // “É a tela de Status?” — o cartão de QUALQUER ponto responde: a sessão vale e
  // a tela foi achada. Se o cartão é de outro ponto, quem resolve é “Trocar Ponto”.
  const temSituacaoEm = (html: string) => mostraSituacao(analisarPortal(html).secoes, null);

  let sessao: SessaoPortal | null = null;
  /** Páginas já abertas antes da descoberta das telas, com o rótulo do diagnóstico. */
  const iniciais: { resposta: RespostaPortal; rotulo: string }[] = [];

  // 1) Sessão guardada: vai direto à tela de Status, sem login.
  if (guardada && Object.keys(guardada.cookies).length) {
    const candidata = new SessaoPortal(buscar, urlPortal(""), { cookies: guardada.cookies });
    const alvo = guardada.statusUrl && candidata.mesmoSite(guardada.statusUrl) ? guardada.statusUrl : urlPortal(CAMINHO_STATUS);
    const abertas: { resposta: RespostaPortal; rotulo: string }[] = [];
    let vencida = false;
    const pagina = await abrir(candidata, alvo);
    // Portal fora do ar não é motivo para um login novo: a sessão continua guardada.
    if (!pagina.ok) {
      return falhou(leituraFalha(`Sem resposta do portal: ${(pagina.erro ?? "falha de rede").slice(0, 120)}`));
    }
    if (pagina.status >= 500) {
      return falhou(leituraFalha(`Portal respondeu ${pagina.status}.`, { statusHttp: pagina.status, urlFinal: pagina.url }));
    }
    if (formularioDeEntrada(pagina.html)) {
      vencida = true;
    } else {
      abertas.push({ resposta: pagina, rotulo: `Sessão guardada (${caminhoDe(pagina.url)})` });
      if (pagina.status >= 400 || !temSituacaoEm(pagina.html)) {
        // O endereço guardado não mostrou a situação: recomeça pela área do
        // motorista, que tem o menu — e é onde uma sessão vencida aparece.
        const area = await abrir(candidata, urlPortal(CAMINHO_AREA));
        if (!area.ok) {
          return falhou(leituraFalha(`Sem resposta do portal: ${(area.erro ?? "falha de rede").slice(0, 120)}`));
        }
        if (area.status >= 500) {
          return falhou(leituraFalha(`Portal respondeu ${area.status}.`, { statusHttp: area.status, urlFinal: area.url }));
        }
        if (formularioDeEntrada(area.html)) vencida = true;
        else abertas.push({ resposta: area, rotulo: `Área do motorista (${caminhoDe(area.url)})` });
      }
    }
    if (vencida) {
      diagnostico.push("A sessão guardada venceu: o portal pediu o login de novo.");
      guardada.cookies = {};
    } else {
      sessao = candidata;
      iniciais.push(...abertas);
      diagnostico.push("Sessão guardada reaproveitada: nenhum login nesta leitura.");
    }
  }

  // 2) Sem sessão válida: login, respeitando o freio dos logins automáticos.
  if (!sessao) {
    const espera = opcoes.esperaEntreLoginsMs ?? 0;
    if (guardada && espera > 0) {
      const falta = esperaParaLoginAutomatico(guardada, espera);
      if (falta > 0) {
        const motivo =
          guardada.falhouEm != null && Date.now() - guardada.falhouEm < espera
            ? "o último login não abriu a conta"
            : "os últimos logins nesta conta foram há pouco";
        return falhou(
          leituraFalha(
            `Sem sessão aberta no portal, e ${motivo}: novo login automático em ${Math.max(1, Math.ceil(falta / 60_000))} min (freio para não bloquear a conta do motorista).`,
            { avisoPreciso: false, tentarEmMs: falta },
          ),
        );
      }
    }
    const entrada = await entrarNoPortal(credenciais, {
      buscar,
      aoEnviar: () => {
        fezLogin = true;
        if (guardada) registrarLoginEnviado(guardada);
      },
    });
    if (!entrada.ok) {
      if (guardada) guardada.cookies = {};
      return falhou(entrada.leitura);
    }
    if (guardada) guardada.falhouEm = null;
    sessao = entrada.sessao;
    diagnostico.push(...entrada.diagnostico);
    iniciais.push({ resposta: entrada.pagina, rotulo: `Depois do login (${caminhoDe(entrada.pagina.url)})` });
  }

  const telas: TelaLida[] = [];
  const abas: LinkPortal[] = [];
  /** Links com nome de aba cujo endereço parece uma ação (nunca abertos). */
  const abasIgnoradas: LinkPortal[] = [];
  const pedidos = new Set<string>();
  const guardadas = new Set<string>();
  const visita = sessao;
  const chaveDe = (url: string) => {
    try {
      const u = new URL(url);
      return `${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    } catch {
      return url;
    }
  };
  /** A tela de Status já foi achada (o cartão de qualquer ponto): não há por que abrir mais abas. */
  const temSituacao = () => telas.some((t) => mostraSituacao(t.secoes, null));
  const mostraNasTelas = (codigo: string) => telas.some((t) => mostraSituacao(t.secoes, codigo));
  /** HTML das páginas abertas nesta visita: é onde o formulário de “Trocar Ponto” é procurado. */
  const paginas: { url: string; html: string }[] = [];

  /** `marca`: a mesma tela lida de novo depois de escolher outro ponto é OUTRA leitura. */
  const guardar = (r: RespostaPortal, rotulo: string, marca = "") => {
    if (!r.ok) {
      diagnostico.push(`${rotulo}: sem resposta (${(r.erro ?? "falha").slice(0, 80)}).`);
      return;
    }
    if (r.status === 404) {
      diagnostico.push(`${rotulo}: não existe neste portal (404).`);
      return;
    }
    if (r.status >= 400) {
      diagnostico.push(`${rotulo}: o portal respondeu ${r.status}.`);
      return;
    }
    if (formularioDeEntrada(r.html)) {
      diagnostico.push(`${rotulo}: pediu login de novo.`);
      return;
    }
    // Para achar o formulário de “Trocar Ponto” vale sempre a cópia MAIS NOVA
    // da página: um campo escondido pode mudar a cada vez que ela é servida.
    const repetida = paginas.findIndex((x) => chaveDe(x.url) === chaveDe(r.url));
    if (repetida >= 0) paginas.splice(repetida, 1);
    paginas.push({ url: r.url, html: r.html });
    const chave = `${chaveDe(r.url)}${marca ? `#${marca}` : ""}`;
    if (guardadas.has(chave)) return;
    guardadas.add(chave);
    const a = analisarPortal(r.html);
    telas.push({ caminho: caminhoDe(r.url), url: r.url, titulo: a.titulo, secoes: a.secoes, totalLinhas: a.totalLinhas, statusHttp: r.status });
    const ignoradas: LinkPortal[] = [];
    for (const link of extrairLinksMenu(r.html, r.url, ignoradas)) {
      if (visita.mesmoSite(link.url) && !abas.some((x) => x.url === link.url)) abas.push(link);
    }
    for (const link of ignoradas) {
      if (!abasIgnoradas.some((x) => x.url === link.url)) abasIgnoradas.push(link);
    }
    const semTexto = a.totalLinhas <= 2 && pareceMontadaPorScript(r.html);
    diagnostico.push(
      `${rotulo}: ${a.totalLinhas} linha(s)${semTexto ? " — a página parece ser montada por JavaScript (o leitor só enxerga o HTML)" : ""}.`,
    );
  };

  const abrirTela = async (url: string, rotulo: string) => {
    const chave = chaveDe(url);
    if (pedidos.has(chave) || guardadas.has(chave)) return;
    pedidos.add(chave);
    guardar(await abrir(visita, url), rotulo);
  };

  for (const inicial of iniciais) {
    pedidos.add(chaveDe(inicial.resposta.url));
    guardar(inicial.resposta, inicial.rotulo);
  }

  if (!(opcoes.ateOStatus && temSituacao())) await abrirTela(urlPortal(CAMINHO_STATUS), CAMINHO_STATUS);

  // ---- “Trocar Ponto”: o portal mostra o Status do ponto ESCOLHIDO ----
  /** Endereços para onde uma escolha foi enviada: nunca viram “a tela de Status”. */
  const destinosDeEscolha = new Set<string>();
  let trocas = 0;
  let escolhaGuardada: { url: string; escolha: EscolhaDePonto } | null = null;

  const escolhaNasPaginas = () => {
    for (let i = paginas.length - 1; i >= 0; i -= 1) {
      const escolha = extrairEscolhaDePonto(paginas[i].html);
      if (escolha) return { url: paginas[i].url, escolha };
    }
    return null;
  };
  /** Acha o formulário: numa página já aberta, na aba “Ponto” do menu ou na área do motorista. */
  const acharEscolha = async (deNovo: boolean) => {
    if (!deNovo) {
      const achada = escolhaNasPaginas();
      if (achada) return achada;
    }
    const ehAbaDoPonto = (a: LinkPortal) => /^(?:trocar\s+)?(?:meu\s+)?ponto$/i.test(a.texto);
    const abaPonto = abas.find(ehAbaDoPonto);
    // A aba pode ter ficado fora do menu por ter endereço com cara de ação
    // (“alterar_ponto”): para a tela de ESCOLHA vale a regra mais estreita —
    // só não se abre o que fala de sair, dispensa, exclusão ou senha.
    const abaDeFora = abasIgnoradas.find((a) => {
      if (!ehAbaDoPonto(a) || !visita.mesmoSite(a.url)) return false;
      try {
        const u = new URL(a.url);
        return !destinoProibido(`${u.pathname}${u.search}`);
      } catch {
        return false;
      }
    });
    const candidatos = [...new Set([abaPonto?.url, abaDeFora?.url, urlPortal(CAMINHO_AREA)].filter((u): u is string => Boolean(u)))];
    for (const url of candidatos) {
      // Página já aberta nesta visita e sem a lista: não adianta pedir de novo.
      if (!deNovo && paginas.some((x) => chaveDe(x.url) === chaveDe(url))) continue;
      const r = await abrir(visita, url);
      pedidos.add(chaveDe(url));
      // Mesma tela, lida de novo: só o formulário interessa (não vira outra leitura).
      if (r.ok && r.status < 400 && !formularioDeEntrada(r.html)) {
        const escolha = extrairEscolhaDePonto(r.html);
        const aba = [abaPonto, abaDeFora].find((x) => x?.url === url);
        guardar(r, aba ? `Aba “${aba.texto}” (${caminhoDe(r.url)})` : `Área do motorista (${caminhoDe(r.url)})`);
        if (escolha) return { url: r.url, escolha };
      }
    }
    return null;
  };
  const enderecosDoStatus = () => [
    ...new Set(
      [
        ...telas.filter((t) => mostraSituacao(t.secoes, null)).map((t) => t.url),
        ...abas.filter((a) => /^status\b/i.test(a.texto)).map((a) => a.url),
        urlPortal(CAMINHO_STATUS),
      ].filter((u) => !destinosDeEscolha.has(chaveDe(u))),
    ),
  ];

  const escolherPonto = async (codigo: string) => {
    if (!escolhaGuardada) escolhaGuardada = await acharEscolha(trocas > 0);
    const achada = escolhaGuardada;
    if (!achada) {
      diagnostico.push(
        `Não achei no portal a tela de escolha do ponto (“Trocar Ponto”: a lista de pontos e o botão Confirmar) para abrir o ${codigo}.`,
      );
      for (const pagina of paginas.slice(-2)) {
        for (const linha of resumoFormularios(pagina.html)) diagnostico.push(`Formulário em ${caminhoDe(pagina.url)}: ${linha}.`);
      }
      return;
    }
    const opcao = achada.escolha.opcoes.find((o) => o.codigo === codigo);
    if (!opcao) {
      const lista = achada.escolha.opcoes.map((o) => o.codigo);
      diagnostico.push(
        `A lista de pontos desta conta no portal não tem o ${codigo} (tem: ${lista.slice(0, 12).join(", ")}${lista.length > 12 ? "…" : ""}).`,
      );
      return;
    }
    const destino = resolverUrl(achada.url, achada.escolha.action);
    let caminhoDestino = "?";
    try {
      const u = new URL(destino);
      caminhoDestino = `${u.pathname}${u.search}`;
    } catch {
      // endereço inválido: cai na recusa abaixo
    }
    if (caminhoDestino === "?" || !visita.mesmoSite(destino) || destinoProibido(caminhoDestino)) {
      diagnostico.push(`A escolha do ponto ${codigo} não foi enviada: o endereço do formulário (${caminhoDe(destino)}) não é o de uma escolha de ponto.`);
      return;
    }
    const corpo = montarCorpoEscolha(achada.escolha, opcao.valor);
    let resposta: RespostaPortal;
    if (achada.escolha.method === "post") {
      resposta = await abrir(visita, destino, { metodo: "POST", corpo, referer: achada.url });
    } else {
      const u = new URL(destino);
      u.search = corpo;
      resposta = await abrir(visita, u.toString(), { referer: achada.url });
    }
    trocas += 1;
    destinosDeEscolha.add(chaveDe(destino));
    // Campo escondido pode ser um código de uso único: a próxima escolha relê o formulário.
    if (achada.escolha.ocultos.length) escolhaGuardada = null;
    diagnostico.push(
      `Ponto ${codigo} escolhido em “Trocar Ponto” (${achada.escolha.method.toUpperCase()} ${caminhoDe(destino)}; a lista tem ${achada.escolha.opcoes.length} ponto(s)).`,
    );
    guardar(resposta, `Depois de escolher o ${codigo} (${resposta.ok ? caminhoDe(resposta.url) : "sem resposta"})`, `ponto ${codigo}`);
    if (mostraNasTelas(codigo)) return;
    // A resposta da escolha não foi a tela de Status: abre o Status de novo.
    let n = 0;
    for (const url of enderecosDoStatus()) {
      n += 1;
      guardar(await abrir(visita, url), `Status do ${codigo} (${caminhoDe(url)})`, `ponto ${codigo} · ${n}`);
      if (mostraNasTelas(codigo)) return;
    }
    diagnostico.push(`Depois da escolha, o portal não mostrou a situação do ${codigo}.`);
  };

  if (telas.length) {
    for (const codigo of alvos) {
      if (mostraNasTelas(codigo)) continue;
      if (trocas >= MAX_TROCAS_DE_PONTO) {
        diagnostico.push(`Limite de ${MAX_TROCAS_DE_PONTO} escolhas de ponto por leitura: o ${codigo} fica para a próxima.`);
        break;
      }
      await escolherPonto(codigo);
    }
  }

  for (const extra of (opcoes.extras ?? []).filter(Boolean).slice(0, 6)) {
    await abrirTela(urlPortal(extra), extra);
  }
  let abertas = 0;
  for (let i = 0; i < abas.length && abertas < MAX_ABAS; i += 1) {
    if (opcoes.ateOStatus && temSituacao()) break;
    const aba = abas[i];
    const chave = chaveDe(aba.url);
    if (pedidos.has(chave) || guardadas.has(chave)) continue;
    abertas += 1;
    await abrirTela(aba.url, `Aba “${aba.texto}” (${caminhoDe(aba.url)})`);
  }
  diagnostico.push(
    abas.length
      ? `Abas no menu: ${abas.map((a) => `${a.texto} → ${caminhoDe(a.url)}`).join(", ")}.`
      : "Nenhuma aba reconhecida no menu do portal (Ponto, Status, Ticket, Fila).",
  );
  if (abasIgnoradas.length) {
    diagnostico.push(
      `Abas não abertas (o endereço parece uma ação): ${abasIgnoradas.map((a) => `${a.texto} → ${caminhoDe(a.url)}`).join(", ")}.`,
    );
  }

  if (guardada) {
    // A sessão continua aberta para a próxima leitura; o endereço da tela que
    // mostrou a situação é guardado para ela ir direto (um pedido só).
    guardada.cookies = visita.exportarCookies();
    const doStatus = telas.filter((t) => !destinosDeEscolha.has(chaveDe(t.url)));
    guardada.statusUrl =
      (alvos.length ? doStatus.find((t) => mostraSituacao(t.secoes, alvos[0])) : undefined)?.url ??
      doStatus.find((t) => mostraAlgum(t.secoes))?.url ??
      null;
    // O menu de qualquer tela aberta diz onde fica a aba “Fila”: a leitura da
    // fila vai direto a ela, sem um pedido a mais só para achar o endereço.
    const abaDaFila = abas.find((a) => ehAbaDaFila(a.texto));
    if (abaDaFila) guardada.filaUrl = abaDaFila.url;
    // …e onde fica a aba “Ticket” (só é aberta para quem ligou o Saldo de Ganhos).
    const abaDoTicket = abas.find((a) => ehAbaDoTicket(a.texto));
    if (abaDoTicket) guardada.ticketUrl = abaDoTicket.url;
  }

  return { ok: telas.some((t) => t.totalLinhas > 0), loginRecusado: false, captcha: false, telas, diagnostico, falha: null, fezLogin };
}

/**
 * Lê o portal de um motorista e devolve o resultado já comparado com a
 * leitura anterior (quando `anteriores` é informado). `anteriores: null` =
 * quem chama não compara linhas (o monitor do Status compara a SITUAÇÃO do
 * ponto): a leitura vem sem a conta de linhas novas.
 *
 * A leitura guardada é a de UMA tela: a que mostra a situação do ponto; sem
 * ela, a tela de status; sem ela, a página em que o login caiu.
 *
 * Não grava nada: quem chama decide (o cron grava em `portal_leituras`).
 */
export async function lerPortalDoMotorista(
  credenciais: CredenciaisPortal,
  anteriores: SecaoPortal[] | null = [],
  opcoes: Pick<OpcoesVisita, "buscar" | "codigo" | "codigos" | "sessao" | "esperaEntreLoginsMs"> = {},
): Promise<LeituraPortal> {
  const inicio = Date.now();
  if (!cpfPlausivel(credenciais.cpf)) {
    return leituraFalha("CPF cadastrado não tem 11 dígitos válidos.");
  }
  if (!credenciais.senha || credenciais.senha.length < 3) {
    return leituraFalha("Senha do portal não cadastrada.");
  }

  const visita = await visitarPortal(credenciais, {
    buscar: opcoes.buscar,
    ateOStatus: true,
    codigo: opcoes.codigo,
    codigos: opcoes.codigos,
    sessao: opcoes.sessao,
    esperaEntreLoginsMs: opcoes.esperaEntreLoginsMs,
  });
  if (visita.falha) return { ...visita.falha, ms: Date.now() - inicio };

  // Uma tela por ponto pedido (o portal mostra um ponto por vez); sem nenhuma,
  // a que mostra alguma situação, a de status ou a página em que o login caiu.
  const alvos = codigosPedidos(opcoes);
  const dosPontos = alvos
    .map((codigo) => visita.telas.find((t) => mostraSituacao(t.secoes, codigo)) ?? null)
    .filter((t): t is TelaLida => t !== null);
  const tela =
    dosPontos[0] ??
    visita.telas.find((t) => Boolean(interpretarStatus(t.secoes, alvos[0] ?? null)?.turno)) ??
    visita.telas.find((t) => t.totalLinhas > 0 && t.caminho.replace(/\/+$/, "") === CAMINHO_STATUS) ??
    visita.telas.find((t) => t.totalLinhas > 0) ??
    null;
  if (!tela) {
    return {
      ...leituraFalha("Login aceito, mas nenhuma tela da área do motorista trouxe conteúdo."),
      vazia: true,
      avisoPreciso: false,
      diagnostico: [...visita.diagnostico, "Nenhuma tela da área do motorista trouxe conteúdo."],
      ms: Date.now() - inicio,
      fezLogin: visita.fezLogin,
    };
  }

  // A leitura junta as telas de Status de todos os pontos pedidos.
  const telasDaLeitura = [...new Set([tela, ...dosPontos])];
  const secoes = telasDaLeitura.flatMap((t) => t.secoes);
  const totalLinhas = telasDaLeitura.reduce((n, t) => n + t.totalLinhas, 0);
  const situacoes = (alvos.length ? alvos : [null])
    .map((codigo) => (mostraSituacao(secoes, codigo) ? interpretarStatus(secoes, codigo) : null))
    .filter((x): x is StatusPortal => x !== null);
  const { novas, removidas } = anteriores?.length ? linhasAlteradas(anteriores, secoes) : { novas: [], removidas: [] };

  return {
    ok: true,
    loginRecusado: false,
    captcha: false,
    vazia: false,
    statusHttp: tela.statusHttp,
    urlFinal: tela.url,
    titulo: tela.titulo,
    secoes,
    totalLinhas,
    hash: hashConteudo(secoes),
    sinais: linhasDeInteresse(secoes),
    novas,
    removidas,
    avisoPreciso: false,
    diagnostico: [
      ...visita.diagnostico,
      `Página lida: ${tela.titulo || tela.caminho}${telasDaLeitura.length > 1 ? ` (${telasDaLeitura.length} telas, uma por ponto)` : ""}`,
      `${secoes.length} seção(ões) · ${totalLinhas} linha(s).`,
      ...(situacoes.length
        ? situacoes.map((st) => `Situação do ponto ${st.codigo ?? ""}: ${st.turnoTexto ?? st.turno}.`)
        : ["A situação do ponto (ATIVO / ESCALADO / EM DISPENSA) não apareceu nesta página."]),
      ...(anteriores === null
        ? []
        : [anteriores.length ? `${novas.length} linha(s) nova(s), ${removidas.length} removida(s).` : "Primeira leitura: nada é avisado ainda."]),
    ],
    ms: Date.now() - inicio,
    texto: secoes
      .map((s) => `# ${s.titulo}\n${s.linhas.map((l) => `- ${l}`).join("\n")}`)
      .join("\n")
      .slice(0, 6_000),
    fezLogin: visita.fezLogin,
  };
}

/**
 * Lê as telas do motorista na mesma sessão: Status do Ponto e as abas do menu
 * (Ponto, Ticket, Fila/Ativos). `caminhos` são endereços EXTRAS escolhidos
 * pelo administrador; o padrão é descobrir tudo pelo menu do próprio portal.
 */
export async function lerTelasDoMotorista(
  credenciais: CredenciaisPortal,
  caminhos: string[] = [],
  opcoes: Pick<OpcoesVisita, "buscar" | "codigo" | "codigos" | "sessao" | "esperaEntreLoginsMs"> = {},
): Promise<TelasDoMotorista> {
  const visita = await visitarPortal(credenciais, {
    buscar: opcoes.buscar,
    extras: caminhos,
    codigo: opcoes.codigo,
    codigos: opcoes.codigos,
    sessao: opcoes.sessao,
    esperaEntreLoginsMs: opcoes.esperaEntreLoginsMs,
  });
  return {
    ok: visita.ok,
    loginRecusado: visita.loginRecusado,
    captcha: visita.captcha,
    telas: visita.telas,
    diagnostico: visita.diagnostico,
    fezLogin: visita.fezLogin,
  };
}

/** Status do ponto + quadros de ativos das telas lidas (o que a saída usa). */
export function extrairStatusEAtivos(
  telas: Pick<TelaLida, "secoes">[],
  codigo?: string | null,
): {
  status: StatusPortal | null;
  livros: LivroAtivosPortal[];
  secoesStatus: SecaoPortal[];
} {
  let status: StatusPortal | null = null;
  let secoesStatus: SecaoPortal[] = [];
  let livros: LivroAtivosPortal[] = [];

  // O portal mostra um ponto por vez: entre as telas lidas pode haver o cartão
  // de OUTRO ponto. Vale mais o cartão do ponto pedido; depois, a tela que diz
  // a SITUAÇÃO (uma que só cita o código vale apenas se não houver outra).
  const alvo = codigo ? normalizarCodigoPortal(codigo) : null;
  const peso = (x: StatusPortal) => (alvo && x.codigo === alvo ? 2 : 0) + (x.turno ? 1 : 0);
  for (const tela of telas) {
    const s = interpretarStatus(tela.secoes, codigo);
    if (s && (!status || peso(s) > peso(status))) {
      status = s;
      secoesStatus = tela.secoes;
    }
    if (!livros.length) livros = interpretarAtivos(tela.secoes);
  }
  return { status, livros, secoesStatus };
}

// ------------------------------------------------------------------ banco

let tabelasProntas = false;

/** Cria as tabelas do monitoramento do portal (idempotente). */
export async function garantirTabelasPortal() {
  if (tabelasProntas || !temBancoConfigurado) return;
  await comBanco(() =>
    db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_motorista_acessos (
        motorista_id INTEGER PRIMARY KEY,
        cpf TEXT NOT NULL,
        cpf_final TEXT NOT NULL,
        senha_cifrada TEXT NOT NULL,
        senha_final4 TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1,
        aceito_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS portal_leituras (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        login_recusado INTEGER NOT NULL DEFAULT 0,
        captcha INTEGER NOT NULL DEFAULT 0,
        status_http INTEGER,
        titulo TEXT,
        total_linhas INTEGER NOT NULL DEFAULT 0,
        secoes JSONB,
        sinais JSONB,
        hash TEXT,
        novas JSONB,
        removidas JSONB,
        diagnostico TEXT,
        ms INTEGER NOT NULL DEFAULT 0,
        avisado INTEGER NOT NULL DEFAULT 0,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS portal_leituras_motorista_idx ON portal_leituras (motorista_id, id DESC);
      CREATE INDEX IF NOT EXISTS portal_leituras_criado_idx ON portal_leituras (criado_em);
      CREATE TABLE IF NOT EXISTS portal_eventos (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        codigo TEXT,
        turno TEXT,
        motivo TEXT,
        tipo_trabalho TEXT,
        livro TEXT,
        destino TEXT NOT NULL DEFAULT 'nenhum',
        titulo TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        diagnostico TEXT,
        modo TEXT NOT NULL DEFAULT 'desligado',
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS portal_eventos_motorista_idx ON portal_eventos (motorista_id, id DESC);
      CREATE INDEX IF NOT EXISTS portal_eventos_criado_idx ON portal_eventos (criado_em);
      CREATE TABLE IF NOT EXISTS portal_saidas_pendentes (
        id SERIAL PRIMARY KEY,
        ponto_id INTEGER NOT NULL,
        motorista_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,
        tipo TEXT NOT NULL,
        livro TEXT NOT NULL,
        numero INTEGER NOT NULL,
        codigo_na_vez TEXT NOT NULL,
        saida_por_ultimo INTEGER NOT NULL DEFAULT 0,
        tentativas INTEGER NOT NULL DEFAULT 0,
        proxima_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        em_andamento_ate TIMESTAMP WITH TIME ZONE,
        ultimo_status TEXT,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT portal_saida_pendente_ponto UNIQUE (ponto_id)
      );
      CREATE INDEX IF NOT EXISTS portal_saidas_pendentes_proxima_idx ON portal_saidas_pendentes (proxima_em);
      ALTER TABLE portal_motorista_acessos ADD COLUMN IF NOT EXISTS sessao_cifrada TEXT;
      ALTER TABLE portal_motorista_acessos ADD COLUMN IF NOT EXISTS proxima_leitura_em TIMESTAMP WITH TIME ZONE;
      CREATE TABLE IF NOT EXISTS portal_situacoes (
        ponto_id INTEGER PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,
        turno TEXT NOT NULL,
        mudou_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        lido_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS portal_situacoes_motorista_idx ON portal_situacoes (motorista_id);
      CREATE TABLE IF NOT EXISTS portal_fila (
        livro TEXT PRIMARY KEY,
        dados JSONB,
        lido_em TIMESTAMP WITH TIME ZONE,
        motorista_id INTEGER,
        tentativa_em TIMESTAMP WITH TIME ZONE,
        erro TEXT,
        diagnostico TEXT,
        proxima_leitura_em TIMESTAMP WITH TIME ZONE
      );
      CREATE TABLE IF NOT EXISTS portal_ticket_config (
        motorista_id INTEGER PRIMARY KEY,
        porcentagem_centesimos INTEGER NOT NULL,
        semana_inicio TEXT,
        semana_fim TEXT,
        tentativa_em TIMESTAMP WITH TIME ZONE,
        erro TEXT,
        diagnostico TEXT,
        proxima_leitura_em TIMESTAMP WITH TIME ZONE,
        criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS portal_tickets (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,
        semana_inicio TEXT NOT NULL,
        semana_fim TEXT NOT NULL,
        lancamentos JSONB,
        lido_em TIMESTAMP WITH TIME ZONE,
        tentativa_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        erro TEXT,
        CONSTRAINT portal_tickets_ponto_semana UNIQUE (motorista_id, codigo, semana_inicio)
      );
      CREATE TABLE IF NOT EXISTS portal_ticket_porcentagens (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,
        porcentagem_centesimos INTEGER NOT NULL,
        atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT portal_ticket_porcentagens_ponto UNIQUE (motorista_id, codigo)
      );
      ALTER TABLE portal_ticket_config ADD COLUMN IF NOT EXISTS por_ponto_em TIMESTAMP WITH TIME ZONE;
      DO $$
      DECLARE t text;
      BEGIN
        -- Sem policy, o RLS fecha estas tabelas para a API pública do Supabase;
        -- o servidor (dono das tabelas) continua lendo e gravando normalmente.
        FOREACH t IN ARRAY ARRAY['portal_motorista_acessos', 'portal_leituras', 'portal_eventos', 'portal_saidas_pendentes', 'portal_situacoes', 'portal_fila', 'portal_ticket_config', 'portal_tickets', 'portal_ticket_porcentagens'] LOOP
          BEGIN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END LOOP;
      END $$;
    `),
  );
  tabelasProntas = true;
}

/** Total de motoristas que cadastraram o CPF/senha do portal. */
export async function totalAcessosPortal(): Promise<number> {
  if (!temBancoConfigurado) return 0;
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db.select({ n: sql<number>`count(*)::int` }).from(portalMotoristaAcessos),
  );
  return linha?.n ?? 0;
}

/** Um acesso por motorista (o próprio motorista só vê o dele). */
export async function acessoPortalDoMotorista(motoristaId: number) {
  if (!temBancoConfigurado) return null;
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db.select().from(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, motoristaId)).limit(1),
  );
  return linha ?? null;
}

export type AcessoPortalPublico = {
  cadastrado: boolean;
  cpfMascarado: string | null;
  senhaFinal4: string | null;
  ativo: boolean;
  desde: string | null;
  /** Última leitura guardada (o app mostra "Portal: lido há…"). */
  leitura: {
    ok: boolean;
    loginRecusado: boolean;
    captcha: boolean;
    titulo: string | null;
    totalLinhas: number;
    sinais: string[];
    quando: string | null;
    diagnostico: string | null;
  } | null;
};

/** Versão segura para o navegador: sem CPF completo, sem senha, sem URLs. */
export function acessoPublico(
  acesso: typeof portalMotoristaAcessos.$inferSelect | null,
  leitura: typeof portalLeituras.$inferSelect | null,
): AcessoPortalPublico {
  return {
    cadastrado: Boolean(acesso),
    cpfMascarado: acesso
      ? `***.***.${acesso.cpfFinal.slice(-3)}-${acesso.cpfFinal.slice(-2)}`
      : null,
    senhaFinal4: acesso?.senhaFinal4 ?? null,
    ativo: Boolean(acesso?.ativo),
    desde: acesso?.aceitoEm ? acesso.aceitoEm.toISOString() : null,
    leitura: leitura
      ? {
          ok: leitura.ok === 1,
          loginRecusado: leitura.loginRecusado === 1,
          captcha: leitura.captcha === 1,
          titulo: leitura.titulo,
          totalLinhas: leitura.totalLinhas,
          sinais: Array.isArray(leitura.sinais) ? (leitura.sinais as string[]) : [],
          quando: leitura.criadoEm.toISOString(),
          diagnostico: leitura.diagnostico,
        }
      : null,
  };
}

/** Última leitura de um motorista (a que o app mostra). */
export async function ultimaLeituraPortal(motoristaId: number) {
  if (!temBancoConfigurado) return null;
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db
      .select()
      .from(portalLeituras)
      .where(eq(portalLeituras.motoristaId, motoristaId))
      .orderBy(desc(portalLeituras.id))
      .limit(1),
  );
  return linha ?? null;
}

/**
 * Guarda CPF (cifrado) + senha (cifrada) do portal para o motorista.
 * `trocouSenha=false` exige que já exista cadastro (evita criar dois).
 */
export async function salvarAcessoPortal(
  motoristaId: number,
  credenciais: CredenciaisPortal,
) {
  if (!temBancoConfigurado) throw new Error("Banco não configurado.");
  await garantirTabelasPortal();
  const cpf = limparCpf(credenciais.cpf);
  const senha = credenciais.senha;
  if (!cpfPlausivel(cpf)) throw new Error("CPF inválido: digite os 11 números.");
  if (!senha || senha.length < 3) throw new Error("Digite a senha do portal.");
  if (senha.length > 120) throw new Error("Senha longa demais (máximo 120 caracteres).");

  const cpfCifrado = await cifrarParaColuna(cpf);
  const senhaCifrada = await cifrarParaColuna(senha);
  const antes = await acessoPortalDoMotorista(motoristaId);

  await comBanco(() =>
    db
      .insert(portalMotoristaAcessos)
      .values({
        motoristaId,
        cpf: cpfCifrado,
        cpfFinal: cpf.slice(-5),
        senhaCifrada,
        senhaFinal4: senha.slice(-4),
        ativo: 1,
      })
      .onConflictDoUpdate({
        target: portalMotoristaAcessos.motoristaId,
        set: {
          cpf: cpfCifrado,
          cpfFinal: cpf.slice(-5),
          senhaCifrada,
          senhaFinal4: senha.slice(-4),
          ativo: 1,
          atualizadoEm: new Date(),
          // Senha nova: a sessão antiga não vale mais e a leitura recomeça já.
          sessaoCifrada: null,
          proximaLeituraEm: null,
        },
      }),
  );
  return { substituiu: Boolean(antes) };
}

/** Remove o acesso do motorista (a senha dele sai do banco na hora). */
export async function removerAcessoPortal(motoristaId: number) {
  if (!temBancoConfigurado) return false;
  await garantirTabelasPortal();
  const apagados = await comBanco(() =>
    db.delete(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, motoristaId)).returning({ id: portalMotoristaAcessos.motoristaId }),
  );
  await comBanco(() => db.delete(portalLeituras).where(eq(portalLeituras.motoristaId, motoristaId)));
  // Sem acesso, a situação lida no portal deixa de valer para os pontos dele.
  await comBanco(() => db.delete(portalSituacoes).where(eq(portalSituacoes.motoristaId, motoristaId)));
  // As viagens lidas na aba “Ticket” saem junto (as porcentagens que ele
  // cadastrou ficam: são uma preferência dele, não um dado do portal).
  await comBanco(() => db.delete(portalTickets).where(eq(portalTickets.motoristaId, motoristaId)));
  await comBanco(() =>
    db
      .update(portalTicketConfig)
      .set({ semanaInicio: null, semanaFim: null, tentativaEm: null, erro: null, diagnostico: null, proximaLeituraEm: null })
      .where(eq(portalTicketConfig.motoristaId, motoristaId)),
  );
  await esquecerMotoristaNaFila(motoristaId);
  return apagados.length > 0;
}

/**
 * A fila geral (aba “Fila”) fica guardada para todos; quando o motorista tira
 * o acesso, sai só a anotação de que foi a conta DELE que abriu a tela.
 */
async function esquecerMotoristaNaFila(motoristaId: number) {
  await comBanco(() => db.update(portalFila).set({ motoristaId: null }).where(eq(portalFila.motoristaId, motoristaId)));
}

/**
 * Cadastro do motorista excluído: nada do portal dele fica no banco — CPF e
 * senha cifrados, leituras, registros de consulta e avisos em espera.
 */
export async function apagarDadosPortalDoMotorista(motoristaId: number) {
  if (!temBancoConfigurado) return;
  await garantirTabelasPortal();
  await comBanco(() => db.delete(portalMotoristaAcessos).where(eq(portalMotoristaAcessos.motoristaId, motoristaId)));
  await comBanco(() => db.delete(portalSaidasPendentes).where(eq(portalSaidasPendentes.motoristaId, motoristaId)));
  await comBanco(() => db.delete(portalLeituras).where(eq(portalLeituras.motoristaId, motoristaId)));
  await comBanco(() => db.delete(portalEventos).where(eq(portalEventos.motoristaId, motoristaId)));
  await comBanco(() => db.delete(portalSituacoes).where(eq(portalSituacoes.motoristaId, motoristaId)));
  await comBanco(() => db.delete(portalTickets).where(eq(portalTickets.motoristaId, motoristaId)));
  await comBanco(() => db.delete(portalTicketPorcentagens).where(eq(portalTicketPorcentagens.motoristaId, motoristaId)));
  await comBanco(() => db.delete(portalTicketConfig).where(eq(portalTicketConfig.motoristaId, motoristaId)));
  await esquecerMotoristaNaFila(motoristaId);
}

/** Abre as credenciais guardadas (uso exclusivo do servidor). */
export async function credenciaisDoMotorista(motoristaId: number): Promise<CredenciaisPortal | null> {
  const acesso = await acessoPortalDoMotorista(motoristaId);
  if (!acesso || acesso.ativo !== 1) return null;
  try {
    return {
      cpf: await decifrarDeColuna(acesso.cpf),
      senha: await decifrarDeColuna(acesso.senhaCifrada),
    };
  } catch {
    return null;
  }
}

/** A última leitura ANTES desta (para comparar o que mudou). */
async function leituraAnterior(motoristaId: number) {
  await garantirTabelasPortal();
  const [linha] = await comBanco(() =>
    db
      .select({ secoes: portalLeituras.secoes })
      .from(portalLeituras)
      .where(and(eq(portalLeituras.motoristaId, motoristaId), eq(portalLeituras.ok, 1)))
      .orderBy(desc(portalLeituras.id))
      .limit(1),
  );
  const secoes = linha?.secoes;
  return Array.isArray(secoes) ? (secoes as SecaoPortal[]) : [];
}

/**
 * Lê o portal de UM motorista, grava a leitura e (quando algo muda) avisa.
 *
 * O aviso vai SÓ para os aparelhos daquele motorista, com tag própria
 * (uma alteração avisada não se repete) e respeitando a cota de 6/hora e
 * 20/dia — o portal pode piscar e não pode virar enxurrada de Push.
 */
export function monitorarMotorista(
  motoristaId: number,
  opcoes: { buscar?: typeof fetch; forcar?: boolean; avisar?: boolean } = {},
) {
  return umPorVez(motoristaId, () => monitorarAgora(motoristaId, opcoes));
}

/** Idas ao portal em andamento NESTA instância, por motorista. */
const emAndamento = new Map<number, Promise<unknown>>();

/**
 * Uma ida ao portal por vez para cada motorista: a leitura periódica e a
 * consulta da saída do ponto nunca fazem dois logins simultâneos na mesma
 * conta (a segunda espera a primeira terminar).
 */
export function umPorVez<T>(motoristaId: number, tarefa: () => Promise<T>): Promise<T> {
  const anterior = emAndamento.get(motoristaId) ?? Promise.resolve();
  const atual = anterior.then(tarefa, tarefa);
  const fim = atual.then(
    () => undefined,
    () => undefined,
  );
  emAndamento.set(motoristaId, fim);
  void fim.then(() => {
    if (emAndamento.get(motoristaId) === fim) emAndamento.delete(motoristaId);
  });
  return atual;
}

async function monitorarAgora(
  motoristaId: number,
  opcoes: { buscar?: typeof fetch; forcar?: boolean; avisar?: boolean },
) {
  const credenciais = await credenciaisDoMotorista(motoristaId);
  if (!credenciais) return { rodou: false as const, motivo: "sem_acesso" as const };

  const anteriores = await leituraAnterior(motoristaId);
  // Quantas leituras SEGUIDAS falharam antes desta (para não gritar numa piscada).
  const falhasSeguidas = await contarFalhasSeguidas(motoristaId);
  const leitura = await lerPortalDoMotorista(credenciais, anteriores, { buscar: opcoes.buscar });

  const gravada = await registrarLeituraPortal(motoristaId, leitura);

  let aviso: { enviado: boolean; motivo?: string } = { enviado: false };
  const mudou = leitura.ok && anteriores.length > 0 && leitura.novas.length > 0;
  // Um aviso por SEQUÊNCIA de falhas (na terceira seguida), nunca a cada leitura.
  const falhouDeNovo = !leitura.ok && !leitura.loginRecusado && !leitura.captcha && falhasSeguidas === 2;
  const precisaAvisar = opcoes.avisar !== false && ((mudou && leitura.avisoPreciso) || falhouDeNovo);

  if (gravada.pausado) {
    if (opcoes.avisar !== false) aviso = await avisarAcessoPausado(motoristaId, gravada.id);
  } else if (precisaAvisar) {
    const liberado = await cotaDeAvisoLiberada(motoristaId);
    if (!liberado) {
      aviso = { enviado: false, motivo: "cota" };
    } else {
      const corpo = leitura.ok
        ? resumoAviso(leitura.novas)
        : "A leitura do portal falhou três vezes seguidas. Abra o app em Portal do motorista para ver o motivo.";
      const r = await enviarPush(
        {
          title: leitura.ok ? "🚦 Portal do motorista: novidade" : "⚠️ Portal do motorista",
          body: corpo.slice(0, 180),
          tag: `PORTAL_${motoristaId}_${gravada.id ?? Date.now()}`,
          acao: "portal",
          url: "/",
        },
        { motoristaId, unica: true },
      ).catch(() => null);
      aviso = { enviado: Boolean(r && r.enviadas > 0), ...(r && r.enviadas === 0 ? { motivo: "sem_aparelho" } : {}) };
      if (aviso.enviado && gravada.id != null) {
        const id = gravada.id;
        await comBanco(() => db.update(portalLeituras).set({ avisado: 1 }).where(eq(portalLeituras.id, id)));
      }
    }
  }

  return {
    rodou: true as const,
    ok: leitura.ok,
    loginRecusado: leitura.loginRecusado,
    captcha: leitura.captcha,
    linhas: leitura.totalLinhas,
    novas: leitura.novas,
    diagnostico: leitura.diagnostico,
    aviso,
    pausado: gravada.pausado,
    leituraId: gravada.id,
    quando: gravada.criadoEm?.toISOString() ?? new Date().toISOString(),
  };
}

/** O que uma ida ao portal precisa deixar guardado (nunca CPF, senha ou cookie). */
export type LeituraParaGuardar = Pick<
  LeituraPortal,
  "ok" | "loginRecusado" | "captcha" | "statusHttp" | "titulo" | "totalLinhas" | "secoes" | "sinais" | "hash" | "novas" | "removidas" | "diagnostico" | "ms"
>;

/**
 * Guarda o resultado de UMA ida ao portal (leitura periódica ou consulta na
 * saída do ponto), limpa o histórico com mais de 7 dias e pausa o acesso
 * quando o login foi recusado `RECUSAS_PARA_PAUSAR` vezes seguidas.
 */
export async function registrarLeituraPortal(
  motoristaId: number,
  leitura: LeituraParaGuardar,
  opcoes: { /** Leitura repetida (mesmo conteúdo): atualiza a linha anterior em vez de criar outra. */ compactar?: boolean } = {},
) {
  await garantirTabelasPortal();
  const valores = {
    motoristaId,
    ok: leitura.ok ? 1 : 0,
    loginRecusado: leitura.loginRecusado ? 1 : 0,
    captcha: leitura.captcha ? 1 : 0,
    statusHttp: leitura.statusHttp,
    titulo: leitura.titulo.slice(0, 160),
    totalLinhas: leitura.totalLinhas,
    secoes: leitura.secoes,
    sinais: leitura.sinais,
    hash: leitura.hash,
    novas: leitura.novas,
    removidas: leitura.removidas,
    diagnostico: leitura.diagnostico.join("\n").slice(0, 1_500),
    ms: leitura.ms,
  };

  let gravada: { id: number; criadoEm: Date } | undefined;
  if (opcoes.compactar && leitura.ok) {
    // Leitura de minuto em minuto: quando a página mostra o MESMO da leitura
    // anterior (só o “há N min” andou), a linha anterior é atualizada — o
    // histórico guarda as mudanças, não mil cópias iguais por dia.
    const [ultima] = await comBanco(() =>
      db
        .select({ id: portalLeituras.id, ok: portalLeituras.ok, secoes: portalLeituras.secoes })
        .from(portalLeituras)
        .where(eq(portalLeituras.motoristaId, motoristaId))
        .orderBy(desc(portalLeituras.id))
        .limit(1),
    );
    if (
      ultima &&
      ultima.ok === 1 &&
      Array.isArray(ultima.secoes) &&
      hashEstavel(ultima.secoes as SecaoPortal[]) === hashEstavel(leitura.secoes)
    ) {
      [gravada] = await comBanco(() =>
        db
          .update(portalLeituras)
          .set({ ...valores, criadoEm: sql`now()` })
          .where(eq(portalLeituras.id, ultima.id))
          .returning({ id: portalLeituras.id, criadoEm: portalLeituras.criadoEm }),
      );
    }
  }
  if (!gravada) {
    [gravada] = await comBanco(() =>
      db.insert(portalLeituras).values(valores).returning({ id: portalLeituras.id, criadoEm: portalLeituras.criadoEm }),
    );

    // Só apaga histórico antigo deste motorista: 7 dias bastam para diagnóstico.
    await comBanco(() =>
      db.delete(portalLeituras).where(
        and(
          eq(portalLeituras.motoristaId, motoristaId),
          sql`${portalLeituras.criadoEm} < now() - interval '7 days'`,
        ),
      ),
    );
    // E nunca mais que `MAX_LEITURAS_GUARDADAS` por motorista: com uma leitura
    // por minuto, uma página que muda toda hora não pode encher o banco.
    await comBanco(() =>
      db.delete(portalLeituras).where(
        and(
          eq(portalLeituras.motoristaId, motoristaId),
          sql`${portalLeituras.id} < (
            select l.id from portal_leituras l
            where l.motorista_id = ${motoristaId}
            order by l.id desc offset ${MAX_LEITURAS_GUARDADAS} limit 1
          )`,
        ),
      ),
    );
  }

  // Cada tentativa é um login na conta do motorista: senha recusada em
  // seguida para as tentativas, até ele cadastrar a senha de novo no app.
  let pausado = false;
  if (leitura.loginRecusado && (await contarRecusasSeguidas(motoristaId)) >= RECUSAS_PARA_PAUSAR) {
    const pausados = await comBanco(() =>
      db
        .update(portalMotoristaAcessos)
        .set({ ativo: 0, sessaoCifrada: null })
        .where(and(eq(portalMotoristaAcessos.motoristaId, motoristaId), eq(portalMotoristaAcessos.ativo, 1)))
        .returning({ id: portalMotoristaAcessos.motoristaId }),
    );
    pausado = pausados.length > 0;
  }
  return { id: gravada?.id ?? null, criadoEm: gravada?.criadoEm ?? null, pausado };
}

/* ------------------------------------------- sessão guardada e leitura curta */

/** De onde veio a leitura: decide o freio dos logins automáticos. */
export type OrigemLeitura = "periodica" | "manual";

/**
 * Intervalo do freio dos logins AUTOMÁTICOS na mesma conta (a regra está em
 * `esperaParaLoginAutomatico`). Com a sessão guardada o login é raro (só
 * quando o portal encerra a sessão), e uma queda isolada é refeita na leitura
 * seguinte. O freio existe para o caso ruim: se o portal derrubar a sessão a
 * toda hora, a leitura de minuto em minuto viraria um login por minuto — mais
 * de mil por dia na conta do motorista. Com o freio, depois de
 * `LOGINS_SEGUIDOS` logins em seguida vale um login automático a cada 10 min
 * (e 10 min de espera depois de um login que não abriu a conta). A leitura
 * pedida por uma pessoa (“Ler agora”) não tem freio.
 */
export const ESPERA_ENTRE_LOGINS_MS: Record<OrigemLeitura, number> = {
  periodica: INTERVALO_FREIO_LOGINS_MS,
  manual: 0,
};

/** Máximo de leituras guardadas por motorista (as mais antigas saem). */
export const MAX_LEITURAS_GUARDADAS = 300;

/** Abre a sessão guardada do motorista (vazia quando não há ou não abre mais). */
async function abrirSessaoGuardada(cifrada: string | null): Promise<SessaoGuardada> {
  if (!cifrada) return sessaoVazia();
  try {
    const bruto = JSON.parse(await decifrarDeColuna(cifrada)) as {
      c?: unknown;
      u?: unknown;
      a?: unknown;
      k?: unknown;
      l?: unknown;
      f?: unknown;
      t?: unknown;
    };
    const cookies: Record<string, string> = {};
    if (bruto.c && typeof bruto.c === "object") {
      for (const [nome, valor] of Object.entries(bruto.c as Record<string, unknown>)) {
        if (typeof valor === "string" && valor && nome.length <= 80 && valor.length <= 2_000) cookies[nome] = valor;
      }
    }
    const agora = Date.now();
    return {
      cookies,
      statusUrl: typeof bruto.u === "string" && bruto.u ? bruto.u : null,
      filaUrl: typeof bruto.a === "string" && bruto.a && bruto.a.length <= 500 ? bruto.a : null,
      ticketUrl: typeof bruto.k === "string" && bruto.k && bruto.k.length <= 500 ? bruto.k : null,
      logins: Array.isArray(bruto.l)
        ? bruto.l.filter((t): t is number => typeof t === "number" && t <= agora && agora - t < 3_600_000)
        : [],
      falhouEm: typeof bruto.f === "number" && bruto.f <= agora && agora - bruto.f < 3_600_000 ? bruto.f : null,
      // Sem o número guardado, vale o mais cauteloso: nenhuma ficha sobrando.
      fichas: typeof bruto.t === "number" && bruto.t >= 0 ? Math.min(LOGINS_SEGUIDOS, bruto.t) : 0,
    };
  } catch {
    // Chave mestra trocada ou valor estragado: recomeça sem sessão.
    return sessaoVazia();
  }
}

/**
 * Guarda a sessão do motorista, cifrada como a senha (nunca em texto). Só
 * grava se a senha cadastrada ainda é a mesma da leitura: quem trocou a senha
 * no meio da visita não herda a sessão (nem o freio) da senha antiga.
 */
async function guardarSessao(motoristaId: number, sessao: SessaoGuardada, senhaCifrada: string) {
  const vazia = !Object.keys(sessao.cookies).length && !sessao.statusUrl && !sessao.logins.length;
  const cifrada = vazia
    ? null
    : await cifrarParaColuna(
        JSON.stringify({
          c: sessao.cookies,
          u: sessao.statusUrl,
          a: sessao.filaUrl ?? null,
          k: sessao.ticketUrl ?? null,
          l: sessao.logins,
          f: sessao.falhouEm,
          t: sessao.fichas,
        }),
      );
  await comBanco(() =>
    db
      .update(portalMotoristaAcessos)
      .set({ sessaoCifrada: cifrada })
      .where(and(eq(portalMotoristaAcessos.motoristaId, motoristaId), eq(portalMotoristaAcessos.senhaCifrada, senhaCifrada))),
  );
}

/**
 * Uma visita ao portal com a sessão guardada do motorista: abre a sessão,
 * entrega para `usar` (que a atualiza) e guarda de volta o que mudou. Devolve
 * `null` quando o motorista não tem acesso ativo.
 */
async function comSessaoGuardada<T>(
  motoristaId: number,
  usar: (credenciais: CredenciaisPortal, sessao: SessaoGuardada) => Promise<T>,
): Promise<T | null> {
  await garantirTabelasPortal();
  const acesso = await acessoPortalDoMotorista(motoristaId);
  if (!acesso || acesso.ativo !== 1) return null;
  let credenciais: CredenciaisPortal;
  try {
    credenciais = { cpf: await decifrarDeColuna(acesso.cpf), senha: await decifrarDeColuna(acesso.senhaCifrada) };
  } catch {
    return null;
  }
  const sessao = await abrirSessaoGuardada(acesso.sessaoCifrada);
  const antes = JSON.stringify(sessao);
  try {
    return await usar(credenciais, sessao);
  } finally {
    if (JSON.stringify(sessao) !== antes) await guardarSessao(motoristaId, sessao, acesso.senhaCifrada).catch(() => null);
  }
}

/**
 * A sessão guardada deste motorista serve para a leitura da fila entre as
 * olhadas do Status? Conta ativa, sessão aberta, endereço da aba guardado e
 * nenhum login há pouco (`motivoParaNaoLerAFilaEntreCiclos`). Só consulta o
 * banco: nenhum pedido ao portal e nada é gravado.
 */
export async function sessaoServeParaAFilaEntreCiclos(motoristaId: number): Promise<boolean> {
  const acesso = await acessoPortalDoMotorista(motoristaId);
  if (!acesso || acesso.ativo !== 1) return false;
  return motivoParaNaoLerAFilaEntreCiclos(await abrirSessaoGuardada(acesso.sessaoCifrada)) === null;
}

/** Só para os testes: faz de conta que os logins desta conta foram enviados `ms` mais cedo. */
export async function envelhecerLoginsDaSessao(motoristaId: number, ms: number) {
  const acesso = await acessoPortalDoMotorista(motoristaId);
  if (!acesso) return;
  const sessao = await abrirSessaoGuardada(acesso.sessaoCifrada);
  sessao.logins = sessao.logins.map((t) => t - ms);
  await guardarSessao(motoristaId, sessao, acesso.senhaCifrada);
}

export type LeituraGuardada =
  | { rodou: false; motivo: "sem_acesso" }
  | {
      rodou: true;
      leitura: LeituraPortal;
      /** A tela trouxe a situação de pelo menos um dos pontos pedidos. */
      temSituacao: boolean;
      /**
       * A visita nem tentou o login: a sessão guardada venceu e o último login
       * automático é recente demais. Não é uma leitura e não entra no histórico
       * (não pode quebrar a contagem de senhas recusadas em seguida).
       */
      freio: boolean;
      id: number | null;
      criadoEm: Date | null;
      pausado: boolean;
    };

/**
 * UMA olhada no Status do motorista, reaproveitando a sessão guardada: com a
 * sessão aberta é um pedido só; o login só se repete quando o portal pedir.
 * Grava a leitura (sem empilhar cópias iguais), guarda a sessão de volta e
 * conta a recusa de login — duas seguidas pausam o acesso.
 *
 * É a leitura usada quando o Status do portal é a fonte do monitoramento.
 */
export function lerEGuardarPortal(
  motoristaId: number,
  opcoes: {
    buscar?: typeof fetch;
    /** Pontos do motorista, como o portal escreve (A032). */
    codigos?: string[];
    origem: OrigemLeitura;
  },
): Promise<LeituraGuardada> {
  return umPorVez(motoristaId, async () => {
    const codigos = (opcoes.codigos ?? []).map((c) => normalizarCodigoPortal(c)).filter(Boolean);
    const leitura = await comSessaoGuardada(motoristaId, (credenciais, sessao) =>
      lerPortalDoMotorista(credenciais, null, {
        buscar: opcoes.buscar,
        codigo: codigos[0] ?? null,
        codigos,
        sessao,
        esperaEntreLoginsMs: ESPERA_ENTRE_LOGINS_MS[opcoes.origem],
      }),
    );
    if (!leitura) return { rodou: false as const, motivo: "sem_acesso" as const };

    if (!leitura.ok && leitura.tentarEmMs != null && !leitura.fezLogin) {
      return { rodou: true as const, leitura, temSituacao: false, freio: true, id: null, criadoEm: null, pausado: false };
    }

    // A leitura só serve ao monitoramento se trouxe a situação de um ponto DESTE
    // motorista: o cartão de outro ponto nunca conta.
    const temSituacao =
      leitura.ok &&
      (codigos.length
        ? codigos.some((codigo) => {
            const status = interpretarStatus(leitura.secoes, codigo);
            return Boolean(status?.turno) && status?.codigo === codigo;
          })
        : Boolean(interpretarStatus(leitura.secoes)?.turno));

    const diagnostico = [
      opcoes.origem === "manual" ? "Leitura do Status pedida agora." : "Leitura periódica do Status.",
      ...leitura.diagnostico,
      ...(leitura.ok && !temSituacao
        ? [
            codigos.length
              ? `O portal abriu, mas a tela de Status não mostrou a situação do ponto ${codigos.join(", ")} (ATIVO / ESCALADO / EM DISPENSA). Sem ela não há como avisar a saída.`
              : "O portal abriu, mas a tela de Status não mostrou a situação de nenhum ponto (ATIVO / ESCALADO / EM DISPENSA).",
          ]
        : []),
    ];
    // Para o histórico, leitura boa é a que trouxe a situação: é ela que conta
    // nas falhas seguidas e é ela que o motorista vê em “Última leitura”.
    const gravada = await registrarLeituraPortal(
      motoristaId,
      { ...leitura, ok: temSituacao, diagnostico },
      { compactar: true },
    );
    return { rodou: true as const, leitura: { ...leitura, diagnostico }, temSituacao, freio: false, ...gravada };
  });
}

/**
 * Todas as telas do motorista (Status + as abas do menu) na sessão guardada.
 * É a leitura da HORA DO AVISO: com mais de uma tela dá para tirar do texto o
 * que é moldura do site (menu, rodapé) e juntar o tipo de trabalho da aba de
 * fila. Não grava leitura e respeita o freio de logins. `null` = sem acesso.
 */
export function lerTelasNaSessaoGuardada(
  motoristaId: number,
  opcoes: {
    buscar?: typeof fetch;
    codigo?: string | null;
    /** Todos os pontos do motorista: cada um é escolhido em “Trocar Ponto” e lido. */
    codigos?: string[];
    caminhos?: string[];
    /** `manual` (alguém pediu agora) não espera o freio de logins. */
    origem?: OrigemLeitura;
    /** Quem chama já está dentro do `umPorVez` deste motorista. */
    jaNaFila?: boolean;
  } = {},
): Promise<TelasDoMotorista | null> {
  const ler = () =>
    comSessaoGuardada(motoristaId, (credenciais, sessao) =>
      lerTelasDoMotorista(credenciais, opcoes.caminhos ?? [], {
        buscar: opcoes.buscar,
        codigo: opcoes.codigo,
        codigos: opcoes.codigos,
        sessao,
        esperaEntreLoginsMs: ESPERA_ENTRE_LOGINS_MS[opcoes.origem ?? "periodica"],
      }),
    );
  return opcoes.jaNaFila ? ler() : umPorVez(motoristaId, ler);
}

/* ------------------------------------------------------------ aba “Fila” */

/** Prazo da leitura da fila (a tela e, se preciso, a aba de outro livro). */
const PRAZO_FILA_MS = 14_000;
/**
 * A leitura da fila ENTRE as olhadas do Status desiste cedo. Ela usa a sessão
 * de uma conta que a olhada do Status também usa: com o portal lento, um
 * pedido demorado dela não pode ficar no caminho de quem avisa a saída.
 */
export const PRAZO_FILA_ENTRE_CICLOS_MS = 6_000;
/**
 * A leitura entre ciclos só usa uma sessão ASSENTADA: aberta há este tempo sem
 * o portal ter pedido login de novo. É o freio dela. Se o portal encerrar a
 * sessão de uma conta por causa das consultas a mais, a conta entra de novo
 * (na olhada do Status, como sempre) e a leitura entre ciclos passa este tempo
 * sem usá-la: no pior caso é um login a mais a cada meia hora, nunca um por
 * minuto — o freio de logins da olhada do Status não chega a ser acionado.
 */
export const SESSAO_ASSENTADA_PARA_A_FILA_MS = 30 * 60_000;

/**
 * Por que a sessão guardada NÃO serve para a leitura da fila entre as olhadas
 * do Status (`null` = serve). Só olha o que está guardado: nenhum pedido.
 */
export function motivoParaNaoLerAFilaEntreCiclos(
  sessao: Pick<SessaoGuardada, "cookies" | "filaUrl" | "logins">,
  agora = Date.now(),
): string | null {
  if (!Object.keys(sessao.cookies).length) return "sem sessão aberta no portal nesta conta";
  if (!sessao.filaUrl) return "o endereço da aba “Fila” ainda não está guardado nesta conta (a próxima olhada do Status procura)";
  const ultimoLogin = sessao.logins.length ? Math.max(...sessao.logins) : null;
  if (ultimoLogin !== null && agora - ultimoLogin < SESSAO_ASSENTADA_PARA_A_FILA_MS) {
    const minutos = Math.floor((agora - ultimoLogin) / 60_000);
    return `esta conta entrou no portal há ${minutos < 1 ? "menos de 1" : minutos} min; a leitura entre as olhadas do Status só usa uma sessão aberta há ${SESSAO_ASSENTADA_PARA_A_FILA_MS / 60_000} min ou mais`;
  }
  return null;
}

export type FilaLidaNoPortal = {
  /** A aba “Fila” abriu com a sessão guardada. */
  abriu: boolean;
  /** Livros que vieram com os dois quadros completos (Truck e Carreta). */
  livros: Partial<Record<LivroDaFila, LivroLido>>;
  /** Livros pedidos que não vieram, com o motivo. */
  falhas: Partial<Record<LivroDaFila, string>>;
  diagnostico: string[];
  /** Pedidos feitos ao portal nesta leitura. */
  pedidos: number;
};

/** Caminho + parâmetros de um endereço do portal, para o diagnóstico das abas de livro. */
function caminhoComParametros(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname.replace(/^\/+/, "") || "início"}${u.search}`.slice(0, 80);
  } catch {
    return "?";
  }
}

/** Por que a resposta não serve como tela (null = serve). */
function problemaDaResposta(r: RespostaPortal): string | null {
  if (!r.ok) return `sem resposta do portal (${(r.erro ?? "falha de rede").slice(0, 80)})`;
  if (r.status === 404) return "a tela não existe neste endereço (404)";
  if (r.status >= 400) return `o portal respondeu ${r.status}`;
  if (formularioDeEntrada(r.html)) return "o portal pediu o login de novo (a próxima leitura do Status entra outra vez)";
  return null;
}

/** Só navegação dentro do portal: nada que tenha cara de ação é pedido. */
function podeAbrir(visita: SessaoPortal, url: string): boolean {
  if (!visita.mesmoSite(url)) return false;
  try {
    const u = new URL(url);
    return !enderecoDeAcao(`${u.pathname}${u.search}`) && !destinoProibido(`${u.pathname}${u.search}`);
  } catch {
    return false;
  }
}

/**
 * A leitura da aba “Fila” com uma sessão já aberta (a parte de rede, sem
 * banco). `sessao` é usada e atualizada: cookies e o endereço da aba.
 */
export async function lerFilaComSessao(
  sessao: SessaoGuardada,
  opcoes: { buscar?: typeof fetch; livros: LivroDaFila[]; /** Prazo da leitura inteira (padrão: 14 s). */ prazoMs?: number },
): Promise<FilaLidaNoPortal> {
  const diagnostico: string[] = [];
  const livros: FilaLidaNoPortal["livros"] = {};
  const falhas: FilaLidaNoPortal["falhas"] = {};
  let visita: SessaoPortal | null = null;
  const semLeitura = (motivo: string, abriu = false): FilaLidaNoPortal => {
    for (const livro of opcoes.livros) falhas[livro] ??= motivo;
    diagnostico.push(`Fila: ${motivo}.`);
    return { abriu, livros, falhas, diagnostico, pedidos: visita?.pedidos ?? 0 };
  };

  if (!Object.keys(sessao.cookies).length) return semLeitura("sem sessão aberta no portal nesta conta");
  visita = new SessaoPortal(opcoes.buscar ?? fetch, urlPortal(""), { cookies: sessao.cookies, prazoTotalMs: opcoes.prazoMs ?? PRAZO_FILA_MS });

  // 1) O endereço da aba: o que o menu do portal informou. Sem ele, abre a
  //    tela de Status (ou a área do motorista) só para ler o menu.
  let url = sessao.filaUrl && podeAbrir(visita, sessao.filaUrl) ? sessao.filaUrl : null;
  if (!url) {
    const partida = sessao.statusUrl && visita.mesmoSite(sessao.statusUrl) ? sessao.statusUrl : urlPortal(CAMINHO_AREA);
    const r = await visita.pedir(partida);
    const problema = problemaDaResposta(r);
    if (problema) return semLeitura(problema);
    const abas = extrairLinksMenu(r.html, r.url);
    const aba = abas.find((a) => ehAbaDaFila(a.texto) && podeAbrir(visita as SessaoPortal, a.url));
    if (!aba) {
      return semLeitura(
        `não achei a aba “Fila” no menu do portal (em ${caminhoDe(r.url)}: ${abas.length ? abas.map((a) => a.texto).join(", ") : "nenhuma aba reconhecida"})`,
      );
    }
    url = aba.url;
    sessao.filaUrl = url;
  }

  // 2) A tela.
  const tela = await visita.pedir(url);
  const problema = problemaDaResposta(tela);
  if (problema) {
    // Endereço que deixou de existir: a próxima leitura procura a aba de novo.
    if (tela.ok && tela.status === 404) sessao.filaUrl = null;
    return semLeitura(problema);
  }
  sessao.cookies = visita.exportarCookies();
  const naTela = interpretarFilaDoPortal(tela.html);
  const temQuadro = (fila: FilaDoPortal, livro: LivroDaFila) =>
    fila.quadros.some((q) => q.livro === livro) || fila.recusados.some((r) => r.titulo.startsWith(`Livro ${livro} `));

  for (const livro of opcoes.livros) {
    let lido = quadrosDoLivro(naTela, livro);
    let onde = caminhoDe(tela.url);
    if ("motivo" in lido && !temQuadro(naTela, livro)) {
      // A tela está em outro livro: a aba “Livro X” é um link da própria tela.
      const link = extrairLinksDeLivro(tela.html, tela.url).find((l) => l.livro === livro);
      if (link && podeAbrir(visita, link.url)) {
        const outra = await visita.pedir(link.url, { referer: tela.url });
        const falhou = problemaDaResposta(outra);
        onde = caminhoComParametros(link.url);
        lido = falhou ? { motivo: `aba “Livro ${livro}” (${onde}): ${falhou}` } : quadrosDoLivro(interpretarFilaDoPortal(outra.html), livro);
      } else {
        lido = { motivo: `${lido.motivo}, e a tela não tem um link “Livro ${livro}”` };
      }
    }
    if ("motivo" in lido) {
      falhas[livro] = lido.motivo;
      diagnostico.push(`Fila do Livro ${livro}: ${lido.motivo}.`);
    } else {
      livros[livro] = lido;
      diagnostico.push(`Fila do Livro ${livro} (${onde}): ${resumoDoLivro(livro, lido)}.`);
    }
  }

  // Nada reconhecido: as primeiras linhas da tela dizem o que ela mostrou.
  if (!Object.keys(livros).length) {
    const amostra = amostraDaTela(tela.html);
    diagnostico.push(
      amostra.length
        ? `Tela aberta (${caminhoDe(tela.url)}), primeiras linhas: ${amostra.join(" | ")}.`
        : `Tela aberta (${caminhoDe(tela.url)}): veio sem texto${pareceMontadaPorScript(tela.html) ? " — parece ser montada por JavaScript" : ""}.`,
    );
  }
  sessao.cookies = visita.exportarCookies();
  return { abriu: true, livros, falhas, diagnostico, pedidos: visita.pedidos };
}

/**
 * A aba “Fila” (a Tela de Ativos) na sessão guardada do motorista: um pedido
 * (mais um por livro que não esteja na tela). NUNCA faz login: se o portal
 * tiver encerrado a sessão, a leitura para aqui e a próxima olhada do Status
 * entra de novo, com o freio de logins. Só abre a aba do menu e os links
 * “Livro A / B / M” da própria tela — nada que tenha cara de ação.
 *
 * O que sai daqui é a fila geral (igual para todos os motoristas). `null` =
 * o motorista não tem acesso ativo.
 *
 * `somenteLeitura` (a leitura ENTRE as olhadas do Status): a sessão guardada é
 * usada mas NADA é gravado de volta — nem cookies, nem endereços, nem o freio
 * de logins. Quem cuida da sessão é só a olhada do Status; assim uma leitura
 * da fila que corra ao mesmo tempo que ela, em outra instância, nunca passa
 * por cima do que ela gravou. Sem o endereço da aba já guardado não há pedido
 * nenhum: procurar a aba no menu fica para a carona do Status. Também não há
 * pedido com uma sessão recém-aberta (`motivoParaNaoLerAFilaEntreCiclos`), e a
 * leitura desiste cedo (`PRAZO_FILA_ENTRE_CICLOS_MS`).
 */
export function lerFilaNaSessaoGuardada(
  motoristaId: number,
  opcoes: {
    buscar?: typeof fetch;
    livros: LivroDaFila[];
    /** Quem chama já está dentro do `umPorVez` deste motorista. */
    jaNaFila?: boolean;
    somenteLeitura?: boolean;
  },
): Promise<FilaLidaNoPortal | null> {
  const ler = () =>
    comSessaoGuardada(motoristaId, (_credenciais, sessao) => {
      if (!opcoes.somenteLeitura) return lerFilaComSessao(sessao, opcoes);
      const motivo = motivoParaNaoLerAFilaEntreCiclos(sessao);
      if (motivo) {
        const falhas: FilaLidaNoPortal["falhas"] = {};
        for (const livro of opcoes.livros) falhas[livro] = motivo;
        return Promise.resolve<FilaLidaNoPortal>({ abriu: false, livros: {}, falhas, diagnostico: [`Fila: ${motivo}.`], pedidos: 0 });
      }
      // Uma cópia: o que a leitura mudar nela (cookies, endereços) não volta para o banco.
      return lerFilaComSessao(structuredClone(sessao), { buscar: opcoes.buscar, livros: opcoes.livros, prazoMs: PRAZO_FILA_ENTRE_CICLOS_MS });
    });
  return opcoes.jaNaFila ? ler() : umPorVez(motoristaId, ler);
}

/* ---------------------------------------------------------- aba “Ticket” */

/** Prazo da leitura dos tickets (a tela do formulário e um “Gerar” por ponto) com até 3 pontos. */
const PRAZO_TICKET_MS = 12_000;
/** Todos os pontos do app são lidos na mesma visita: cada ponto além do terceiro é mais um “Gerar” e ganha mais tempo. */
const PRAZO_TICKET_POR_PONTO_A_MAIS_MS = 2_000;
/** Teto do prazo de uma leitura, com quantos pontos for. */
const PRAZO_TICKET_MAX_MS = 20_000;

/** O motivo do ponto que ficou sem leitura porque o tempo da leitura acabou antes da vez dele. */
export const MOTIVO_SEM_TEMPO = "não deu tempo de consultar este ponto nesta leitura; ele é o primeiro da próxima";
/** O motivo da leitura que nem começou: a função que a chamou já estava no fim do prazo dela. */
export const MOTIVO_SEM_TEMPO_PARA_COMECAR = "não sobrou tempo nesta rodada para abrir a aba Ticket";

/** O prazo de UMA leitura do Ticket, pelo número de pontos consultados: 12 s até 3 pontos, 2 s a mais por ponto, no máximo 20 s. */
export function prazoDoTicketMs(quantosPontos: number): number {
  return Math.min(PRAZO_TICKET_MAX_MS, PRAZO_TICKET_MS + PRAZO_TICKET_POR_PONTO_A_MAIS_MS * Math.max(0, quantosPontos - 3));
}
/** Quantas vezes o MESMO código pode aparecer na lista de pontos da conta e ainda ser lido. */
export const MAX_OPCOES_DO_MESMO_PONTO = 3;
/** Endereço que nunca recebe a consulta: o do PDF (ou de imprimir / baixar). */
const RE_DESTINO_DE_ARQUIVO = /pdf|download|baix|imprim|print|export|excel|xls|csv/i;

export type TicketsLidosNoPortal = {
  /** A aba “Ticket” abriu com a sessão guardada e trouxe o formulário da consulta. */
  abriu: boolean;
  /** A semana consultada: a de hoje, na lista do portal (null = não chegou a escolher). */
  semana: { inicio: string; fim: string } | null;
  /** Pontos que vieram com a tela de lançamentos inteira (as viagens da semana). */
  pontos: Record<string, LancamentoDoTicket[]>;
  /** Pontos pedidos que não vieram, com o motivo. */
  falhas: Record<string, string>;
  /** Nunca traz peso nem valor: os números do que a tela mostrou viram “9”. */
  diagnostico: string[];
  /** Pedidos feitos ao portal nesta leitura. */
  pedidos: number;
};

/**
 * A leitura da aba “Ticket” com uma sessão já aberta (a parte de rede, sem
 * banco): abre a “2ª Via de Ticket”, escolhe o ponto e a semana de hoje e
 * envia o “Gerar” — uma vez por ponto pedido. `sessao` é usada e atualizada:
 * cookies e o endereço da aba.
 *
 * Só envia o formulário da consulta (as duas listas e o “Gerar”), e só para o
 * endereço que ele mesmo informa, dentro do portal. O “Gerar PDF” nunca é
 * aberto, e nenhum link da tela de resultado é seguido.
 */
export async function lerTicketsComSessao(
  sessao: SessaoGuardada,
  opcoes: {
    buscar?: typeof fetch;
    codigos: string[];
    agora?: Date;
    /** Hora (em ms) em que a leitura tem de ter acabado: a função que chamou tem prazo. */
    terminarAte?: number;
  },
): Promise<TicketsLidosNoPortal> {
  const diagnostico: string[] = [];
  const pontosLidos: TicketsLidosNoPortal["pontos"] = {};
  const falhas: TicketsLidosNoPortal["falhas"] = {};
  let semana: TicketsLidosNoPortal["semana"] = null;
  let visita: SessaoPortal | null = null;
  const fim = (abriu: boolean): TicketsLidosNoPortal => ({ abriu, semana, pontos: pontosLidos, falhas, diagnostico, pedidos: visita?.pedidos ?? 0 });
  const semLeitura = (motivo: string, abriu = false): TicketsLidosNoPortal => {
    for (const codigo of opcoes.codigos) if (!pontosLidos[codigo]) falhas[codigo] ??= motivo;
    diagnostico.push(`Ticket: ${motivo}.`);
    return fim(abriu);
  };

  if (!opcoes.codigos.length) return semLeitura("nenhum ponto para consultar");
  if (!Object.keys(sessao.cookies).length) return semLeitura("sem sessão aberta no portal nesta conta");
  // O prazo cresce com o número de pontos, mas nunca passa da hora em que quem chamou precisa terminar.
  const sobra = opcoes.terminarAte === undefined ? Infinity : opcoes.terminarAte - Date.now();
  const prazoTotalMs = Math.max(0, Math.min(prazoDoTicketMs(opcoes.codigos.length), sobra));
  if (prazoTotalMs <= 0) return semLeitura(MOTIVO_SEM_TEMPO_PARA_COMECAR);
  const acabaEm = Date.now() + prazoTotalMs;
  const sessaoHttp = new SessaoPortal(opcoes.buscar ?? fetch, urlPortal(""), { cookies: sessao.cookies, prazoTotalMs });
  visita = sessaoHttp;

  // 1) O endereço da aba: o que o menu do portal informou. Sem ele, abre a
  //    tela de Status (ou a área do motorista) só para ler o menu.
  let url = sessao.ticketUrl && podeAbrir(sessaoHttp, sessao.ticketUrl) ? sessao.ticketUrl : null;
  if (!url) {
    const partida = sessao.statusUrl && sessaoHttp.mesmoSite(sessao.statusUrl) ? sessao.statusUrl : urlPortal(CAMINHO_AREA);
    const r = await sessaoHttp.pedir(partida);
    const problema = problemaDaResposta(r);
    if (problema) return semLeitura(problema);
    const abas = extrairLinksMenu(r.html, r.url);
    const aba = abas.find((a) => ehAbaDoTicket(a.texto) && podeAbrir(sessaoHttp, a.url));
    if (!aba) {
      return semLeitura(
        `não achei a aba “Ticket” no menu do portal (em ${caminhoDe(r.url)}: ${abas.length ? abas.map((a) => a.texto).join(", ") : "nenhuma aba reconhecida"})`,
      );
    }
    url = aba.url;
    sessao.ticketUrl = url;
  }
  const enderecoDaAba = url;

  // 2) A tela “2ª Via de Ticket”: a lista de pontos, a de semanas e o “Gerar”.
  const abrirFormulario = async (): Promise<{ form: FormularioDeTicket; pagina: string } | { problema: string }> => {
    const tela = await sessaoHttp.pedir(enderecoDaAba);
    const problema = problemaDaResposta(tela);
    if (problema) {
      // Endereço que deixou de existir: a próxima leitura procura a aba de novo.
      if (tela.ok && tela.status === 404) sessao.ticketUrl = null;
      return { problema };
    }
    const form = extrairFormularioDeTicket(tela.html);
    if ("motivo" in form) {
      for (const linha of form.estrutura) diagnostico.push(`Formulário em ${caminhoDe(tela.url)}: ${linha}.`);
      if (pareceMontadaPorScript(tela.html)) diagnostico.push(`A tela do Ticket (${caminhoDe(tela.url)}) veio sem texto — parece ser montada por JavaScript.`);
      return { problema: form.motivo };
    }
    return { form, pagina: tela.url };
  };
  let aberto = await abrirFormulario();
  if ("problema" in aberto) return semLeitura(aberto.problema);
  sessao.cookies = sessaoHttp.exportarCookies();

  // 3) A semana: a de hoje, na lista do próprio portal.
  const hoje = hojeEmBrasilia(opcoes.agora);
  const escolhida = semanaDeHoje(aberto.form.semanas, hoje);
  if (!escolhida) {
    const datas = aberto.form.semanas.flatMap((s) => [s.inicio, s.fim]).sort();
    return semLeitura(
      `a lista de semanas do portal não tem a semana de hoje (${diaMes(hoje)}); tem ${aberto.form.semanas.length} semana(s), de ${diaMes(datas[0])} a ${diaMes(datas[datas.length - 1])}`,
      true,
    );
  }
  semana = { inicio: escolhida.inicio, fim: escolhida.fim };
  const rotuloDaSemana = `${diaMes(escolhida.inicio)} a ${diaMes(escolhida.fim)}`;

  // 4) Um “Gerar” por ponto (e por opção, quando a lista repete o código).
  let enviados = 0;
  for (const codigo of opcoes.codigos) {
    // Acabou o tempo desta leitura: o ponto que não coube não é pedido — ele abre a leitura seguinte.
    if (Date.now() >= acabaEm) {
      falhas[codigo] = MOTIVO_SEM_TEMPO;
      diagnostico.push(`Ticket do ${codigo}: ${MOTIVO_SEM_TEMPO}.`);
      continue;
    }
    const quantas = aberto.form.pontos.filter((p) => p.codigo === codigo).length;
    if (!quantas) {
      const lista = [...new Set(aberto.form.pontos.map((p) => p.codigo))];
      falhas[codigo] = `a lista de pontos desta conta no portal não tem o ${codigo}`;
      diagnostico.push(`Ticket do ${codigo}: ${falhas[codigo]} (tem: ${lista.slice(0, 12).join(", ")}${lista.length > 12 ? "…" : ""}).`);
      continue;
    }
    if (quantas > MAX_OPCOES_DO_MESMO_PONTO) {
      falhas[codigo] = `o ${codigo} aparece ${quantas} vezes na lista de pontos do portal (a leitura junta até ${MAX_OPCOES_DO_MESMO_PONTO})`;
      diagnostico.push(`Ticket do ${codigo}: ${falhas[codigo]}.`);
      continue;
    }
    const listas: LancamentoDoTicket[][] = [];
    let falha: string | null = null;
    for (let n = 0; n < quantas && !falha; n += 1) {
      // Campo escondido pode ser um código de uso único: relê o formulário antes de cada envio.
      if (enviados > 0 && aberto.form.ocultos.length) {
        const deNovo = await abrirFormulario();
        if ("problema" in deNovo) {
          falha = deNovo.problema;
          break;
        }
        aberto = deNovo;
      }
      const form: FormularioDeTicket = aberto.form;
      // A n-ésima opção com este código e a mesma semana, no formulário de agora.
      const opcao = form.pontos.filter((p) => p.codigo === codigo)[n];
      const daSemana = form.semanas.find((s) => s.inicio === escolhida.inicio && s.fim === escolhida.fim);
      if (!opcao || !daSemana) {
        falha = "a lista de pontos ou de semanas mudou no meio da leitura";
        break;
      }
      const destino = resolverUrl(aberto.pagina, form.action);
      let caminhoDestino = "?";
      try {
        const u = new URL(destino);
        caminhoDestino = `${u.pathname}${u.search}`;
      } catch {
        // endereço inválido: cai na recusa abaixo
      }
      if (caminhoDestino === "?" || !sessaoHttp.mesmoSite(destino) || destinoProibido(caminhoDestino) || RE_DESTINO_DE_ARQUIVO.test(caminhoDestino)) {
        falha = `a consulta não foi enviada: o endereço do formulário (${caminhoDe(destino)}) não é o de uma consulta de ticket`;
        break;
      }
      const corpo = montarPedidoDeTicket(form, opcao.valor, daSemana.valor);
      let resposta: RespostaPortal;
      if (form.method === "post") {
        resposta = await sessaoHttp.pedir(destino, { metodo: "POST", corpo, referer: aberto.pagina });
      } else {
        const u = new URL(destino);
        u.search = corpo;
        resposta = await sessaoHttp.pedir(u.toString(), { referer: aberto.pagina });
      }
      enviados += 1;
      const problema = problemaDaResposta(resposta);
      if (problema) {
        falha = problema;
        break;
      }
      const lida = interpretarTickets(resposta.html, { codigo, inicio: escolhida.inicio, fim: escolhida.fim });
      if (!lida.ok) {
        falha = lida.motivo;
        diagnostico.push(
          lida.amostra.length
            ? `Tela depois do “Gerar” (${form.method.toUpperCase()} ${caminhoDe(resposta.url)}), com os números trocados por 9: ${lida.amostra.join(" | ")}.`
            : `Tela depois do “Gerar” (${form.method.toUpperCase()} ${caminhoDe(resposta.url)}): veio sem texto${pareceMontadaPorScript(resposta.html) ? " — parece ser montada por JavaScript" : ""}.`,
        );
        break;
      }
      listas.push(lida.lancamentos);
    }
    if (!falha && listas.length > 1 && listas.some((lista) => lista.some((v) => !v.data || !v.hora))) {
      falha = "o ponto aparece mais de uma vez e o portal não informa data e hora para distinguir as viagens";
    }
    if (falha) {
      falhas[codigo] = falha;
      diagnostico.push(`Ticket do ${codigo} (semana ${rotuloDaSemana}): ${falha}.`);
    } else {
      pontosLidos[codigo] = juntarLancamentos(listas);
      diagnostico.push(
        `Ticket do ${codigo} (semana ${rotuloDaSemana}): tela de lançamentos lida inteira${
          quantas > 1 ? `; o ponto aparece ${quantas} vezes na lista do portal — as ${quantas} foram lidas e a viagem repetida conta uma vez` : ""
        }.`,
      );
    }
  }
  sessao.cookies = sessaoHttp.exportarCookies();
  return fim(true);
}

/**
 * A aba “Ticket” (a 2ª Via de Ticket) na sessão guardada do motorista: a tela
 * do formulário e um “Gerar” por ponto. NUNCA faz login: se o portal tiver
 * encerrado a sessão, a leitura para aqui e a próxima olhada do Status entra
 * de novo, com o freio de logins.
 *
 * O que sai daqui é do PRÓPRIO motorista (as viagens dos pontos dele) e só ele
 * vê. `null` = o motorista não tem acesso ativo.
 */
export function lerTicketsNaSessaoGuardada(
  motoristaId: number,
  opcoes: {
    buscar?: typeof fetch;
    codigos: string[];
    agora?: Date;
    /** Hora (em ms) em que a leitura tem de ter acabado. */
    terminarAte?: number;
    /** Quem chama já está dentro do `umPorVez` deste motorista. */
    jaNaFila?: boolean;
  },
): Promise<TicketsLidosNoPortal | null> {
  const ler = () => comSessaoGuardada(motoristaId, (_credenciais, sessao) => lerTicketsComSessao(sessao, opcoes));
  return opcoes.jaNaFila ? ler() : umPorVez(motoristaId, ler);
}

/**
 * Reserva os motoristas cuja leitura periódica do Status já pode começar e
 * marca a próxima para daqui a `esperaMs`. A reserva é atômica (`SKIP LOCKED`):
 * duas funções rodando juntas nunca olham a mesma conta no mesmo ciclo. Só
 * entra quem tem acesso ativo e pelo menos um ponto cadastrado; quem espera há
 * mais tempo vem primeiro.
 */
export async function reservarLeiturasDevidas(limite: number, esperaMs: number, somente?: number): Promise<number[]> {
  if (!temBancoConfigurado) return [];
  await garantirTabelasPortal();
  const linhas = await comBanco(() =>
    db
      .update(portalMotoristaAcessos)
      .set({ proximaLeituraEm: sql`now() + (${Math.max(0, Math.round(esperaMs))} * interval '1 millisecond')` })
      .where(
        sql`${portalMotoristaAcessos.motoristaId} in (
          select c.motorista_id from portal_motorista_acessos c
          where c.ativo = 1
            and (c.proxima_leitura_em is null or c.proxima_leitura_em <= now())
            and exists (select 1 from pontos p where p.motorista_id = c.motorista_id)
            ${somente != null ? sql`and c.motorista_id = ${somente}` : sql``}
          order by c.proxima_leitura_em asc nulls first, c.motorista_id
          limit ${Math.max(1, Math.round(limite))}
          for update skip locked
        )`,
      )
      .returning({ motoristaId: portalMotoristaAcessos.motoristaId }),
  );
  return linhas.map((l) => l.motoristaId);
}

/** Marca a próxima leitura periódica de um motorista para daqui a `emMs`. */
export async function marcarProximaLeitura(motoristaId: number, emMs: number) {
  if (!temBancoConfigurado) return;
  await comBanco(() =>
    db
      .update(portalMotoristaAcessos)
      .set({ proximaLeituraEm: sql`now() + (${Math.max(0, Math.round(emMs))} * interval '1 millisecond')` })
      .where(eq(portalMotoristaAcessos.motoristaId, motoristaId)),
  );
}

/** Avisa o motorista, uma única vez, que a leitura do portal foi pausada. */
export async function avisarAcessoPausado(motoristaId: number, leituraId: number | null) {
  const r = await enviarPush(
    {
      title: "🔒 Portal: senha recusada",
      body: "O portal recusou o CPF/senha cadastrados. Pausei a leitura para não bloquear a sua conta: abra Portal do motorista no app e cadastre a senha de novo.",
      tag: `PORTAL_PAUSA_${motoristaId}_${leituraId ?? Date.now()}`,
      acao: "portal",
      url: "/",
    },
    { motoristaId, unica: true },
  ).catch(() => null);
  const enviado = Boolean(r && r.enviadas > 0);
  if (enviado && leituraId != null) {
    await comBanco(() => db.update(portalLeituras).set({ avisado: 1 }).where(eq(portalLeituras.id, leituraId)));
  }
  return { enviado, ...(r && r.enviadas === 0 ? { motivo: "sem_aparelho" } : {}) };
}

/**
 * Avisa o motorista que o Status não está sendo lido — e que, enquanto isso,
 * não há aviso de saída. Quem chama decide QUANDO (uma vez por sequência de
 * falhas); aqui valem a tag única e a cota de avisos do portal.
 */
export async function avisarLeituraParada(motoristaId: number, leituraId: number | null) {
  if (!(await cotaDeAvisoLiberada(motoristaId))) return { enviado: false, motivo: "cota" };
  const r = await enviarPush(
    {
      title: "⚠️ Portal do motorista",
      body: "Não consegui ler o Status do seu ponto 3 vezes seguidas. Enquanto isso o aviso de saída fica parado. Abra Portal do motorista no app para ver o motivo.",
      tag: `PORTAL_PARADA_${motoristaId}_${leituraId ?? Date.now()}`,
      acao: "portal",
      url: "/",
    },
    { motoristaId, unica: true },
  ).catch(() => null);
  const enviado = Boolean(r && r.enviadas > 0);
  if (enviado && leituraId != null) {
    await comBanco(() => db.update(portalLeituras).set({ avisado: 1 }).where(eq(portalLeituras.id, leituraId)));
  }
  return { enviado, ...(r && r.enviadas === 0 ? { motivo: "sem_aparelho" } : {}) };
}

/** Primeira linha nova, curta, para o corpo do aviso. */
function resumoAviso(novas: string[]): string {
  const principal = novas.slice(0, 3).join(" · ");
  return principal ? `Mudou no portal: ${principal}` : "O portal do motorista foi atualizado.";
}

/**
 * Cota de avisos do portal: 6 por hora e 20 por dia, por motorista, e nunca
 * dois avisos com menos de `AVISO_MIN_MS` de distância. A contagem usa o campo
 * `avisado` (só as leituras que REALMENTE geraram Push).
 */
async function cotaDeAvisoLiberada(motoristaId: number): Promise<boolean> {
  const [c] = await comBanco(() =>
    db
      .select({
        hora: sql<number>`count(*) filter (where ${portalLeituras.criadoEm} > now() - interval '1 hour')::int`,
        dia: sql<number>`count(*) filter (where ${portalLeituras.criadoEm} > now() - interval '1 day')::int`,
        ultimo: sql<Date | null>`max(${portalLeituras.criadoEm})`,
      })
      .from(portalLeituras)
      .where(and(eq(portalLeituras.motoristaId, motoristaId), eq(portalLeituras.avisado, 1))),
  );
  if (!c) return true;
  if ((c.hora ?? 0) >= AVISO_MAX_HORA) return false;
  if ((c.dia ?? 0) >= AVISO_MAX_DIA) return false;
  if (c.ultimo && Date.now() - new Date(c.ultimo).getTime() < AVISO_MIN_MS) return false;
  return true;
}

/** Resumo para o cartão do /admin: quem cadastrou, quem leu, quem falhou. */
export async function painelPortalAdmin() {
  if (!temBancoConfigurado) {
    return { total: 0, ativos: 0, lidos24h: 0, falhas: 0, comAcesso: 0, atualizadoEm: null as string | null, motoristas: [] as PainelMotoristaPortal[] };
  }
  await garantirTabelasPortal();
  const acessos = await comBanco(() =>
    db
      .select({
        motoristaId: portalMotoristaAcessos.motoristaId,
        nome: motoristas.nome,
        cpfFinal: portalMotoristaAcessos.cpfFinal,
        senhaFinal4: portalMotoristaAcessos.senhaFinal4,
        ativo: portalMotoristaAcessos.ativo,
        aceitoEm: portalMotoristaAcessos.aceitoEm,
        atualizadoEm: portalMotoristaAcessos.atualizadoEm,
      })
      .from(portalMotoristaAcessos)
      .leftJoin(motoristas, eq(motoristas.id, portalMotoristaAcessos.motoristaId))
      .orderBy(asc(portalMotoristaAcessos.motoristaId)),
  );

  const ultimas = await comBanco(() =>
    db
      .select({
        motoristaId: portalLeituras.motoristaId,
        id: portalLeituras.id,
        ok: portalLeituras.ok,
        loginRecusado: portalLeituras.loginRecusado,
        captcha: portalLeituras.captcha,
        totalLinhas: portalLeituras.totalLinhas,
        titulo: portalLeituras.titulo,
        sinais: portalLeituras.sinais,
        diagnostico: portalLeituras.diagnostico,
        ms: portalLeituras.ms,
        criadoEm: portalLeituras.criadoEm,
        secoes: portalLeituras.secoes,
      })
      .from(portalLeituras)
      .where(
        sql`${portalLeituras.id} in (select max(id) from portal_leituras group by motorista_id)`,
      )
      .orderBy(desc(portalLeituras.id)),
  );

  const porMotorista = new Map(ultimas.map((l) => [l.motoristaId, l]));
  const lista: PainelMotoristaPortal[] = acessos.map((a) => {
    const l = porMotorista.get(a.motoristaId) ?? null;
    return {
      motoristaId: a.motoristaId,
      nome: a.nome ?? `Motorista #${a.motoristaId}`,
      cpfMascarado: `***.***.${a.cpfFinal.slice(-3)}-${a.cpfFinal.slice(-2)}`,
      senhaFinal4: a.senhaFinal4,
      ativo: a.ativo === 1,
      desde: a.aceitoEm?.toISOString() ?? null,
      ultima: l
        ? {
            em: l.criadoEm.toISOString(),
            ok: l.ok === 1,
            loginRecusado: l.loginRecusado === 1,
            captcha: l.captcha === 1,
            linhas: l.totalLinhas,
            titulo: l.titulo,
            ms: l.ms,
            sinais: Array.isArray(l.sinais) ? (l.sinais as string[]) : [],
            diagnostico: (l.diagnostico ?? "").split("\n").filter(Boolean),
            secoes: Array.isArray(l.secoes) ? (l.secoes as SecaoPortal[]) : [],
          }
        : null,
    };
  });

  const agora = Date.now();
  const lidos24h = ultimas.filter((l) => agora - new Date(l.criadoEm).getTime() < 24 * 3_600_000 && l.ok === 1).length;
  const falhas = lista.filter((m) => m.ultima && (!m.ultima.ok || m.ultima.loginRecusado)).length;

  return {
    total: lista.length,
    ativos: lista.filter((m) => m.ativo).length,
    comAcesso: lista.length,
    lidos24h,
    falhas,
    atualizadoEm: new Date().toISOString(),
    motoristas: lista,
  };
}

export type PainelMotoristaPortal = {
  motoristaId: number;
  nome: string;
  cpfMascarado: string;
  senhaFinal4: string;
  ativo: boolean;
  desde: string | null;
  ultima: {
    em: string;
    ok: boolean;
    loginRecusado: boolean;
    captcha: boolean;
    linhas: number;
    titulo: string | null;
    ms: number;
    sinais: string[];
    diagnostico: string[];
    secoes: SecaoPortal[];
  } | null;
};

/**
 * A leitura PERIÓDICA de um motorista é devida agora? (função pura, testada)
 *
 * Cada leitura é um login de verdade na conta do motorista, então ela só
 * acontece quando serve para alguma coisa:
 *   - um ponto dele está FORA do quadro (SAIU) há menos de
 *     `JANELA_LEITURA_APOS_SAIDA_H` horas. Com o ponto na fila, o quadro
 *     público já mostra a posição e ninguém precisa entrar no portal;
 *   - a última leitura tem mais de `INTERVALO_LEITURA_MS`;
 *   - depois de 3 falhas seguidas, só a cada `ESPERA_APOS_FALHAS_MS`;
 *   - a última leitura boa é ANTERIOR à saída (ainda não se sabe a situação)
 *     ou mostra o ponto EM DISPENSA — é a releitura que mantém o selo
 *     “DISPENSA” do app em dia. Ponto ESCALADO não é relido: o motorista está
 *     trabalhando e a volta à fila aparece no quadro público.
 */
export function leituraPeriodicaDevida(e: {
  agora: number;
  /** Pontos do motorista fora do quadro, dentro da janela. */
  pontosFora: { codigo: string; saidaEm: number }[];
  ultima: { ok: boolean; em: number; secoes: SecaoPortal[] } | null;
  falhasSeguidas: number;
}): boolean {
  const limite = e.agora - JANELA_LEITURA_APOS_SAIDA_H * 3_600_000;
  const fora = e.pontosFora.filter((p) => p.saidaEm > limite);
  if (!fora.length) return false;
  const ultima = e.ultima;
  if (!ultima) return true;
  const idade = e.agora - ultima.em;
  if (idade < INTERVALO_LEITURA_MS) return false;
  if (!ultima.ok) return e.falhasSeguidas < 3 || idade >= ESPERA_APOS_FALHAS_MS;
  return fora.some((p) => {
    if (ultima.em < p.saidaEm) return true;
    const status = interpretarStatus(ultima.secoes, p.codigo);
    return status?.codigo === p.codigo && status.turno === "EM DISPENSA";
  });
}

/**
 * Quem precisa de uma leitura periódica agora: acesso ativo, sem aviso de
 * saída esperando a consulta (ela já vai ao portal) e com a leitura devida
 * pela regra de `leituraPeriodicaDevida`. Quem está há mais tempo sem leitura
 * vem primeiro (ninguém fica para trás).
 */
async function motoristasComLeituraDevida(limite: number, somente?: number): Promise<number[]> {
  await garantirTabelasPortal();
  const linhas = await comBanco(() =>
    db
      .select({ motoristaId: portalMotoristaAcessos.motoristaId })
      .from(portalMotoristaAcessos)
      .where(
        and(
          eq(portalMotoristaAcessos.ativo, 1),
          ...(somente != null ? [eq(portalMotoristaAcessos.motoristaId, somente)] : []),
          sql`exists (select 1 from pontos p where p.motorista_id = ${portalMotoristaAcessos.motoristaId}
                and p.status = 'SAIU'
                and p.saida_em > now() - (${JANELA_LEITURA_APOS_SAIDA_H} * interval '1 hour'))`,
          sql`not exists (select 1 from portal_saidas_pendentes s where s.motorista_id = ${portalMotoristaAcessos.motoristaId})`,
          sql`not exists (select 1 from portal_leituras l where l.motorista_id = ${portalMotoristaAcessos.motoristaId}
                and l.criado_em > now() - (${Math.round(INTERVALO_LEITURA_MS / 1000)} * interval '1 second'))`,
        ),
      )
      .orderBy(
        sql`(select max(l.criado_em) from portal_leituras l where l.motorista_id = ${portalMotoristaAcessos.motoristaId}) asc nulls first`,
        asc(portalMotoristaAcessos.motoristaId),
      )
      // Margem: parte dos candidatos cai na regra fina (ESCALADO, falhas seguidas).
      .limit(Math.max(1, limite) * 4),
  );

  const devidos: number[] = [];
  for (const { motoristaId } of linhas) {
    if (devidos.length >= Math.max(1, limite)) break;
    const fora = await comBanco(() =>
      db
        .select({ livro: pontos.livro, numero: pontos.numero, saidaEm: pontos.saidaEm })
        .from(pontos)
        .where(and(eq(pontos.motoristaId, motoristaId), eq(pontos.status, "SAIU"))),
    );
    const ultima = await ultimaLeituraPortal(motoristaId);
    const devida = leituraPeriodicaDevida({
      agora: Date.now(),
      pontosFora: fora
        .filter((p): p is typeof p & { saidaEm: Date } => p.saidaEm instanceof Date)
        .map((p) => ({ codigo: `${p.livro}${String(p.numero).padStart(3, "0")}`, saidaEm: p.saidaEm.getTime() })),
      ultima: ultima
        ? { ok: ultima.ok === 1, em: ultima.criadoEm.getTime(), secoes: Array.isArray(ultima.secoes) ? (ultima.secoes as SecaoPortal[]) : [] }
        : null,
      falhasSeguidas: ultima && ultima.ok !== 1 ? await contarFalhasSeguidas(motoristaId) : 0,
    });
    if (devida) devidos.push(motoristaId);
  }
  return devidos;
}

/** Leitura periódica de UM motorista, só se ela for devida agora (app aberto). */
export async function monitorarSeDevido(motoristaId: number) {
  if (!temBancoConfigurado) return { rodou: false as const, motivo: "sem_banco" as const };
  const [devido] = await motoristasComLeituraDevida(1, motoristaId);
  if (devido == null) return { rodou: false as const, motivo: "sem_necessidade" as const };
  return monitorarMotorista(motoristaId);
}

/**
 * Uma rodada do monitoramento para os motoristas com leitura devida.
 * O cron chama isto; a fila da Copadubo continua no caminho dela.
 * Cada motorista tem `INTERVALO_LEITURA_MS` de folga, para o portal não ser
 * martelado a cada minuto.
 */
export async function monitorarTodos(limite = 3, prazoMs = 25_000) {
  const inicio = Date.now();
  if (!temBancoConfigurado) return { motoristas: 0, lidos: 0, falhas: 0, avisos: 0 };
  const devidos = await motoristasComLeituraDevida(limite);

  let lidos = 0;
  let falhas = 0;
  let avisos = 0;
  let pulados = 0;
  for (const motoristaId of devidos) {
    // O ciclo do cron tem 60 s para fila + navios + portal: nunca estoura aqui.
    if (Date.now() - inicio > prazoMs) {
      pulados++;
      continue;
    }
    try {
      const r = await monitorarMotorista(motoristaId);
      if (!r.rodou) continue;
      if (r.ok) lidos++;
      else falhas++;
      if (r.aviso?.enviado) avisos++;
    } catch (e) {
      falhas++;
      console.error("[portal-copadubo] leitura falhou:", e instanceof Error ? e.message : e);
    }
  }
  return { motoristas: devidos.length, lidos, falhas, avisos, ...(pulados ? { pulados } : {}) };
}

/** Resumo textual do último status para o administrador (sem segredo). */
export function diagnosticoTexto(leitura: {
  ok: boolean;
  loginRecusado: boolean;
  captcha: boolean;
  totalLinhas: number;
  ms: number;
  titulo: string | null;
  diagnostico: string | null;
}): string {
  if (leitura.loginRecusado) return "Login recusado pelo portal (CPF/senha).";
  if (leitura.captcha) return "Portal pediu captcha — leitura automática bloqueada.";
  if (!leitura.ok) return "Leitura sem conteúdo.";
  return `${leitura.totalLinhas} linha(s) lidas em ${leitura.ms} ms${leitura.titulo ? ` · ${leitura.titulo}` : ""}`;
}

/** Junta dois endereços do portal sem depender de `new URL` no cliente. */
export function urlPortalRelativa(caminho: string): string {
  return resolverUrl(urlPortal(), caminho);
}

/** Remove qualquer segredo de uma mensagem antes de mostrar/gravar. */
export function semCredenciais(texto: string, credenciais: CredenciaisPortal | null): string {
  let t = texto;
  if (credenciais?.senha && credenciais.senha.length >= 4) t = t.split(credenciais.senha).join("••••");
  const cpf = limparCpf(credenciais?.cpf ?? "");
  if (cpf) t = t.split(cpf).join("•••");
  return t.slice(0, 400);
}

/** Campos que NUNCA podem sair do servidor (checados pelo teste). */
export const CHAVES_SENSIVEIS = ["cpf", "senha", "senhaCifrada", "cookies"];

/** Quantas idas ao portal FALHARAM em seguida, da mais recente para trás. */
export async function contarFalhasSeguidas(motoristaId: number): Promise<number> {
  if (!temBancoConfigurado) return 0;
  const linhas = await comBanco(() =>
    db
      .select({ ok: portalLeituras.ok })
      .from(portalLeituras)
      .where(eq(portalLeituras.motoristaId, motoristaId))
      .orderBy(desc(portalLeituras.id))
      .limit(10),
  );
  let n = 0;
  for (const l of linhas) {
    if (l.ok === 1) break;
    n++;
  }
  return n;
}

/** Quantas vezes SEGUIDAS o portal recusou o login, da mais recente para trás. */
export async function contarRecusasSeguidas(motoristaId: number): Promise<number> {
  if (!temBancoConfigurado) return 0;
  const linhas = await comBanco(() =>
    db
      .select({ recusado: portalLeituras.loginRecusado })
      .from(portalLeituras)
      .where(
        and(
          eq(portalLeituras.motoristaId, motoristaId),
          // Senha cadastrada de novo zera a contagem.
          sql`${portalLeituras.criadoEm} >= coalesce(
            (select a.atualizado_em from portal_motorista_acessos a where a.motorista_id = ${motoristaId}),
            '-infinity'::timestamptz)`,
        ),
      )
      .orderBy(desc(portalLeituras.id))
      .limit(RECUSAS_PARA_PAUSAR + 1),
  );
  let n = 0;
  for (const l of linhas) {
    if (l.recusado !== 1) break;
    n++;
  }
  return n;
}

export { hashConteudo, extrairSecoes };
