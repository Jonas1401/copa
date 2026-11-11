import { brl } from "@/lib/frete";

/**
 * O CARD “SALDO DE GANHOS” — viagens, valor bruto e comissão da semana.
 *
 * Os números vêm da aba “Ticket” do Portal do Motorista, lida pelo servidor
 * com a conta do próprio motorista (`portal-ticket.ts`). Aqui fica só o que a
 * tela mostra com eles: o card pequeno dos SERVIÇOS e os textos da página.
 * Só regras: nada de rede, nada de banco (roda no navegador).
 *
 * Um número velho nunca aparece como se fosse de agora: leitura antiga leva a
 * hora dela; ponto sem leitura na semana entra como “parcial”.
 *
 * Cada ponto do motorista tem a SUA porcentagem; o saldo é um só e soma a
 * comissão de todos. Enquanto algum ponto do app está sem porcentagem, a
 * comissão do saldo não aparece (“Falta %”): dinheiro pela metade, não.
 */

/** Uma viagem como fica guardada (o ponto é o da linha). */
export type ViagemGuardada = { quant: number; valor: number; servico: string; data: string; hora: string };

export type ContaDoTicket = {
  viagens: number;
  /** Soma de Quant × Valor. */
  bruto: number;
  /**
   * Bruto × porcentagem. No saldo: a soma da comissão de cada ponto, com a
   * porcentagem dele. null = falta a porcentagem (deste ponto; no saldo, de
   * algum ponto do app).
   */
  comissao: number | null;
  toneladas: number;
};

export type PontoDoResumo = {
  codigo: string;
  /** A porcentagem DESTE ponto (18.5 = 18,5 %); null = o motorista ainda não cadastrou. */
  porcentagem: number | null;
  /** Viagens da semana (null = este ponto ainda não foi lido nesta semana). */
  viagens: ViagemGuardada[] | null;
  conta: ContaDoTicket | null;
  /** Hora da última leitura BOA deste ponto nesta semana. */
  lidoEm: string | null;
  tentativaEm: string | null;
  /** Por que a última tentativa não serviu (null = serviu, ou nunca tentou). */
  erro: string | null;
};

export type ResumoDoTicket = {
  /** A leitura do Ticket existe neste servidor (banco configurado e `PORTAL_TICKET` ligado). */
  disponivel: boolean;
  /** O motorista ligou o Saldo de Ganhos (cadastrou a porcentagem de pelo menos um ponto). */
  ligado: boolean;
  /** A porcentagem, quando TODOS os pontos do app têm a mesma; null = cada ponto com a sua, ou falta a de algum. */
  porcentagem: number | null;
  /** Pontos do app ainda sem porcentagem: enquanto houver algum, a comissão do saldo não é somada. */
  semPorcentagem: string[];
  /** O motorista tem o CPF e a senha do portal cadastrados e a leitura não está pausada. */
  temAcesso: boolean;
  /** Pontos que o motorista cadastrou no app. */
  totalPontos: number;
  /** A semana que o portal mostrou como a de hoje na última leitura. */
  semana: { inicio: string; fim: string } | null;
  /** O saldo: a soma de todos os pontos lidos nesta semana. */
  conta: ContaDoTicket;
  /** Os pontos do app, cada um com a porcentagem e as viagens dele (antes de ligar: só os códigos). */
  pontos: PontoDoResumo[];
  /** Todos os pontos do motorista têm leitura boa nesta semana. */
  completo: boolean;
  /** A leitura boa mais ANTIGA entre os pontos lidos (a soma vale desde ela). */
  lidoEm: string | null;
  /** A leitura ainda vale como “agora”. */
  recente: boolean;
  tentativaEm: string | null;
  /** Por que a última tentativa não chegou às viagens (null = chegou). */
  erro: string | null;
  intervaloMin: number;
  /** Para a tela do próprio motorista (nunca traz peso nem valor). */
  diagnostico: string[];
};

/** “2026-11-09” → “09/11”. */
export const diaMesDe = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** “09/11 a 16/11”. */
export const rotuloDaSemana = (semana: { inicio: string; fim: string }) => `${diaMesDe(semana.inicio)} a ${diaMesDe(semana.fim)}`;

