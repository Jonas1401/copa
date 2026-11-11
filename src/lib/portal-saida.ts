import { and, desc, eq, sql } from "drizzle-orm";
import { comBanco, temBancoConfigurado } from "@/db";
import { db } from "@/db";
import { configuracao, portalEventos, portalMotoristaAcessos, portalSaidasPendentes, pontos } from "@/db/schema";
import { enviarPush } from "@/lib/push";
import {
  avisarAcessoPausado,
  credenciaisDoMotorista,
  extrairStatusEAtivos,
  garantirTabelasPortal,
  lerTelasDoMotorista,
  lerTelasNaSessaoGuardada,
  registrarLeituraPortal,
  umPorVez,
  type CredenciaisPortal,
  type TelaLida,
  type TelasDoMotorista,
} from "@/lib/portal-copadubo";
import { fontePortal } from "@/lib/portal-situacao";
import {
  fraseStatus,
  hashConteudo,
  linhasDeInteresse,
  normalizarCodigoPortal,
  posicaoNoPortal,
  todasAsLinhas,
  type LivroAtivosPortal,
  type SecaoPortal,
  type StatusPortal,
  type TurnoPortal,
} from "@/lib/portal-copadubo-parse";

/**
 * SAÍDA DO PONTO → mensagem com o trabalho.
 *
 * Aqui ficam (1) como o que o portal mostra vira a mensagem do aviso —
 * `montarEventoSaida`, `situacaoDoPontoNasTelas` — e (2) o fluxo em que o
 * QUADRO percebe a saída e o portal é consultado uma vez.
 *
 * QUEM DECIDE A SAÍDA: por padrão é o Status do Portal do Motorista, lido de
 * minuto em minuto (`portal-monitor.ts`, que usa as funções de mensagem daqui).
 * O fluxo (2), descrito abaixo, só vale com `PORTAL_FONTE_SAIDA=quadro` — e
 * para os testes manuais do painel do administrador.
 *
 * Quando o CopaLinks percebe que o ponto monitorado saiu do quadro (o status
 * da fila virou SAIU), o app entra no portal com o CPF/senha do próprio
 * motorista e lê:
 *
 *   1. Status do Ponto  → a situação do ponto: ATIVO (continua na fila),
 *                         ESCALADO (saiu para o trabalho, com os dados da
 *                         escala) ou EM DISPENSA (motivo e há quanto tempo);
 *   2. Tela de Ativos   → a fila do livro do ponto: onde ele aparece, o tipo
 *                         de trabalho do dia (TRUCK 4 EIXOS, TRUCK BA 2E…) e o
 *                         último ponto escalado.
 *
 * Com isso monta UM aviso e manda para os aparelhos daquele motorista:
 *
 *   “Seu ponto saiu · A032 — TRUCK 4 EIXOS · Livro A”
 *   “Saiu às 11:32 para FOSPAR (posição 1 da fila do Livro A).”
 *   ou, quando o portal mostra dispensa:
 *   “Seu ponto foi para a DISPENSA (001 - OFICINA). Fica de olho…”
 *
 * A saída automática consulta o portal antes do aviso da fila. O modo abaixo
 * controla apenas os testes manuais e não desativa essa consulta automática.
 */

export const CHAVE_MODO = "portal_saida_modo";
export const CHAVE_CAMINHOS = "portal_saida_caminhos";
/**
 * Caminhos EXTRAS do portal, além dos que o leitor descobre sozinho (a tela de
 * status e as abas do menu). O padrão é nenhum: nada de endereço adivinhado.
 */
export const CAMINHOS_PADRAO: string[] = [];
/** Endereços de versões antigas que o portal não tem (respondem 404). */
const CAMINHOS_ANTIGOS = new Set(["moto/fila.php", "status.php", "moto/status.php"]);
const caminhoValido = (c: string) => c !== "" && /^[\w\-./?=&%]+$/.test(c) && !CAMINHOS_ANTIGOS.has(c);

export type ModoSaida = "desligado" | "somente_admin" | "motoristas";

/**
 * Quem recebe o aviso, por modo:
 *   desligado      → nenhum envio no teste manual;
 *   somente_admin  → só o painel (teste do administrador, NADA no celular);
 *   motoristas     → o celular do motorista (cron e botão do painel).
 */
export function podeEnviarSaida(modo: ModoSaida, _origem: "cron" | "admin"): boolean {
  if (modo === "motoristas") return true;
  return false;
}

/** Tradução do estado do portal para o nome usado nos avisos. */
const ROTULO_TURNO: Record<TurnoPortal, string> = {
  ATIVO: "ATIVO",
  ESCALADO: "ESCALADO",
  "EM DISPENSA": "EM DISPENSA",
  "EM ATENDIMENTO": "EM ATENDIMENTO",
  DESCANSANDO: "EM DESCANSO",
  AGUARDANDO: "DISPONÍVEL",
  FORA: "FORA DE SERVIÇO",
};

export type EventoSaida = {
  /** A saída agora (o ponto não está mais na fila/está em atendimento). */
  saiu: boolean;
  /** Turno informado pelo portal. */
  turno: TurnoPortal | null;
  /** Foi para a dispensa (com motivo). */
  dispensa: boolean;
  motivo: string | null;
  /** Código do ponto que o motorista monitora (A032). */
  codigo: string | null;
  /** Tipo de trabalho do dia (TRUCK 4 EIXOS, TRUCK BA 2E…). */
  tipoTrabalho: string | null;
  livro: string | null;
  /** Posição na fila do portal (1 = primeiro), quando aparece. */
  posicao: number | null;
  ultimoEscalado: string | null;
  /** Quem é o primeiro da fila agora (próximo a ser chamado). */
  proximoDaVez: string | null;
  haMinutos: number | null;
  desde: string | null;
  /** Linhas do cartão do ponto no portal (os dados da escala, quando ESCALADO). */
  detalhes: string[];
  titulo: string;
  mensagem: string;
};

