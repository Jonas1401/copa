import { eq, sql } from "drizzle-orm";
import { comBanco, db, temBancoConfigurado } from "@/db";
import { pontos, portalEventos, portalSituacoes } from "@/db/schema";
import { codigoDe, registrarEvento, ROTULO_TIPO, varrer, type Livro, type Tipo } from "@/lib/estado";
import { nomeDoMotorista, notificarEvento } from "@/lib/push";
import {
  avisarAcessoPausado,
  avisarLeituraParada,
  CAMINHO_STATUS,
  contarFalhasSeguidas,
  lerEGuardarPortal,
  lerFilaNaSessaoGuardada,
  lerTelasNaSessaoGuardada,
  marcarProximaLeitura,
  monitorarMotorista as lerPortalComLoginNovo,
  monitorarTodos as monitorarPontosForaDoQuadro,
  reservarLeiturasDevidas,
  type OrigemLeitura,
} from "@/lib/portal-copadubo";
import { normalizarCodigoPortal } from "@/lib/portal-copadubo-parse";
import {
  filaGuardada,
  fonteDaFila,
  guardarFilaLida,
  livrosDaFila,
  motivoDaFilaSumida,
  registrarFalhaDaFila,
  reservarLivrosDaFila,
  resumoDaFila,
} from "@/lib/portal-fila";
import type { LivroDaFila } from "@/lib/portal-fila-parse";
import { lerTicketsDevidos } from "@/lib/portal-ticket";
import { lerModoSaida, situacaoDoPontoNasTelas, type ConsultaPortal, type EventoSaida } from "@/lib/portal-saida";
import {
  avisoDaTroca,
  esperaEntreLeiturasMs,
  fontePortal,
  intervaloStatusMs,
  registrarSituacaoLida,
  situacaoFresca,
  situacoesDoMotorista,
  type AvisoDoPortal,
} from "@/lib/portal-situacao";

/**
 * MONITOR DO STATUS — o Portal do Motorista como fonte do “saiu trabalho”.
 *
 * De minuto em minuto, para cada motorista que cadastrou o CPF e a senha do
 * portal e tem um ponto no app:
 *
 *   1. abre a tela de Status na conta DELE, com a sessão que ficou guardada
 *      (um pedido só; o login só se repete quando o portal pedir);
 *   2. lê a situação de cada ponto dele — ATIVO, ESCALADO ou EM DISPENSA;
 *   3. compara com a situação guardada e, se mudou, envia UM aviso com as
 *      informações do Status:
 *        → ESCALADO      “Seu ponto foi ESCALADO” + as linhas do cartão;
 *        → EM DISPENSA   “Seu ponto foi para a DISPENSA” + motivo;
 *        → ATIVO         “Seu ponto está ATIVO” (voltou para a fila).
 *      Só nessa hora ele abre também as outras abas do menu, na mesma sessão:
 *      com mais de uma tela dá para tirar do aviso o que é moldura do site
 *      (menu, rodapé) e juntar o tipo de trabalho da aba de fila.
 *
 * O quadro público da fila não participa: ele só mostra a fila e avisa que a
 * vez está chegando. Quem não cadastrou o acesso ao portal não é monitorado
 * aqui — e não recebe aviso de saída.
 *
 * Garantias:
 *   - a troca da situação é atômica no banco: a mesma mudança lida por duas
 *     funções ao mesmo tempo gera um aviso só;
 *   - a primeira leitura de um ponto é só o ponto de partida (nada de aviso de
 *     uma escala que já estava lá);
 *   - cartão de outro ponto nunca vira a situação deste;
 *   - três leituras seguidas sem a situação avisam o motorista que o aviso de
 *     saída está parado, e a leitura passa a esperar 5 min entre tentativas.
 */