const FUSO = "America/Sao_Paulo";
const dataEm = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(ms));

/** O dia de hoje no horário de Brasília (aaaa-mm-dd). */
export const hojeEmBrasiliaISO = (agora: number) => dataEm(agora);

/**
 * A hora de uma leitura, no horário de Brasília: “11:42” se foi hoje,
 * “10/11 11:42” se foi em outro dia.
 */
export function horaDaLeitura(iso: string, agora: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
  const dia = dataEm(ms);
  return dia === dataEm(agora) ? hora : `${diaMesDe(dia)} ${hora}`;
}

/** “Nenhuma viagem”, “1 viagem”, “4 viagens”. */
export const textoDeViagens = (n: number) => (n === 0 ? "Nenhuma viagem" : `${n} ${n === 1 ? "viagem" : "viagens"}`);

/** “do A063”, “do A063 e do B702”, “do A063, do B702 e do M703”. */
export function listaDePontos(codigos: string[]): string {
  const partes = codigos.map((c) => `do ${c}`);
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/** O que o card mostra no lugar da comissão enquanto falta a porcentagem de algum ponto. */
export const FALTA_PORCENTAGEM = "Falta %";

/**
 * A tela de agora se apresenta com este cabeçalho em todo pedido a
 * `/api/tickets`. Quem não manda é uma tela aberta ANTES da porcentagem por
 * ponto (11/11/2026) e ainda não recarregada: ela não sabe mostrar “falta a
 * porcentagem de um ponto” e escreveria a comissão como R$ 0,00.
 */
export const CABECALHO_DA_TELA = "x-saldo-de-ganhos";
export const VERSAO_DA_TELA = "2";

/**
 * O resumo como a tela que pediu sabe mostrar. Para a tela antiga, enquanto
 * falta a porcentagem de algum ponto, a resposta é a de quem ainda não
 * cadastrou: o card pede a porcentagem e nenhum número de dinheiro aparece.
 */
export function resumoParaATela(resumo: ResumoDoTicket, versaoDaTela: string | null): ResumoDoTicket {
  if (Number(versaoDaTela) >= Number(VERSAO_DA_TELA)) return resumo;
  return resumo.ligado && resumo.semPorcentagem.length ? { ...resumo, ligado: false } : resumo;
}

export type CartaoDoTicket =
  | {
      modo: "numeros";
      viagens: string;
      bruto: string;
      /** O valor em dinheiro — ou “Falta %”, enquanto algum ponto do app não tem porcentagem. */
      comissao: string;
      /** A comissão não foi somada: falta a porcentagem de algum ponto. */
      faltaPorcentagem: boolean;
      /** Linha miúda: hora de uma leitura antiga, de qual ponto falta a porcentagem, ou quantos pontos entraram na soma. */
      nota: string | null;
      /** A leitura não é de agora (a nota traz a hora dela). */
      velho: boolean;
    }
  | { modo: "texto"; texto: string };

/** Quantos dos pontos do motorista têm leitura nesta semana. */
export const pontosLidos = (resumo: ResumoDoTicket) => resumo.pontos.filter((p) => p.viagens).length;

/**
 * O que o card dos SERVIÇOS mostra. Sem leitura nenhuma, um texto curto diz o
 * que falta; com leitura, os três números — e, quando ela é antiga ou parcial,
 * uma linha miúda dizendo isso.
 */
export function cartaoDoTicket(resumo: ResumoDoTicket | null, agora: number): CartaoDoTicket {
  if (!resumo || !resumo.disponivel) return { modo: "texto", texto: "Viagens da semana" };
  if (!resumo.ligado) return { modo: "texto", texto: "Cadastre sua porcentagem" };
  const lidos = pontosLidos(resumo);
  if (!lidos || !resumo.semana) {
    if (!resumo.temAcesso) return { modo: "texto", texto: "Falta o acesso ao portal" };
    if (!resumo.totalPontos) return { modo: "texto", texto: "Cadastre o seu ponto" };
    return { modo: "texto", texto: resumo.erro ? "Sem leitura do portal" : "Lendo o portal…" };
  }
  const velho = !resumo.recente;
  // Sem a porcentagem de algum ponto, a comissão do saldo não existe — nunca um valor pela metade.
  const comissao = resumo.conta.comissao;
  const sem = resumo.semPorcentagem;
  // A nota é uma só. Um número que não é de todos os pontos nunca aparece sem dizer isso: a soma
  // parcial vem antes da porcentagem que falta (essa já está escrita no lugar da comissão).
  const nota = velho
    ? `Lido ${resumo.lidoEm ? horaDaLeitura(resumo.lidoEm, agora) : "—"}`
    : !resumo.completo
      ? `${lidos} de ${resumo.totalPontos} pontos`
      : comissao === null
        ? sem.length === 1
          ? `Cadastre a % do ${sem[0]}`
          : `Cadastre a % de ${sem.length} pontos`
        : null;
  return {
    modo: "numeros",
    viagens: String(resumo.conta.viagens),
    bruto: brl(resumo.conta.bruto),
    comissao: comissao === null ? FALTA_PORCENTAGEM : brl(comissao),
    faltaPorcentagem: comissao === null,
    nota,
    velho,
  };
}

export type AvisoDaPagina = { tom: "info" | "atencao"; texto: string; acao?: "portal" | "inicio" };

/**
 * O aviso do topo da página (um só, o mais importante), ou null quando está
 * tudo em dia. Nunca traz peso nem valor.
 */
export function avisoDaPagina(resumo: ResumoDoTicket, agora: number): AvisoDaPagina | null {
  if (!resumo.disponivel) return { tom: "atencao", texto: "A leitura do Ticket está desligada neste servidor." };
  if (!resumo.temAcesso) {
    return {
      tom: "atencao",
      texto: "Para eu ler as suas viagens, cadastre o CPF e a senha do Portal do Motorista. É a mesma conta que já avisa a sua saída.",
      acao: "portal",
    };
  }
  if (!resumo.totalPontos) return { tom: "atencao", texto: "Cadastre o seu ponto na tela inicial: é dele que eu leio as viagens.", acao: "inicio" };
  if (!resumo.ligado) return null;
  const lidos = pontosLidos(resumo);
  if (!lidos || !resumo.semana) {
    return resumo.erro
      ? { tom: "atencao", texto: `Ainda não consegui ler as viagens no portal: ${resumo.erro}. Tento de novo sozinho.` }
      : { tom: "info", texto: `Lendo o portal… as viagens aparecem em até ${resumo.intervaloMin} minutos. Você também pode tocar em “Atualizar”.` };
  }
  if (!resumo.recente) {
    return {
      tom: "atencao",
      texto: `Estes números são da leitura de ${resumo.lidoEm ? horaDaLeitura(resumo.lidoEm, agora) : "—"}${resumo.erro ? ` — a última tentativa não veio: ${resumo.erro}` : ""}.`,
    };
  }
  const hoje = hojeEmBrasiliaISO(agora);
  if (hoje < resumo.semana.inicio || hoje > resumo.semana.fim) {
    return { tom: "atencao", texto: `Estes números são da semana ${rotuloDaSemana(resumo.semana)} (a última que eu li).` };
  }
  // O que falta para o saldo ser o de todos os pontos: a porcentagem de algum, a leitura de algum —
  // ou as duas coisas (o ponto recém-cadastrado costuma estar sem as duas): o aviso diz tudo de uma vez.
  const partes: string[] = [];
  if (resumo.semPorcentagem.length) {
    partes.push(`Falta a porcentagem ${listaDePontos(resumo.semPorcentagem)}. A comissão aparece quando todos os pontos tiverem a sua.`);
  }
  if (!resumo.completo) {
    const faltam = resumo.pontos.filter((p) => !p.viagens);
    const comErro = faltam.find((p) => p.erro);
    partes.push(
      `A soma é de ${lidos} de ${resumo.totalPontos} pontos. Falta ler: ${faltam.map((p) => p.codigo).join(", ")}${comErro ? ` (${comErro.codigo}: ${comErro.erro})` : ` — ${faltam.length === 1 ? "entra" : "entram"} nas próximas leituras`}.`,
    );
  }
  return partes.length ? { tom: resumo.semPorcentagem.length ? "atencao" : "info", texto: partes.join(" ") } : null;
}