export type ResultadoSaida = {
  rodou: boolean;
  motivo?: string;
  evento: EventoSaida | null;
  /** Para onde o aviso foi (ou seria) enviado. */
  destino: "teste" | "motorista" | "nenhum";
  push?: { enviadas: number; erro?: string };
  /** Diagnóstico legível (sem CPF, senha ou HTML). */
  diagnostico: string[];
  quando: string;
};

/* ------------------------------------------------------------- modo (admin) */

export async function lerModoSaida(): Promise<{ modo: ModoSaida; caminhos: string[] }> {
  if (!temBancoConfigurado) return { modo: "desligado", caminhos: CAMINHOS_PADRAO };
  const linhas = await comBanco(() =>
    db
      .select()
      .from(configuracao)
      .where(sql`${configuracao.chave} in (${CHAVE_MODO}, ${CHAVE_CAMINHOS})`),
  );
  const modo = (linhas.find((l) => l.chave === CHAVE_MODO)?.valor ?? "desligado") as ModoSaida;
  const bruto = linhas.find((l) => l.chave === CHAVE_CAMINHOS)?.valor ?? "";
  const caminhos = bruto
    .split(/[\n,;]+/)
    .map((c) => c.trim().replace(/^\/+/, ""))
    .filter(caminhoValido)
    .slice(0, 6);
  return {
    modo: ["desligado", "somente_admin", "motoristas"].includes(modo) ? modo : "desligado",
    caminhos: caminhos.length ? caminhos : CAMINHOS_PADRAO,
  };
}

export async function gravarModoSaida(modo: ModoSaida, caminhos: string[]) {
  if (!temBancoConfigurado) return;
  const limpos = caminhos
    .map((c) => c.trim().replace(/^\/+/, ""))
    .filter(caminhoValido)
    .slice(0, 6)
    .join(",");
  for (const [chave, valor] of [
    [CHAVE_MODO, modo],
    [CHAVE_CAMINHOS, limpos],
  ] as const) {
    await comBanco(() =>
      db
        .insert(configuracao)
        .values({ chave, valor })
        .onConflictDoUpdate({ target: configuracao.chave, set: { valor } }),
    );
  }
}

/* ------------------------------------------------------------- composição */

/** Tamanho máximo do corpo do aviso (cabe com folga no limite do Web Push). */
const MAX_MENSAGEM = 900;