/** Depois de 3 leituras seguidas sem a situação, a próxima espera isto. */
export const ESPERA_APOS_FALHAS_STATUS_MS = 5 * 60_000;
/** Tempo, por rodada, em que novas leituras podem COMEÇAR. */
const PRAZO_RODADA_MS = 25_000;
/** Quantos motoristas são lidos ao mesmo tempo (cada um, sempre um por vez). */
const SIMULTANEOS = 3;
/**
 * A aba “Fila” pega carona na leitura do Status (até 14 s a mais). Com o portal
 * lento, a carona estouraria o tempo da função: se a conta levou mais do que
 * isto para abrir, a fila fica para a próxima leitura. A rodada do cron tem
 * 60 s (25 s para começar leituras); “Ler agora” e o cadastro do acesso, 45 s.
 */
export const CARONA_DA_FILA_ATE_MS = { periodica: 12_000, manual: 25_000 } as const;
/**
 * A aba “Ticket” (Saldo de Ganhos) vem DEPOIS da rodada do Status, com a
 * sessão que ela deixou guardada, e só enquanto sobra tempo na função: cada
 * leitura leva até 12 s. Contado a partir do começo do cron (60 s no total) e
 * da rodada do app aberto. O que não couber fica para a próxima rodada.
 */
export const TICKET_COMECA_ATE_MS = { cron: 36_000, appAberto: 20_000 } as const;

/** O que a leitura trouxe para UM ponto do motorista. */
export type SituacaoLida = {
  /** Código como o portal escreve (A032). */
  codigo: string;
  /** Situação lida; vazio quando a tela não mostrou este ponto. */
  turno: string | null;
  /** A situação é diferente da que estava guardada. */
  mudou: boolean;
  /** Aviso enviado por causa da troca. */
  aviso: AvisoDoPortal;
  /** Por que não há situação (ex.: a tela mostrou outro ponto). */
  motivo?: string;
};

type MeuPonto = { id: number; tipo: string; livro: string; numero: number };

const codigoNoPortal = (p: Pick<MeuPonto, "livro" | "numero">) => normalizarCodigoPortal(`${p.livro}${p.numero}`);

/** Linha curta para o histórico do app, a partir do texto do aviso. */
function linhaDoHistorico(mensagem: string): string {
  const resumo = mensagem.replace(/\s*\n\s*/g, " · ").replace(/^Seu ponto /, "");
  return resumo.length > 240 ? `${resumo.slice(0, 239)}…` : resumo;
}

/** Texto do aviso de VOLTA: o portal mostra o ponto na fila de novo. */
function textoDaVolta(evento: EventoSaida, codigo: string, anterior: string) {
  const antes = anterior === "EM DISPENSA" ? "EM DISPENSA" : "ESCALADO";
  const mensagem =
    evento.turno === "ATIVO"
      ? `Seu ponto ${codigo} voltou para a fila: o Status do Portal do Motorista mostra ATIVO (antes: ${antes}).`
      : `${evento.mensagem} Antes estava ${antes}.`;
  return { titulo: evento.titulo, mensagem };
}

/** Envia o aviso da troca e deixa o registro no histórico e no painel. */
async function avisarTroca(dados: {
  motoristaId: number;
  ponto: MeuPonto;
  codigo: string;
  aviso: Exclude<AvisoDoPortal, null>;
  evento: EventoSaida;
  anterior: string;
  instante: Date | null;
}) {
  const { ponto, evento, aviso } = dados;
  const tipo = ponto.tipo as Tipo;
  const livro = ponto.livro as Livro;
  const codigoApp = codigoDe(ponto.livro, ponto.numero);
  const texto =
    aviso === "voltou"
      ? textoDaVolta(evento, dados.codigo, dados.anterior)
      : { titulo: evento.titulo, mensagem: evento.mensagem };

  // A troca já está gravada: só esta chamada avisa. Uma falha passageira do
  // banco no envio ganha UMA nova tentativa (a tag é a mesma: não duplica).
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      await notificarEvento({
        acao: aviso === "voltou" ? "voltou" : "saiu",
        tipo,
        livro,
        codigo: codigoApp,
        codigoNaVez: codigoApp,
        rotulo: ROTULO_TIPO[tipo],
        motoristaId: dados.motoristaId,
        portal: { saiu: aviso !== "voltou", titulo: texto.titulo, mensagem: texto.mensagem },
        instante: dados.instante,
      });
      break;
    } catch {
      if (tentativa === 1) console.error("[portal-monitor] Falha no envio do aviso", aviso, codigoApp);
      else await new Promise((r) => setTimeout(r, 400));
    }
  }

  await registrarEvento({
    codigo: codigoApp,
    tipo,
    livro,
    numero: ponto.numero,
    acao: aviso === "voltou" ? "voltou" : "saiu",
    mensagem: linhaDoHistorico(texto.mensagem),
  }).catch(() => null);

  // Painel do administrador: o que o Status mostrou e o que foi avisado.
  await comBanco(() =>
    db.insert(portalEventos).values({
      motoristaId: dados.motoristaId,
      tipo: aviso === "dispensa" ? "dispensa" : aviso === "saiu" ? "saida" : "movimento",
      codigo: dados.codigo,
      turno: evento.turno,
      motivo: evento.motivo,
      tipoTrabalho: evento.tipoTrabalho,
      livro: evento.livro ?? ponto.livro,
      destino: "motorista",
      titulo: texto.titulo,
      mensagem: texto.mensagem.slice(0, 900),
      diagnostico: `Status do portal: ${dados.anterior} → ${evento.turno ?? "?"}. Aviso enviado pela leitura do Status.`,
      modo: "automatico",
    }),
  ).catch(() => null);
}

