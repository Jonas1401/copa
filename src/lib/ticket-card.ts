import { brl } from "@/lib/frete";

/**
 * O CARD “CONSULTA DE PONTO” — viagens, valor bruto e comissão da semana.
 *
 * Os números vêm da aba “Ticket” do Portal do Motorista, lida pelo servidor
 * com a conta do próprio motorista (`portal-ticket.ts`). Aqui fica só o que a
 * tela mostra com eles: o card pequeno dos SERVIÇOS e os textos da página.
 * Só regras: nada de rede, nada de banco (roda no navegador).
 *
 * Um número velho nunca aparece como se fosse de agora: leitura antiga leva a
 * hora dela; ponto sem leitura na semana entra como “parcial”.
 */

/** Uma viagem como fica guardada (o ponto é o da linha). */
export type ViagemGuardada = { quant: number; valor: number; servico: string; data: string; hora: string };

export type ContaDoTicket = {
  viagens: number;
  /** Soma de Quant × Valor. */
  bruto: number;
  /** Bruto × porcentagem. */
  comissao: number;
  toneladas: number;
};

export type PontoDoResumo = {
  codigo: string;
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
  /** O motorista cadastrou a porcentagem. */
  ligado: boolean;
  porcentagem: number | null;
  /** O motorista tem o CPF e a senha do portal cadastrados e a leitura não está pausada. */
  temAcesso: boolean;
  /** Pontos que o motorista cadastrou no app. */
  totalPontos: number;
  /** A semana que o portal mostrou como a de hoje na última leitura. */
  semana: { inicio: string; fim: string } | null;
  /** A soma de todos os pontos lidos nesta semana. */
  conta: ContaDoTicket;
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

export type CartaoDoTicket =
  | {
      modo: "numeros";
      viagens: string;
      bruto: string;
      comissao: string;
      /** Linha miúda: hora de uma leitura antiga, ou quantos pontos entraram na soma. */
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
  const nota = velho
    ? `Lido ${resumo.lidoEm ? horaDaLeitura(resumo.lidoEm, agora) : "—"}`
    : !resumo.completo
      ? `${lidos} de ${resumo.totalPontos} pontos`
      : null;
  return {
    modo: "numeros",
    viagens: String(resumo.conta.viagens),
    bruto: brl(resumo.conta.bruto),
    comissao: brl(resumo.conta.comissao),
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
  if (!resumo.completo) {
    const faltam = resumo.pontos.filter((p) => !p.viagens);
    const comErro = faltam.find((p) => p.erro);
    return {
      tom: "info",
      texto: `A soma é de ${lidos} de ${resumo.totalPontos} pontos. Falta ler: ${faltam.map((p) => p.codigo).join(", ")}${comErro ? ` (${comErro.codigo}: ${comErro.erro})` : " — entram nas próximas leituras"}.`,
    };
  }
  return null;
}
