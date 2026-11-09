import { and, desc, eq, sql } from "drizzle-orm";
import { comBanco, temBancoConfigurado } from "@/db";
import { db } from "@/db";
import { configuracao, portalEventos, portalMotoristaAcessos, portalLeituras, pontos } from "@/db/schema";
import { enviarPush } from "@/lib/push";
import { credenciaisDoMotorista, garantirTabelasPortal, lerTelasDoMotorista } from "@/lib/portal-copadubo";
import {
  fraseStatus,
  interpretarAtivos,
  interpretarStatus,
  normalizarCodigoPortal,
  posicaoNoPortal,
  type LivroAtivosPortal,
  type SecaoPortal,
  type StatusPortal,
  type TurnoPortal,
} from "@/lib/portal-copadubo-parse";

/**
 * SAÍDA DO PONTO → mensagem com o trabalho.
 *
 * Quando o CopaLinks percebe que o ponto monitorado saiu da tela/quadro
 * (status do fila virou SAIU ou o portal mostra EM ATENDIMENTO), o app entra
 * no site com o CPF/senha do próprio motorista e lê:
 *
 *   1. Status do Ponto  → turno (disponível, em atendimento, em dispensa…),
 *                         motivo da dispensa e há quanto tempo;
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
export const CAMINHOS_PADRAO = ["", "moto/fila.php"];

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
    .filter((c) => c === "" || /^[\w\-./?=&%]+$/.test(c))
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
    .filter((c) => c === "" || /^[\w\-./?=&%]+$/.test(c))
    .slice(0, 6)
    .join(",");
  for (const [chave, valor] of [
    [CHAVE_MODO, modo],
    [CHAVE_CAMINHOS, limpos || CAMINHOS_PADRAO.join(",")],
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

/** Mensagem do aviso a partir do status do ponto + quadro de ativos. */
export function montarEventoSaida(
  status: StatusPortal | null,
  livros: LivroAtivosPortal[],
  codigoMonitorado?: string | null,
): EventoSaida {
  const codigoDigitado = codigoMonitorado ? normalizarCodigoPortal(codigoMonitorado) : null;
  const codigo = status?.codigo ?? codigoDigitado;
  const achado = codigo ? posicaoNoPortal(livros, codigo) : null;
  const livro = achado?.livro ?? (codigo ? livros.find((l) => l.livro === codigo[0]) ?? null : null) ?? null;
  // “Para qual trabalho saiu”: o TIPO da linha do próprio ponto; se ele já saiu
  // do quadro, só usa o último escalado quando for o próprio ponto.
  const tipoTrabalho = achado?.item.tipo || (livro?.ultimo === codigo ? livro.ultimoTipo : null) || null;
  const proximoDaVez = livro?.fila[0]?.codigo ?? null;
  const posicao = achado?.posicao ?? null;
  const turno = status?.turno ?? null;
  const dispensa = turno === "EM DISPENSA";
  const saiu = dispensa || turno === "EM ATENDIMENTO";

  const titulos: Record<string, string> = {
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

  let mensagem: string;
  if (dispensa) {
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
      }),
      trabalho ? `${trabalho}${onde ? ` · ${onde}` : ""}.` : null,
      posicaoTxt ? `${posicaoTxt}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

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
    titulo,
    mensagem,
  };
}

/** Consulta ao detectar a saída, antes do aviso da fila. Nunca usa dados de outro ponto. */
export async function consultarPortalNaSaida(motoristaId: number, codigo: string): Promise<EventoSaida | null> {
  await garantirTabelasPortal();
  const credenciais = await credenciaisDoMotorista(motoristaId);
  if (!credenciais) return null;
  const { caminhos } = await lerModoSaida();
  const leitura = await lerTelasDoMotorista(credenciais, caminhos);
  if (!leitura.ok) return null;
  let status: StatusPortal | null = null;
  let livros: LivroAtivosPortal[] = [];
  let secoesStatus: SecaoPortal[] = [];
  for (const tela of leitura.telas) {
    const s = interpretarStatus(tela.secoes);
    if (!status && s) { status = s; secoesStatus = tela.secoes; }
    if (!livros.length) livros = interpretarAtivos(tela.secoes);
  }
  if (!status || status.codigo !== normalizarCodigoPortal(codigo)) return null;
  // Alimenta o indicador DISPENSA da tela com a mesma leitura recém-confirmada.
  await comBanco(() => db.insert(portalLeituras).values({
    motoristaId, ok: 1, secoes: secoesStatus,
    totalLinhas: secoesStatus.reduce((n, s) => n + s.linhas.length, 0),
    diagnostico: "Consulta do portal ao detectar saída do quadro.",
  }));
  return montarEventoSaida(status, livros, codigo);
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
      return { rodou: false, motivo: "sem_acesso", evento: null, destino: "nenhum", diagnostico: ["Motorista sem CPF/senha do portal."], quando };
    }
    const leitura = await lerTelasDoMotorista(credenciais, caminhos, { buscar: opcoes.buscar });
    diagnostico.push(...leitura.diagnostico);
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

  let status: StatusPortal | null = null;
  let livros: LivroAtivosPortal[] = [];
  for (const tela of telas) {
    if (!status) status = interpretarStatus(tela.secoes);
    if (!livros.length) livros = interpretarAtivos(tela.secoes);
  }
  if (!status) diagnostico.push("A tela de Status do Ponto não apareceu na leitura.");
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
        body: evento.mensagem.slice(0, 180),
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
      mensagem: evento.mensagem.slice(0, 400),
      diagnostico: diagnostico.join("\n").slice(0, 800),
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