/**
 * A FILA GERAL — a aba “Fila” do portal (a Tela de Ativos), na carona de uma
 * olhada do Status.
 *
 * A conta de um motorista acabou de abrir: se a fila guardada já pode ser lida
 * de novo (uma vez por ciclo, para todos os motoristas juntos), a mesma sessão
 * abre a aba “Fila” — um pedido a mais — e o resultado fica guardado para o
 * app inteiro: é dele que saem o card principal, a posição de cada ponto e os
 * avisos de “perto da vez” e “na vez”. A reserva é atômica: com vários
 * motoristas lidos no mesmo minuto, só um abre a fila.
 *
 * Da tela só se guarda a fila (igual para todos); nada da conta de quem abriu.
 * `forcar`: alguém tocou em “Ler agora” — lê sem esperar a hora, e o que a
 * tela trouxe (ou por que não serviu) volta no diagnóstico.
 */
export async function atualizarFilaDoPortal(
  motoristaId: number,
  opcoes: { buscar?: typeof fetch; forcar?: boolean } = {},
): Promise<{ tentou: boolean; lidos: LivroDaFila[]; diagnostico: string[] }> {
  const nada = { tentou: false, lidos: [] as LivroDaFila[], diagnostico: [] as string[] };
  if (!temBancoConfigurado || fonteDaFila() !== "portal") return nada;
  const devidos = await reservarLivrosDaFila(livrosDaFila(), { forcar: opcoes.forcar });
  if (!devidos.length) return nada;

  const lida = await lerFilaNaSessaoGuardada(motoristaId, { buscar: opcoes.buscar, livros: devidos });
  if (!lida) {
    const motivo = "a conta não tem mais acesso ativo ao portal";
    for (const livro of devidos) await registrarFalhaDaFila(livro, motivo, motoristaId).catch(() => null);
    return { tentou: true, lidos: [], diagnostico: [`Fila: ${motivo}.`] };
  }
  const lidos: LivroDaFila[] = [];
  const diagnostico = [...lida.diagnostico];
  const guardadas = await filaGuardada().catch(() => []);
  for (const livro of devidos) {
    const quadros = lida.livros[livro];
    // Fila grande que “sumiu” de um minuto para o outro: não é aceita.
    const sumiu = quadros ? motivoDaFilaSumida(guardadas.find((g) => g.livro === livro), quadros) : null;
    if (quadros && sumiu) {
      diagnostico.push(`Fila do Livro ${livro}: ${sumiu}.`);
      await registrarFalhaDaFila(livro, sumiu, motoristaId, lida.diagnostico).catch(() => null);
    } else if (quadros) {
      await guardarFilaLida(livro, quadros, motoristaId);
      lidos.push(livro);
    } else {
      await registrarFalhaDaFila(livro, lida.falhas[livro] ?? "a tela não trouxe a fila deste livro", motoristaId, lida.diagnostico).catch(
        () => null,
      );
    }
  }
  // A fila nova já vale: a posição dos pontos e os avisos de “perto da vez” e
  // “na vez” saem agora, sem esperar a próxima varredura.
  if (lidos.length) await varrer().catch(() => null);
  return { tentou: true, lidos, diagnostico };
}