const semAcentos = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Mensagem do aviso a partir do status do ponto + quadro de ativos. */
export function montarEventoSaida(
  status: StatusPortal | null,
  livros: LivroAtivosPortal[],
  codigoMonitorado?: string | null,
  opcoes: { nomeMotorista?: string | null } = {},
): EventoSaida {
  const codigoDigitado = codigoMonitorado ? normalizarCodigoPortal(codigoMonitorado) : null;
  const codigo = status?.codigo ?? codigoDigitado;
  const achado = codigo ? posicaoNoPortal(livros, codigo) : null;
  const livro = achado?.livro ?? (codigo ? livros.find((l) => l.livro === codigo[0]) ?? null : null) ?? null;
  // “Para qual trabalho saiu”: o TIPO da linha do próprio ponto; se ele já saiu
  // do quadro, só usa o último escalado quando for o próprio ponto.
  const ultimoEhEste = Boolean(livro?.ultimo && codigo && normalizarCodigoPortal(livro.ultimo) === codigo);
  const tipoTrabalho = achado?.item.tipo || (ultimoEhEste ? livro?.ultimoTipo : null) || null;
  const proximoDaVez = livro?.fila[0]?.codigo ?? null;
  const posicao = achado?.posicao ?? null;
  const turno = status?.turno ?? null;
  const dispensa = turno === "EM DISPENSA";
  const escalado = turno === "ESCALADO";
  const saiu = dispensa || escalado || turno === "EM ATENDIMENTO";

  const titulos: Record<TurnoPortal, string> = {
    ESCALADO: "🚛 Seu ponto foi ESCALADO",
    ATIVO: "🟦 Seu ponto está ATIVO",
    "EM DISPENSA": "🟥 Seu ponto foi para a DISPENSA",
    "EM ATENDIMENTO": "🚛 Seu ponto SAIU — trabalho em andamento",
    DESCANSANDO: "😴 Seu ponto está em descanso",
    AGUARDANDO: "🟦 Seu ponto está disponível",
    FORA: "⚠️ Seu ponto está fora de serviço",
  };
  const titulo = (turno && titulos[turno]) || "🚛 Movimento no seu ponto";

  const onde = livro ? `Livro ${livro.livro}` : null;
  const trabalho = tipoTrabalho ? `Trabalho: ${tipoTrabalho}` : null;
  const posicaoTxt = posicao ? `Posição ${posicao} na fila do portal` : null;
  const desde = status?.desde ? `Desde ${status.desde}` : null;
  const ha = status?.haMinutos != null ? `há ${status.haMinutos} min` : null;

  // Linhas do cartão do ponto, sem o nome do próprio motorista (ele já sabe).
  // Só sai a linha que BATE com o nome cadastrado no app: uma linha em
  // maiúsculas pode ser dado da escala (navio, terminal), e esse não se perde.
  const nomeApp = semAcentos(opcoes.nomeMotorista ?? "").split(/\s+/).filter((p) => p.length >= 3);
  const ehONome = (linha: string) =>
    Boolean(status?.nome) &&
    linha === status?.nome &&
    nomeApp.some((p) => semAcentos(linha).split(/\s+/).includes(p));
  const detalhes = (status?.detalhes ?? []).filter((l) => !ehONome(l));

  let mensagem: string;
  if (escalado) {
    // Os dados da escala vão como o portal escreve, linha por linha: o leitor
    // não supõe o nome dos campos (navio, terminal, carga…).
    mensagem = [
      `Seu ponto ${codigo ?? ""} foi ESCALADO.`,
      detalhes.length
        ? detalhes.join("\n")
        : "O portal não mostrou os dados da escala nesta tela — confira no Portal do Motorista.",
      trabalho ? `${trabalho}${onde ? ` · ${onde}` : ""}.` : null,
    ]
      .filter(Boolean)
      .join("\n");
  } else if (dispensa) {
    mensagem = [
      `Seu ponto ${codigo ?? ""} saiu para a DISPENSA${status?.motivo ? ` (motivo ${status.motivo})` : ""}.`,
      ha ? `Está nessa situação ${ha}.` : desde ? `${desde}.` : null,
      "Assim que voltar para a fila, eu aviso.",
    ]
      .filter(Boolean)
      .join(" ");
  } else if (turno === "EM ATENDIMENTO") {
    const fila = [
      livro?.ultimo ? `Último escalado: ${livro.ultimo}` : null,
      proximoDaVez ? `próximo da vez: ${proximoDaVez}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    mensagem = [
      `Seu ponto ${codigo ?? ""} saiu para o trabalho.`,
      trabalho ? `${trabalho}${onde ? ` · ${onde}` : ""}.` : onde ? `${onde}.` : null,
      posicaoTxt ? `${posicaoTxt}.` : null,
      fila ? `${fila}.` : null,
      ha ? `Em atendimento ${ha}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    mensagem = [
      fraseStatus(status ?? {
        codigo,
        cartao: null,
        turno,
        turnoTexto: null,
        desde: null,
        haMinutos: null,
        motivo: null,
        nome: null,
        ehTelaStatus: false,
        detalhes: [],
      }),
      trabalho ? `${trabalho}${onde ? ` · ${onde}` : ""}.` : null,
      posicaoTxt ? `${posicaoTxt}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (mensagem.length > MAX_MENSAGEM) mensagem = `${mensagem.slice(0, MAX_MENSAGEM - 1).trimEnd()}…`;

  return {
    saiu,
    turno,
    dispensa,
    motivo: status?.motivo ?? null,
    codigo,
    tipoTrabalho,
    livro: livro?.livro ?? null,
    posicao,
    ultimoEscalado: livro?.ultimo ?? null,
    proximoDaVez,
    haMinutos: status?.haMinutos ?? null,
    desde: status?.desde ?? null,
    detalhes,
    titulo,
    mensagem,
  };
}

/* --------------------------------------------- consulta automática na saída */

/** Resultado de UMA ida ao portal para conferir a saída de um motorista. */
export type ConsultaPortal = {
  resultado: "lido" | "sem_acesso" | "login_recusado" | "captcha" | "falha";
  telas: Pick<TelaLida, "caminho" | "titulo" | "secoes" | "totalLinhas">[];
  /** Diagnóstico legível (sem CPF, senha, cookie ou HTML). */
  diagnostico: string[];
};

/**
 * Consulta ao detectar a saída, ANTES do aviso: entra no portal com a conta do
 * próprio motorista e lê as telas (Status do Ponto e as abas do menu). Um
 * login só, mesmo que o motorista tenha mais de um ponto saindo.
 *
 * Toda consulta — boa ou ruim — fica em `portal_leituras`: é o que o motorista
 * vê em “Portal do motorista” e o que alimenta o selo DISPENSA do ponto.
 */
export function consultarPortalNaSaida(
  motoristaId: number,
  codigos: string | string[],
  opcoes: { buscar?: typeof fetch } = {},
): Promise<ConsultaPortal> {
  return umPorVez(motoristaId, () => consultarAgora(motoristaId, codigos, opcoes));
}

/**
 * As telas do motorista para uma consulta sob demanda (saída que esperava o
 * portal, teste do painel). Com o Status do portal como fonte do aviso (o
 * padrão), a conta tem UMA sessão — a guardada, que a leitura de minuto em
 * minuto usa: um login novo aqui poderia derrubá-la. Com a fonte `quadro`,
 * cada consulta é um login novo, como sempre foi.
 *
 * Quem chama já está dentro do `umPorVez` deste motorista.
 */
async function lerTelasParaConsulta(
  motoristaId: number,
  credenciais: CredenciaisPortal,
  caminhos: string[],
  opcoes: { buscar?: typeof fetch; codigo?: string | null },
): Promise<TelasDoMotorista> {
  if (fontePortal() === "portal") {
    const telas = await lerTelasNaSessaoGuardada(motoristaId, { ...opcoes, caminhos, origem: "manual", jaNaFila: true });
    if (telas) return telas;
  }
  return lerTelasDoMotorista(credenciais, caminhos, opcoes);
}

async function consultarAgora(
  motoristaId: number,
  codigos: string | string[],
  opcoes: { buscar?: typeof fetch },
): Promise<ConsultaPortal> {
  const principal = (Array.isArray(codigos) ? codigos[0] : codigos) ?? null;
  await garantirTabelasPortal();
  const credenciais = await credenciaisDoMotorista(motoristaId);
  if (!credenciais) {
    return { resultado: "sem_acesso", telas: [], diagnostico: ["Motorista sem CPF/senha do portal (ou com o acesso pausado)."] };
  }
  const { caminhos } = await lerModoSaida();
  const inicio = Date.now();
  const leitura = await lerTelasParaConsulta(motoristaId, credenciais, caminhos, { buscar: opcoes.buscar, codigo: principal });

  const gravada = await guardarConsulta(motoristaId, leitura, principal, Date.now() - inicio, "Consulta do portal ao detectar saída do quadro.");
  if (gravada.pausado) await avisarAcessoPausado(motoristaId, gravada.id);

  return {
    resultado: leitura.loginRecusado ? "login_recusado" : leitura.captcha ? "captcha" : leitura.ok ? "lido" : "falha",
    telas: leitura.telas.map((t) => ({ caminho: t.caminho, titulo: t.titulo, secoes: t.secoes, totalLinhas: t.totalLinhas })),
    diagnostico: leitura.diagnostico,
  };
}

/**
 * Guarda em `portal_leituras` o que uma ida ao portal trouxe: a tela que mostra
 * a situação do ponto (ou, sem ela, a primeira com conteúdo). É também aqui que
 * a recusa de login é contada — duas seguidas pausam o acesso do motorista.
 */
async function guardarConsulta(
  motoristaId: number,
  leitura: TelasDoMotorista,
  codigo: string | null,
  ms: number,
  origem: string,
) {
  const { status, secoesStatus } = extrairStatusEAtivos(leitura.telas, codigo);
  const guardada = status ? null : leitura.telas.find((t) => t.totalLinhas > 0) ?? null;
  const secoes = status ? secoesStatus : guardada?.secoes ?? [];
  return registrarLeituraPortal(motoristaId, {
    ok: leitura.ok,
    loginRecusado: leitura.loginRecusado,
    captcha: leitura.captcha,
    statusHttp: null,
    titulo: status ? "Status do Ponto" : guardada?.titulo ?? "",
    totalLinhas: secoes.reduce((n, s) => n + s.linhas.length, 0),
    secoes,
    sinais: linhasDeInteresse(secoes),
    hash: secoes.length ? hashConteudo(secoes) : "",
    novas: [],
    removidas: [],
    diagnostico: [origem, ...leitura.diagnostico],
    ms,
  });
}

/** O que a consulta diz sobre UM ponto. */
export type SituacaoNoPortal =
  | { tipo: "status"; evento: EventoSaida }
  | { tipo: "sem_acesso" | "login_recusado" | "captcha" }
  | { tipo: "falha"; motivo: string };

/**
 * Procura o ponto nas telas lidas. Nunca usa dados de outro ponto: se o portal
 * mostrar um código diferente do monitorado, é falha (e não uma situação).
 */
export function situacaoDoPontoNasTelas(
  consulta: ConsultaPortal,
  codigo: string,
  opcoes: { nomeMotorista?: string | null } = {},
): SituacaoNoPortal {
  if (consulta.resultado === "sem_acesso" || consulta.resultado === "login_recusado" || consulta.resultado === "captcha") {
    return { tipo: consulta.resultado };
  }
  if (consulta.resultado === "falha") {
    return { tipo: "falha", motivo: consulta.diagnostico[consulta.diagnostico.length - 1] ?? "O portal não respondeu." };
  }
  const alvo = normalizarCodigoPortal(codigo);
  const { status, livros } = extrairStatusEAtivos(consulta.telas, alvo);
  if (!status) return { tipo: "falha", motivo: "A tela de Status do Ponto não apareceu na leitura." };
  if (status.codigo !== alvo) {
    return { tipo: "falha", motivo: `O portal mostrou o ponto ${status.codigo ?? "sem código"}, e não o ${alvo}.` };
  }
  if (!status.turno) {
    return { tipo: "falha", motivo: `O portal mostrou o ponto ${alvo}, mas sem uma situação conhecida (ATIVO / ESCALADO / EM DISPENSA).` };
  }
  // Linha repetida em TODAS as telas é moldura do site (menu, rodapé): não é dado da escala.
  const comTexto = consulta.telas.filter((t) => t.totalLinhas > 0);
  const moldura =
    comTexto.length >= 2
      ? new Set(todasAsLinhas(comTexto[0].secoes).filter((l) => comTexto.every((t) => todasAsLinhas(t.secoes).includes(l))))
      : new Set<string>();
  const limpo: StatusPortal = { ...status, detalhes: status.detalhes.filter((l) => !moldura.has(l)) };
  return { tipo: "status", evento: montarEventoSaida(limpo, livros, alvo, opcoes) };
}

/** Novas consultas enquanto o portal ainda diz ATIVO: +1, +2 e +3 minutos. */
export const ESPERA_NOVA_CONSULTA_MS = 60_000;
export const MAX_CONSULTAS_ATIVO = 4;
/** Só uma nova tentativa quando o portal falhou. */
export const MAX_CONSULTAS_FALHA = 2;
/** Depois deste tempo o aviso sai com o que houver — nunca fica em silêncio. */
export const JANELA_ESPERA_MS = 5 * 60_000;

export type DecisaoSaida =
  | {
      acao: "avisar";
      /** O que vai para o `notificarEvento` (null = aviso clássico do quadro). */
      portal: { saiu: boolean; titulo: string; mensagem: string; observacao?: string } | null;
      /** Linha do histórico do app. */
      historico: string;
      motivo: string;
    }
  | { acao: "aguardar"; emMs: number; motivo: string };

/**
 * Decide o aviso de saída. Função pura (testada sem banco e sem rede).
 *
 *   ESCALADO / EM DISPENSA / EM ATENDIMENTO → avisa já, com os dados do portal;
 *   ATIVO (ou outra situação de fila) e o número é o Último Escalado do quadro
 *       → avisa já pelo quadro (o portal ainda não registrou a escala);
 *   ATIVO e o número só sumiu do quadro → espera e consulta de novo (+1, +2,
 *       +3 min); se o ponto voltar ao quadro, a varredura cancela sem avisar;
 *       se continuar ATIVO, sai um aviso dizendo exatamente isso;
 *   falha de leitura → uma nova tentativa no ciclo seguinte, depois o aviso
 *       clássico; login recusado, captcha ou sem acesso → aviso clássico já.
 */
export function decidirAvisoDeSaida(e: {
  codigo: string;
  situacao: SituacaoNoPortal;
  ehUltimoEscalado: boolean;
  /** Consultas já feitas para esta saída, contando a atual. */
  tentativas: number;
  /** Tempo desde que o ponto saiu do quadro. */
  idadeMs: number;
}): DecisaoSaida {
  const classico = (motivo: string): DecisaoSaida => ({
    acao: "avisar",
    portal: null,
    historico: `${e.codigo} não está mais no quadro · destino não confirmado`,
    motivo,
  });
  const dentroDaJanela = e.idadeMs < JANELA_ESPERA_MS;

  const situacao = e.situacao;
  if (situacao.tipo !== "status") {
    if (situacao.tipo === "falha") {
      if (!e.ehUltimoEscalado && dentroDaJanela && e.tentativas < MAX_CONSULTAS_FALHA) {
        return { acao: "aguardar", emMs: ESPERA_NOVA_CONSULTA_MS, motivo: `${situacao.motivo} Nova tentativa no próximo ciclo.` };
      }
      return classico(situacao.motivo);
    }
    // Sem como entrar: insistir só repetiria a mesma recusa na conta do motorista.
    if (situacao.tipo === "login_recusado") return classico("O portal recusou o CPF/senha.");
    if (situacao.tipo === "captcha") return classico("O portal pediu captcha.");
    return classico("Motorista sem acesso ativo ao portal.");
  }

  const evento = situacao.evento;
  if (evento.saiu) {
    const resumo = evento.mensagem.replace(/\s*\n\s*/g, " · ").replace(/^Seu ponto /, "");
    return {
      acao: "avisar",
      portal: { saiu: true, titulo: evento.titulo, mensagem: evento.mensagem },
      historico: resumo.length > 240 ? `${resumo.slice(0, 239)}…` : resumo,
      motivo: `Portal: ${evento.turno}.`,
    };
  }

  const rotulo = evento.turno ? ROTULO_TURNO[evento.turno] : "sem situação";
  if (e.ehUltimoEscalado) {
    return {
      acao: "avisar",
      portal: {
        saiu: false,
        titulo: evento.titulo,
        mensagem: evento.mensagem,
        observacao: `No Portal do Motorista o ponto ainda aparece como ${rotulo}: a escala ainda não foi registrada lá.`,
      },
      historico: `${e.codigo} é o Último Escalado do quadro · portal ainda mostra ${rotulo}`,
      motivo: `Portal: ${rotulo}; o quadro confirma a chamada.`,
    };
  }
  if (dentroDaJanela && e.tentativas < MAX_CONSULTAS_ATIVO) {
    return {
      acao: "aguardar",
      emMs: ESPERA_NOVA_CONSULTA_MS,
      motivo: `Portal: ${rotulo}. O ponto saiu do quadro mas o portal ainda não mostra escala nem dispensa; nova consulta em 1 minuto.`,
    };
  }
  return {
    acao: "avisar",
    portal: {
      saiu: false,
      titulo: evento.titulo,
      mensagem: evento.mensagem,
      observacao: `No Portal do Motorista o ponto continua ${rotulo}, sem escala nem dispensa registradas.`,
    },
    historico: `${e.codigo} não está mais no quadro · portal mostra ${rotulo}`,
    motivo: `Portal: ${rotulo} depois de ${e.tentativas} consulta(s).`,
  };
}

/* ------------------------------------------- avisos de saída em espera (fila) */

export type SaidaPendente = typeof portalSaidasPendentes.$inferSelect;

/** O motorista tem CPF/senha do portal cadastrados e o acesso não está pausado. */
export async function temAcessoPortalAtivo(motoristaId: number): Promise<boolean> {
  if (!temBancoConfigurado) return false;
  await garantirTabelasPortal();
  const [acesso] = await comBanco(() =>
    db
      .select({ ativo: portalMotoristaAcessos.ativo })
      .from(portalMotoristaAcessos)
      .where(eq(portalMotoristaAcessos.motoristaId, motoristaId))
      .limit(1),
  );
  return acesso?.ativo === 1;
}

/**
 * Guarda a saída de um ponto para ser conferida no portal. O registro é
 * DURÁVEL: se a função da hospedagem for encerrada no meio da consulta, o
 * próximo ciclo retoma — o aviso não se perde.
 */
export async function agendarSaidaPendente(dados: {
  pontoId: number;
  motoristaId: number;
  codigo: string;
  tipo: string;
  livro: string;
  numero: number;
  codigoNaVez: string;
  saidaPorUltimo: boolean;
}): Promise<boolean> {
  if (!temBancoConfigurado) return false;
  await garantirTabelasPortal();
  // Os horários são do relógio do BANCO (`now()`), o mesmo que a reserva usa:
  // uma diferença de relógio entre o servidor e o banco não atrasa a consulta.
  const valores = {
    motoristaId: dados.motoristaId,
    codigo: dados.codigo,
    tipo: dados.tipo,
    livro: dados.livro,
    numero: dados.numero,
    codigoNaVez: dados.codigoNaVez,
    saidaPorUltimo: dados.saidaPorUltimo ? 1 : 0,
    tentativas: 0,
    proximaEm: sql`now()`,
    emAndamentoAte: null,
    ultimoStatus: null,
    criadoEm: sql`now()`,
  };
  await comBanco(() =>
    db
      .insert(portalSaidasPendentes)
      .values({ pontoId: dados.pontoId, ...valores })
      .onConflictDoUpdate({ target: portalSaidasPendentes.pontoId, set: valores }),
  );
  return true;
}

/**
 * Reserva as saídas vencidas de UM motorista (o que espera há mais tempo).
 * A reserva é atômica e por motorista: duas funções rodando ao mesmo tempo
 * nunca fazem dois logins simultâneos na mesma conta.
 */
export async function reivindicarSaidasPendentes(): Promise<SaidaPendente[]> {
  if (!temBancoConfigurado) return [];
  await garantirTabelasPortal();
  return comBanco(() =>
    db
      .update(portalSaidasPendentes)
      .set({
        emAndamentoAte: sql`now() + interval '45 seconds'`,
        tentativas: sql`${portalSaidasPendentes.tentativas} + 1`,
      })
      .where(
        and(
          sql`${portalSaidasPendentes.motoristaId} = (
            select s.motorista_id from portal_saidas_pendentes s
            where s.proxima_em <= now()
              and (s.em_andamento_ate is null or s.em_andamento_ate < now())
              and not exists (
                select 1 from portal_saidas_pendentes o
                where o.motorista_id = s.motorista_id and o.em_andamento_ate >= now()
              )
            order by s.proxima_em, s.id
            limit 1
          )`,
          sql`${portalSaidasPendentes.proximaEm} <= now()`,
          sql`(${portalSaidasPendentes.emAndamentoAte} is null or ${portalSaidasPendentes.emAndamentoAte} < now())`,
        ),
      )
      .returning(),
  );
}

/** Encerra a espera. `true` só para quem de fato removeu (é quem pode avisar). */
export async function concluirSaidaPendente(id: number): Promise<boolean> {
  const removidas = await comBanco(() =>
    db.delete(portalSaidasPendentes).where(eq(portalSaidasPendentes.id, id)).returning({ id: portalSaidasPendentes.id }),
  );
  return removidas.length > 0;
}

/** Marca uma nova consulta para daqui a `emMs` e libera a reserva. */
export async function adiarSaidaPendente(id: number, emMs: number, ultimoStatus: string | null) {
  await comBanco(() =>
    db
      .update(portalSaidasPendentes)
      .set({
        // Relógio do banco, como em `agendarSaidaPendente` e na reserva.
        proximaEm: sql`now() + (${Math.max(0, Math.round(emMs))} * interval '1 millisecond')`,
        emAndamentoAte: null,
        ultimoStatus,
      })
      .where(eq(portalSaidasPendentes.id, id)),
  );
}

/**
 * O ponto voltou ao quadro antes de o aviso de saída sair: cancela a espera.
 * `true` = havia um aviso em espera (a saída não chegou a ser avisada).
 */
export async function cancelarSaidaPendenteDoPonto(pontoId: number): Promise<boolean> {
  if (!temBancoConfigurado) return false;
  await garantirTabelasPortal();
  const removidas = await comBanco(() =>
    db.delete(portalSaidasPendentes).where(eq(portalSaidasPendentes.pontoId, pontoId)).returning({ id: portalSaidasPendentes.id }),
  );
  return removidas.length > 0;
}

/**
 * Deixa no painel do administrador o que a consulta automática viu e decidiu
 * (telas, linhas, abas do menu, situação). É o que permite conferir a leitura
 * do portal sem pedir a senha de ninguém.
 */
export async function registrarConsultaAutomatica(dados: {
  motoristaId: number;
  codigo: string;
  livro: string;
  situacao: SituacaoNoPortal;
  decisao: DecisaoSaida;
  tentativa: number;
  diagnostico: string[];
}) {
  if (!temBancoConfigurado) return;
  const evento = dados.situacao.tipo === "status" ? dados.situacao.evento : null;
  const avisou = dados.decisao.acao === "avisar";
  const portal = dados.decisao.acao === "avisar" ? dados.decisao.portal : null;
  // Só é “aviso do portal” quando o portal confirmou a saída (ESCALADO / EM
  // DISPENSA). Nos demais, o motorista recebeu o aviso do quadro.
  const peloPortal = Boolean(portal?.saiu);
  const mensagem = peloPortal && portal ? portal.mensagem : [dados.decisao.motivo, portal?.observacao].filter(Boolean).join(" ");
  await comBanco(() =>
    db.insert(portalEventos).values({
      motoristaId: dados.motoristaId,
      tipo: evento?.dispensa ? "dispensa" : evento?.saiu ? "saida" : "consulta",
      codigo: normalizarCodigoPortal(dados.codigo),
      turno: evento?.turno ?? null,
      motivo: evento?.motivo ?? null,
      tipoTrabalho: evento?.tipoTrabalho ?? null,
      livro: evento?.livro ?? dados.livro,
      destino: avisou ? "motorista" : "nenhum",
      titulo: !avisou ? "Aguardando o portal" : peloPortal ? evento?.titulo ?? "Aviso de saída" : "Aviso de saída pelo quadro",
      mensagem: mensagem.slice(0, 900),
      diagnostico: [`Consulta automática nº ${dados.tentativa} · ${dados.decisao.motivo}`, ...dados.diagnostico].join("\n").slice(0, 1_500),
      modo: "automatico",
    }),
  );
  await comBanco(() => db.delete(portalEventos).where(sql`${portalEventos.criadoEm} < now() - interval '30 days'`));
}

/** Nome do motorista para o título do aviso (sem expor CPF). */
async function assinatura(motoristaId: number) {
  return `PORTAL_SAIDA_M${motoristaId}_${new Date().toISOString().slice(0, 13).replace(/\D/g, "")}`;
}

/**
 * Executa a checagem de saída de UM motorista.
 *
 * `origem`:
 *   - "cron": rotina automática. Só envia se o modo for `motoristas`.
 *   - "admin": botão do administrador. Com modo `somente_admin` (o padrão de
 *     teste) o aviso é registrado e NÃO vai para o celular do motorista.
 */
export async function verificarSaidaDoMotorista(
  motoristaId: number,
  opcoes: { origem: "cron" | "admin"; forcar?: boolean; buscar?: typeof fetch; telas?: { secoes: SecaoPortal[]; caminho: string }[] } = {
    origem: "admin",
  },
): Promise<ResultadoSaida> {
  const quando = new Date().toISOString();
  const { modo, caminhos } = await lerModoSaida();
  const diagnostico: string[] = [];
  if (!temBancoConfigurado) {
    return { rodou: false, motivo: "sem_banco", evento: null, destino: "nenhum", diagnostico, quando };
  }
  await garantirTabelasPortal();

  let telas = opcoes.telas ?? null;
  if (!telas) {
    const credenciais = await credenciaisDoMotorista(motoristaId);
    if (!credenciais) {
      return {
        rodou: false,
        motivo: "sem_acesso",
        evento: null,
        destino: "nenhum",
        diagnostico: ["Motorista sem CPF/senha do portal (ou com o acesso pausado por senha recusada)."],
        quando,
      };
    }
    // O teste do painel também é uma ida de verdade à conta do motorista: uma
    // por vez, guardada como as demais leituras e contada na pausa por recusa.
    const inicio = Date.now();
    const leitura = await umPorVez(motoristaId, () => lerTelasParaConsulta(motoristaId, credenciais, caminhos, { buscar: opcoes.buscar }));
    diagnostico.push(...leitura.diagnostico);
    const gravada = await guardarConsulta(motoristaId, leitura, null, Date.now() - inicio, "Leitura pedida no painel do administrador.");
    if (gravada.pausado) {
      diagnostico.push("Segunda recusa seguida: o acesso deste motorista foi pausado até ele cadastrar a senha de novo no app.");
      await avisarAcessoPausado(motoristaId, gravada.id);
    }
    if (!leitura.ok) {
      return {
        rodou: true,
        motivo: leitura.loginRecusado ? "login_recusado" : leitura.captcha ? "captcha" : "sem_conteudo",
        evento: null,
        destino: "nenhum",
        diagnostico,
        quando,
      };
    }
    telas = leitura.telas.map((t) => ({ caminho: t.caminho, secoes: t.secoes }));
  } else {
    diagnostico.push("Telas simuladas (teste do administrador).");
  }

  const { status, livros } = extrairStatusEAtivos(telas);
  if (!status) diagnostico.push("A tela de Status do Ponto não apareceu na leitura.");
  else if (!status.turno) diagnostico.push("A tela mostrou o ponto, mas sem uma situação conhecida (ATIVO / ESCALADO / EM DISPENSA).");
  if (!livros.length) diagnostico.push("A Tela de Ativos não apareceu na leitura.");

  const evento = montarEventoSaida(status, livros);
  diagnostico.push(
    `Status: ${status?.turno ?? "não lido"}${status?.motivo ? ` (${status.motivo})` : ""} · quadro(s): ${livros.map((l) => l.livro).join("/") || "nenhum"}`,
  );

  // Envio: só quando o motorista pediu para sair E o modo permite.
  let destino: ResultadoSaida["destino"] = "nenhum";
  let push: ResultadoSaida["push"];
  const podeEnviar = podeEnviarSaida(modo, opcoes.origem);
  if (!podeEnviar) {
    diagnostico.push(
      modo === "desligado"
        ? "Modo de teste desligado: nada é enviado (só o registro no painel)."
        : "Modo de teste do administrador: este aviso não vai para o celular do motorista.",
    );
  } else if (!evento.saiu) {
    diagnostico.push("O ponto não consta como saído agora — nenhum aviso enviado.");
  } else {
    destino = opcoes.origem === "admin" && modo === "somente_admin" ? "teste" : "motorista";
    const r = await enviarPush(
      {
        title: evento.titulo,
        body: evento.mensagem,
        tag: await assinatura(motoristaId),
        acao: "portal-saida",
        url: "/",
      },
      { motoristaId, unica: true },
    ).catch((e: unknown) => ({ enviadas: 0, erro: e instanceof Error ? e.message.slice(0, 80) : "falha" }));
    push = { enviadas: r.enviadas, ...(("erro" in r && r.erro) ? { erro: String(r.erro).slice(0, 120) } : {}) };
    diagnostico.push(push.enviadas ? `Web Push enviado para ${push.enviadas} aparelho(s).` : "Nenhum aparelho recebeu (sem inscrição ativa).");
  }

  await comBanco(() =>
    db.insert(portalEventos).values({
      motoristaId,
      tipo: evento.dispensa ? "dispensa" : evento.saiu ? "saida" : "movimento",
      codigo: evento.codigo,
      turno: evento.turno,
      motivo: evento.motivo,
      tipoTrabalho: evento.tipoTrabalho,
      livro: evento.livro,
      destino,
      titulo: evento.titulo,
      mensagem: evento.mensagem.slice(0, 900),
      diagnostico: diagnostico.join("\n").slice(0, 1_500),
      modo,
    }),
  );

  return { rodou: true, evento, destino, ...(push ? { push } : {}), diagnostico, quando };
}

/** Últimos avisos/registros de saída (o painel do administrador mostra). */
export async function ultimosEventosSaida(limite = 15) {
  if (!temBancoConfigurado) return [];
  await garantirTabelasPortal();
  const linhas = await comBanco(() =>
    db.select().from(portalEventos).orderBy(desc(portalEventos.id)).limit(Math.min(50, Math.max(1, limite))),
  );
  return linhas.map((l) => ({
    id: l.id,
    motoristaId: l.motoristaId,
    tipo: l.tipo,
    codigo: l.codigo,
    turno: l.turno,
    motivo: l.motivo,
    tipoTrabalho: l.tipoTrabalho,
    livro: l.livro,
    destino: l.destino,
    titulo: l.titulo,
    mensagem: l.mensagem,
    diagnostico: (l.diagnostico ?? "").split("\n").filter(Boolean),
    modo: l.modo,
    quando: l.criadoEm.toISOString(),
  }));
}

/** Motoristas que podem ser escolhidos no teste do administrador. */
export async function motoristasParaTeste() {
  if (!temBancoConfigurado) return [];
  await garantirTabelasPortal();
  const linhas = await comBanco(() =>
    db
      .select({ motoristaId: portalMotoristaAcessos.motoristaId, ativo: portalMotoristaAcessos.ativo })
      .from(portalMotoristaAcessos)
      .where(and(eq(portalMotoristaAcessos.ativo, 1)))
      .orderBy(portalMotoristaAcessos.motoristaId),
  );
  return linhas;
}


/**
 * Rotina automática do cron: quem teve ponto marcado como SAIU nos últimos
 * minutos (a fila da Copadubo detectou a saída) e tem CPF/senha do portal
 * cadastrado. É esse gancho que faz o app “entrar no site quando detecta que
 * saiu da tela” — e cada motorista é checado uma única vez por saída graças à
 * tag do Push (que já impede repetição).
 */
export async function verificarSaidasRecentes(janelaMin = 4, limite = 2) {
  if (!temBancoConfigurado) return { motoristas: 0, tentados: 0, resultados: [] as ResultadoSaida[] };
  const { modo } = await lerModoSaida();
  if (modo === "desligado") return { motoristas: 0, tentados: 0, resultados: [] as ResultadoSaida[] };
  await garantirTabelasPortal();

  const recentes = await comBanco(() =>
    db
      .selectDistinct({ motoristaId: pontos.motoristaId })
      .from(pontos)
      .where(
        and(
          sql`${pontos.status} = 'SAIU'`,
          sql`${pontos.saidaEm} > now() - (${janelaMin} * interval '1 minute')`,
          sql`${pontos.motoristaId} is not null`,
        ),
      ),
  );
  const ids = recentes.map((r) => r.motoristaId).filter((id): id is number => typeof id === "number");

  const resultados: ResultadoSaida[] = [];
  for (const motoristaId of ids.slice(0, limite)) {
    // Já avisado nesta saída? (o evento mais recente é desta mesma hora)
    const [ultimo] = await comBanco(() =>
      db
        .select({ em: portalEventos.criadoEm })
        .from(portalEventos)
        .where(and(eq(portalEventos.motoristaId, motoristaId), sql`${portalEventos.criadoEm} > now() - interval '30 minutes'`))
        .orderBy(desc(portalEventos.id))
        .limit(1),
    );
    if (ultimo) continue;
    resultados.push(await verificarSaidaDoMotorista(motoristaId, { origem: "cron" }));
  }
  return { motoristas: ids.length, tentados: resultados.length, resultados };
}

export const CHAVE_TICK = "portal_saida_ultimo_tick";
/** Intervalo mínimo entre duas rodadas do gancho que roda com o app aberto. */
export const TICK_MIN_MS = 3 * 60_000;

/**
 * Gancho que roda junto do `/api/estado` (o app aberto chama a cada 5 s).
 *
 * Existe porque o cron do projeto é DIÁRIO: sem isto, o aviso de saída só
 * sairia no dia seguinte. Aqui a checagem é no máximo a cada 3 minutos por
 * instância, em segundo plano (`after()`), e continua sem custo quando o modo
 * está desligado.
 */
export async function tickSaidaPortal(agora = Date.now()) {
  if (!temBancoConfigurado) return { rodou: false, motivo: "sem_banco" as const };
  const { modo } = await lerModoSaida();
  if (modo === "desligado") return { rodou: false, motivo: "desligado" as const };

  const [ultimo] = await comBanco(() =>
    db.select().from(configuracao).where(eq(configuracao.chave, CHAVE_TICK)).limit(1),
  );
  const desde = Number(ultimo?.valor ?? 0);
  if (Number.isFinite(desde) && agora - desde < TICK_MIN_MS) return { rodou: false, motivo: "aguardando" as const };

  await comBanco(() =>
    db
      .insert(configuracao)
      .values({ chave: CHAVE_TICK, valor: String(agora) })
      .onConflictDoUpdate({ target: configuracao.chave, set: { valor: String(agora) } }),
  );
  const r = await verificarSaidasRecentes(4, 2);
  return { rodou: true, modo, ...r };
}