/**
 * Olha o Status de UM motorista agora e avisa o que mudou.
 *
 * `origem`: `periodica` (o ciclo de 1 em 1 minuto, com o freio de logins) ou
 * `manual` (alguém tocou em “Ler agora”: sem freio). Em qualquer uma a troca
 * de situação é avisada — quem lê primeiro é quem avisa. `avisarFalha` só
 * controla o aviso de “leitura parada”.
 */
export async function monitorarStatusDoMotorista(
  motoristaId: number,
  opcoes: {
    buscar?: typeof fetch;
    origem?: OrigemLeitura;
    avisarFalha?: boolean;
    /** Só para teste: a partir de quanto tempo de leitura a fila não pega carona. */
    caronaDaFilaAteMs?: number;
  } = {},
) {
  const inicio = Date.now();
  const origem = opcoes.origem ?? "periodica";
  const meus: MeuPonto[] = await comBanco(() =>
    db
      .select({ id: pontos.id, tipo: pontos.tipo, livro: pontos.livro, numero: pontos.numero })
      .from(pontos)
      .where(eq(pontos.motoristaId, motoristaId))
      .orderBy(pontos.ordem, pontos.id),
  );
  const codigos = meus.map(codigoNoPortal);
  // Quantas leituras SEGUIDAS já tinham falhado antes desta.
  const falhasAntes = await contarFalhasSeguidas(motoristaId);

  const lida = await lerEGuardarPortal(motoristaId, { buscar: opcoes.buscar, codigos, origem });
  if (!lida.rodou) return { rodou: false as const, motivo: lida.motivo };
  const { leitura } = lida;

  const situacoes: SituacaoLida[] = [];
  let avisos = 0;
  if (lida.temSituacao) {
    const consulta: ConsultaPortal = {
      resultado: "lido",
      telas: [{ caminho: CAMINHO_STATUS, titulo: leitura.titulo, secoes: leitura.secoes, totalLinhas: leitura.totalLinhas }],
      diagnostico: leitura.diagnostico,
    };
    const nome = await nomeDoMotorista(motoristaId).catch(() => null);

    // Situações guardadas ANTES desta leitura. Servem só para saber se vale
    // buscar as outras telas; quem decide o aviso é a troca atômica, abaixo.
    const guardadas = await situacoesDoMotorista(motoristaId).catch(() => []);

    // Hora do aviso: as demais telas, na mesma sessão (uma vez por leitura,
    // mesmo com dois pontos mudando juntos). Se não vierem, o aviso sai com o
    // que a tela de Status mostrou.
    let completa: ConsultaPortal | null | undefined;
    const consultaCompleta = async (): Promise<ConsultaPortal | null> => {
      if (completa !== undefined) return completa;
      completa = null;
      try {
        const { caminhos } = await lerModoSaida();
        const telas = await lerTelasNaSessaoGuardada(motoristaId, { buscar: opcoes.buscar, codigo: codigos[0] ?? null, codigos, caminhos });
        if (telas?.ok) {
          completa = {
            resultado: "lido",
            telas: telas.telas.map((t) => ({ caminho: t.caminho, titulo: t.titulo, secoes: t.secoes, totalLinhas: t.totalLinhas })),
            diagnostico: telas.diagnostico,
          };
        }
      } catch {
        completa = null;
      }
      return completa;
    };

    for (const ponto of meus) {
      const codigo = codigoNoPortal(ponto);
      const situacao = situacaoDoPontoNasTelas(consulta, codigo, { nomeMotorista: nome });
      if (situacao.tipo !== "status" || !situacao.evento.turno) {
        situacoes.push({
          codigo,
          turno: null,
          mudou: false,
          aviso: null,
          motivo: situacao.tipo === "falha" ? situacao.motivo : "A tela não mostrou a situação deste ponto.",
        });
        continue;
      }
      const evento = situacao.evento;
      const turno = evento.turno as string;
      // O texto do aviso vem da leitura completa quando ela confirma a MESMA
      // situação; senão, do cartão que a tela de Status mostrou. As telas a
      // mais são lidas ANTES de gravar a troca: se a função for interrompida
      // no meio da rede, nada foi gravado e a próxima leitura ainda avisa.
      let eventoDoAviso = evento;
      const antes = guardadas.find((s) => s.pontoId === ponto.id && s.codigo === codigo);
      if (antes && avisoDaTroca({ anterior: antes.turno, novo: turno })) {
        const cheia = await consultaCompleta();
        if (cheia) {
          const conferida = situacaoDoPontoNasTelas(cheia, codigo, { nomeMotorista: nome });
          if (conferida.tipo === "status" && conferida.evento.turno === turno) eventoDoAviso = conferida.evento;
        }
      }
      const troca = await registrarSituacaoLida({ pontoId: ponto.id, motoristaId, codigo, turno });
      const aviso = troca.trocou ? avisoDaTroca({ anterior: troca.anterior, novo: turno }) : null;
      if (aviso && troca.anterior) {
        await avisarTroca({ motoristaId, ponto, codigo, aviso, evento: eventoDoAviso, anterior: troca.anterior, instante: troca.mudouEm });
        avisos += 1;
      }
      situacoes.push({ codigo, turno, mudou: troca.trocou && Boolean(troca.anterior), aviso });
    }
  }

  // Saúde da leitura: quem depende só do portal precisa saber quando ele não
  // está sendo lido. O freio de logins não é uma leitura (nada foi pedido).
  let aviso: { enviado: boolean; motivo?: string } = { enviado: false };
  if (lida.pausado) {
    aviso = await avisarAcessoPausado(motoristaId, lida.id);
  } else if (!lida.temSituacao && !lida.freio) {
    const seguidas = falhasAntes + 1;
    if (opcoes.avisarFalha && seguidas === 3 && !leitura.loginRecusado) {
      aviso = await avisarLeituraParada(motoristaId, lida.id);
    }
    if (origem === "periodica" && seguidas >= 3) {
      await marcarProximaLeitura(motoristaId, Math.max(ESPERA_APOS_FALHAS_STATUS_MS, intervaloStatusMs())).catch(() => null);
    }
  }
  if (origem === "periodica" && lida.freio && leitura.tentarEmMs) {
    // Sem sessão e com o freio de logins: volta quando o login for permitido.
    await marcarProximaLeitura(motoristaId, Math.max(leitura.tentarEmMs, esperaEntreLeiturasMs())).catch(() => null);
  }

  // A fila geral pega carona: a conta abriu agora (com ou sem a situação do
  // ponto na tela), então a mesma sessão pode abrir a aba “Fila”. Vem depois
  // dos avisos do Status, que não esperam por ela.
  // Portal lento: a carona fica para a próxima leitura (nada é reservado, e
  // outra conta — ou o próximo ciclo — abre a aba).
  const gasto = Date.now() - inicio;
  const semTempo = gasto > (opcoes.caronaDaFilaAteMs ?? CARONA_DA_FILA_ATE_MS[origem]);
  const fila = !leitura.ok
    ? null
    : semTempo
      ? {
          lidos: [] as LivroDaFila[],
          diagnostico:
            fonteDaFila() === "portal"
              ? [`Fila: não foi lida nesta visita (o portal levou ${Math.round(gasto / 1000)} s para abrir a conta); fica para a próxima leitura.`]
              : [],
        }
      : await atualizarFilaDoPortal(motoristaId, { buscar: opcoes.buscar, forcar: origem === "manual" }).catch((e) => {
          console.error("[portal-monitor] leitura da fila falhou:", e instanceof Error ? e.message : e);
          return null;
        });

  return {
    rodou: true as const,
    /** Leu a situação de pelo menos um ponto do motorista. */
    ok: lida.temSituacao,
    /** O portal abriu com a conta do motorista (mesmo sem a situação na tela). */
    entrou: leitura.ok,
    loginRecusado: leitura.loginRecusado,
    captcha: leitura.captcha,
    linhas: leitura.totalLinhas,
    novas: [] as string[],
    diagnostico: [...leitura.diagnostico, ...(fila?.diagnostico ?? [])],
    /** Livros da aba “Fila” lidos nesta visita (vazio = não era a hora, ou não veio). */
    filaLida: fila?.lidos ?? [],
    aviso,
    pausado: lida.pausado,
    leituraId: lida.id,
    quando: (lida.criadoEm ?? new Date()).toISOString(),
    /** Esta leitura enviou um login (a sessão guardada não servia mais). */
    fezLogin: Boolean(leitura.fezLogin),
    /** Leitura adiada pelo freio de logins automáticos. */
    freio: lida.freio,
    situacoes,
    /** Avisos de troca de situação enviados nesta leitura. */
    avisos,
  };
}

/**
 * Uma rodada do monitor: lê o Status de todos os motoristas cuja leitura já
 * pode começar. Cada motorista é reservado no banco antes da leitura — duas
 * rodadas ao mesmo tempo (cron + app aberto) nunca olham a mesma conta no
 * mesmo minuto. Quem espera há mais tempo vem primeiro, e a rodada para de
 * começar leituras quando o prazo acaba (o resto fica para a próxima).
 *
 * `esperaMs`: quanto a próxima leitura do mesmo motorista espera. O cron usa o
 * intervalo menos uma folga; o app aberto usa o intervalo inteiro.
 */
export async function monitorarStatusDeTodos(
  opcoes: { buscar?: typeof fetch; prazoMs?: number; simultaneos?: number; esperaMs?: number; somente?: number } = {},
) {
  const inicio = Date.now();
  // `adiados`: contas sem sessão aberta em que o freio segurou o login
  // automático — voltam a ser lidas quando o login for permitido.
  // `fila`: livros da aba “Fila” lidos nesta rodada (a fila geral do app).
  const resumo = { motoristas: 0, lidos: 0, falhas: 0, adiados: 0, avisos: 0, logins: 0, fila: 0 };
  if (!temBancoConfigurado) return resumo;
  const prazo = opcoes.prazoMs ?? PRAZO_RODADA_MS;
  const espera = opcoes.esperaMs ?? esperaEntreLeiturasMs();

  const trabalhador = async () => {
    while (Date.now() - inicio < prazo) {
      const [motoristaId] = await reservarLeiturasDevidas(1, espera, opcoes.somente);
      if (motoristaId == null) return;
      resumo.motoristas += 1;
      try {
        const r = await monitorarStatusDoMotorista(motoristaId, { buscar: opcoes.buscar, origem: "periodica", avisarFalha: true });
        if (!r.rodou) continue;
        if (r.ok) resumo.lidos += 1;
        else if (r.freio) resumo.adiados += 1;
        else resumo.falhas += 1;
        if (r.fezLogin) resumo.logins += 1;
        resumo.avisos += r.avisos;
        resumo.fila += r.filaLida.length;
      } catch (e) {
        resumo.falhas += 1;
        console.error("[portal-monitor] leitura falhou:", e instanceof Error ? e.message : e);
      }
    }
  };
  const simultaneos = Math.max(1, Math.min(opcoes.simultaneos ?? SIMULTANEOS, 6));
  await Promise.all(Array.from({ length: simultaneos }, () => trabalhador()));

  // Ponto apagado (ou que mudou de dono) não deixa situação para trás.
  await comBanco(() =>
    db
      .delete(portalSituacoes)
      .where(
        sql`not exists (select 1 from pontos p where p.id = ${portalSituacoes.pontoId} and p.motorista_id = ${portalSituacoes.motoristaId})`,
      ),
  ).catch(() => null);

  return resumo;
}

/**
 * O que o cron chama a cada ciclo. Com a fonte `portal` (o padrão) é a rodada
 * do Status de 1 em 1 minuto; com `PORTAL_FONTE_SAIDA=quadro` vale a releitura
 * antiga (só de quem tem ponto fora do quadro, a cada 10 min).
 */
export async function monitorarTodos(limite = 3, prazoMs = PRAZO_RODADA_MS) {
  if (fontePortal() === "quadro") return monitorarPontosForaDoQuadro(limite, prazoMs);
  return monitorarStatusDeTodos({ prazoMs });
}

/**
 * Saldo de Ganhos: as viagens da semana (aba “Ticket”) de quem cadastrou a
 * porcentagem, de 5 em 5 minutos por motorista. Roda depois da rodada do
 * Status — que é quem avisa a saída e quem mantém a sessão aberta — e nunca
 * faz login. `desde`: quando a função (cron) começou.
 */
export async function monitorarTickets(desde: number, opcoes: { buscar?: typeof fetch; comecaAteMs?: number; limite?: number } = {}) {
  if (fontePortal() !== "portal") return { motoristas: 0, pontos: 0, falhas: 0 };
  return lerTicketsDevidos({ buscar: opcoes.buscar, comecarAte: desde + (opcoes.comecaAteMs ?? TICKET_COMECA_ATE_MS.cron), limite: opcoes.limite });
}

/**
 * “Ler agora” (motorista ou administrador) e a primeira leitura depois do
 * cadastro da senha. Com a fonte `portal`, usa a sessão guardada e avisa a
 * troca de situação como qualquer leitura.
 */
export async function monitorarMotorista(motoristaId: number, opcoes: { buscar?: typeof fetch; avisar?: boolean } = {}) {
  if (fontePortal() === "quadro") return lerPortalComLoginNovo(motoristaId, opcoes);
  return monitorarStatusDoMotorista(motoristaId, { buscar: opcoes.buscar, origem: "manual", avisarFalha: opcoes.avisar !== false });
}

/* --------------------------------------------------- painel do administrador */

/**
 * Para o cartão do /admin: quem decide a saída, de quanto em quanto tempo o
 * Status é olhado e a situação guardada de cada ponto (sem nenhum dado sensível).
 */
export async function resumoDoMonitor() {
  const fonte = fontePortal();
  const intervaloMin = Math.round(intervaloStatusMs() / 60_000);
  const fila = await resumoDaFila().catch(() => ({ fonte: fonteDaFila(), livros: [] }));
  if (!temBancoConfigurado || fonte !== "portal") return { fonte, intervaloMin, situacoes: [], fila };
  const linhas = await comBanco(() => db.select().from(portalSituacoes).orderBy(portalSituacoes.motoristaId, portalSituacoes.codigo)).catch(
    () => [],
  );
  return {
    fonte,
    intervaloMin,
    situacoes: linhas.map((s) => ({
      motoristaId: s.motoristaId,
      codigo: s.codigo,
      turno: s.turno,
      lidoEm: s.lidoEm.toISOString(),
      mudouEm: s.mudouEm.toISOString(),
      recente: situacaoFresca(s),
    })),
    fila,
  };
}

/* ------------------------------------------------- app aberto (sem esperar) */

let rodadaEmAndamento = false;
let ultimaRodadaEm = 0;

/**
 * Rodada curta disparada pelo app aberto, depois da resposta: mantém o Status
 * em dia mesmo se o despertador da hospedagem não rodar a cada minuto. Uma por
 * vez nesta instância e no máximo uma a cada 10 s.
 */
export async function monitorarStatusEmSegundoPlano() {
  if (fontePortal() !== "portal" || rodadaEmAndamento || Date.now() - ultimaRodadaEm < 10_000) return;
  rodadaEmAndamento = true;
  ultimaRodadaEm = Date.now();
  try {
    await monitorarStatusDeTodos({ prazoMs: 8_000, simultaneos: 2, esperaMs: intervaloStatusMs() });
    // Com tempo sobrando, o Saldo de Ganhos de quem está com a leitura vencida.
    await monitorarTickets(ultimaRodadaEm, { comecaAteMs: TICKET_COMECA_ATE_MS.appAberto, limite: 2 });
  } catch {
    /* O cron (ou a próxima chamada) retoma. */
  } finally {
    rodadaEmAndamento = false;
  }
}
