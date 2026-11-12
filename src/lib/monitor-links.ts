/**
 * VERIFICAÇÃO NA ABERTURA DO APP — registro dos links de monitoramento.
 *
 * Regra do proprietário:
 *   1. ao abrir o CopaLinks (ou iniciar uma sessão nova), TODOS os links de
 *      monitoramento ativos são verificados na hora — sem esperar o intervalo
 *      periódico, o temporizador ou uma atualização manual da tela;
 *   2. depois da primeira consulta cada monitoramento continua no intervalo
 *      que já estava configurado (este módulo NÃO altera intervalo nenhum);
 *   3. um link fora do ar não derruba os outros: cada link tem o seu resultado,
 *      com nova tentativa automática, e volta a “no ar” quando responde;
 *   4. nada de consulta duplicada nem sobreposta: uma verificação por link de
 *      cada vez, e uma rodada por janela (a segunda abertura reaproveita a
 *      rodada que acabou de acontecer);
 *   5. fica registrado o horário da última consulta e o resultado de cada link.
 *
 * O que este módulo verifica é a REACHABILITY de cada endereço monitorado
 * (HTTP, com `Range: bytes=0-0`), em paralelo e com prazo. As leituras de
 * verdade — fila, Status do portal, navios — continuam sendo feitas pelos
 * leitores existentes, com as regras deles (freio de login, reserva no banco,
 * intervalos). Na abertura, a rota `/api/estado?abertura=1` pede aos leitores
 * uma rodada imediata e, aqui, verifica os links.
 */
import { temBancoConfigurado, db } from "@/db";
import { configuracao } from "@/db/schema";
import { INTERVALO_VARREDURA, linksDoSite } from "./estado";
import { intervaloNaviosMs } from "./navios-monitor";
import { POLITICA_AUTOMACAO } from "./politica-automacao";
import { urlPortal } from "./portal-copadubo";
import { fonteDaFila, intervaloDaFilaMs } from "./portal-fila";
import { fontePortal, intervaloStatusMs } from "./portal-situacao";

/** Um link que o CopaLinks monitora. */
export type LinkMonitorado = {
  id: string;
  rotulo: string;
  url: string;
  /** Intervalo já configurado para a leitura deste link (nunca alterado aqui). */
  intervaloMs: number | null;
  /** Link em uso agora (os que não estão em uso não são consultados). */
  ativo: boolean;
  /** Quem lê este link: a varredura do app, o portal ou o monitor de navios. */
  leitor: "app" | "portal" | "navios";
};

/** Resultado da última verificação de um link. */
export type ResultadoLink = LinkMonitorado & {
  /** Início da última tentativa (deu certo ou não). */
  ultimaConsultaEm: string | null;
  /** Última resposta boa — o “no ar desde”. */
  ultimaConsultaOkEm: string | null;
  /** null = ainda não verificado nesta instância. */
  ok: boolean | null;
  httpStatus: number | null;
  latenciaMs: number | null;
  erro: string | null;
  /** Tentativas usadas na última rodada (1 = acertou de primeira). */
  tentativas: number;
  /** Quando a nova tentativa automática vai acontecer (null = nada marcado). */
  proximaTentativaEm: string | null;
};

export type ResumoVerificacao = {
  motivo: string;
  iniciadoEm: string;
  terminadoEm: string;
  /** Links verificados nesta rodada. */
  verificados: number;
  ok: number;
  falhas: number;
  /** Links que já estavam sendo verificados (não foram consultados de novo). */
  ignorados: number;
  /** Links fora do ar, pelo id. */
  foraDoAr: string[];
};

/** Prazo de cada verificação (abaixo do teto da função serverless). */
const PRAZO_PADRAO_MS = 4_000;
/** Uma nova tentativa por link antes de considerar fora do ar. */
const TENTATIVAS_PADRAO = 2;
const ESPERA_ENTRE_TENTATIVAS_MS = 500;
/** Duas aberturas seguidas do app não repetem a rodada dentro desta janela. */
export const JANELA_DA_ABERTURA_MS = 10_000;

/**
 * Os links monitorados hoje. Lidos das MESMAS fontes que os leitores usam
 * (`linksDoSite`, `urlPortal`, política de navios) — nenhum endereço novo e
 * nenhum intervalo inventado.
 */
export function linksMonitorados(): LinkMonitorado[] {
  const site = linksDoSite();
  const pelaFilaDoApp = fonteDaFila() === "quadro";
  const lista: LinkMonitorado[] = [
    {
      id: "intranet-geral",
      rotulo: "Quadro geral",
      url: site.geral,
      intervaloMs: INTERVALO_VARREDURA,
      ativo: pelaFilaDoApp,
      leitor: "app",
    },
    ...(["A", "B", "M"] as const).map((livro) => ({
      id: `intranet-${livro}`,
      rotulo: `Livro ${livro}`,
      url: site.livros[livro],
      intervaloMs: INTERVALO_VARREDURA,
      ativo: pelaFilaDoApp,
      leitor: "app" as const,
    })),
    {
      id: "navios-atracados",
      rotulo: "Navios atracados",
      url: POLITICA_AUTOMACAO.fonteAtracados,
      intervaloMs: intervaloNaviosMs(),
      ativo: true,
      leitor: "navios",
    },
    {
      id: "navios-manobras",
      rotulo: "Manobras previstas",
      url: POLITICA_AUTOMACAO.fonteManobras,
      intervaloMs: intervaloNaviosMs(),
      ativo: true,
      leitor: "navios",
    },
  ];
  if (fontePortal() === "portal") {
    lista.push({
      id: "portal-status",
      rotulo: "Portal do Motorista",
      url: urlPortal(),
      intervaloMs: intervaloStatusMs(),
      ativo: true,
      leitor: "portal",
    });
    if (fonteDaFila() === "portal") {
      lista.push({
        id: "portal-fila",
        rotulo: "Portal · aba Fila",
        url: urlPortal(),
        intervaloMs: intervaloDaFilaMs(),
        ativo: true,
        leitor: "portal",
      });
    }
  }
  return lista;
}

type OpcoesMonitor = {
  links: () => LinkMonitorado[];
  buscar?: typeof fetch;
  agora?: () => number;
  prazoMs?: number;
  tentativas?: number;
  esperaEntreTentativasMs?: number;
  janelaDaAberturaMs?: number;
  /** Grava o retrato no banco (desligado nos testes). */
  persistir?: boolean;
};

const textoDoErro = (erro: unknown) =>
  erro instanceof Error ? erro.message : typeof erro === "string" ? erro : "falha de rede";

/**
 * Registro independente por instância. Criado por fábrica para poder ser
 * testado com um `fetch` de mentira e sem banco.
 */
export function criarMonitorDeLinks(opcoes: OpcoesMonitor) {
  const buscar = opcoes.buscar ?? fetch;
  const agora = opcoes.agora ?? Date.now;
  const prazoMs = opcoes.prazoMs ?? PRAZO_PADRAO_MS;
  const tentativasMax = Math.max(1, opcoes.tentativas ?? TENTATIVAS_PADRAO);
  const esperaMs = opcoes.esperaEntreTentativasMs ?? ESPERA_ENTRE_TENTATIVAS_MS;
  const janela = opcoes.janelaDaAberturaMs ?? JANELA_DA_ABERTURA_MS;
  const persistir = opcoes.persistir ?? false;

  const resultados = new Map<string, ResultadoLink>();
  const emAndamento = new Map<string, Promise<ResultadoLink>>();
  let rodada: Promise<ResumoVerificacao> | null = null;
  let ultimaAberturaEm = 0;
  let retratoGravadoEm = 0;

  function retrato(link: LinkMonitorado): ResultadoLink {
    return (
      resultados.get(link.id) ?? {
        ...link,
        ultimaConsultaEm: null,
        ultimaConsultaOkEm: null,
        ok: null,
        httpStatus: null,
        latenciaMs: null,
        erro: null,
        tentativas: 0,
        proximaTentativaEm: null,
      }
    );
  }

  async function esperar(ms: number) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Uma verificação de um link, com nova tentativa automática. */
  async function verificar(link: LinkMonitorado): Promise<ResultadoLink> {
    let ultimoErro: string | null = null;
    let ultimoStatus: number | null = null;
    let latencia: number | null = null;
    let usadas = 0;
    for (let tentativa = 1; tentativa <= tentativasMax; tentativa += 1) {
      usadas = tentativa;
      const inicio = agora();
      try {
        // `Range` de 1 byte: confere o link sem baixar a página inteira.
        const resposta = await buscar(link.url, {
          method: "GET",
          headers: { range: "bytes=0-0", "cache-control": "no-cache" },
          redirect: "follow",
          cache: "no-store",
          signal: AbortSignal.timeout(prazoMs),
        });
        latencia = Math.max(0, agora() - inicio);
        ultimoStatus = resposta.status;
        if (resposta.ok || resposta.status === 206) {
          ultimoErro = null;
          break;
        }
        ultimoErro = `HTTP ${resposta.status}`;
      } catch (erro) {
        latencia = Math.max(0, agora() - inicio);
        ultimoStatus = null;
        ultimoErro = textoDoErro(erro);
      }
      if (tentativa < tentativasMax) await esperar(esperaMs * tentativa);
    }

    const quando = new Date(agora()).toISOString();
    const anterior = resultados.get(link.id);
    const deuCerto = ultimoErro === null;
    const resultado: ResultadoLink = {
      ...link,
      ultimaConsultaEm: quando,
      ultimaConsultaOkEm: deuCerto ? quando : (anterior?.ultimaConsultaOkEm ?? null),
      ok: deuCerto,
      httpStatus: ultimoStatus,
      latenciaMs: latencia,
      erro: ultimoErro,
      tentativas: usadas,
      // Falhou: a próxima tentativa é a do leitor no intervalo dele; nada de
      // laço aqui (a abertura seguinte ou o ciclo normal tentam de novo).
      proximaTentativaEm: deuCerto ? null : anterior?.proximaTentativaEm ?? null,
    };
    resultados.set(link.id, resultado);
    return resultado;
  }

  /** Verifica um link sem sobrepor: se já há uma consulta dele em curso, usa a mesma. */
  function verificarUmaVez(link: LinkMonitorado): { promessa: Promise<ResultadoLink>; nova: boolean } {
    const emCurso = emAndamento.get(link.id);
    if (emCurso) return { promessa: emCurso, nova: false };
    const promessa = verificar(link).finally(() => emAndamento.delete(link.id));
    emAndamento.set(link.id, promessa);
    return { promessa, nova: true };
  }

  async function gravarRetrato() {
    if (!persistir || !temBancoConfigurado) return;
    if (agora() - retratoGravadoEm < 30_000) return;
    retratoGravadoEm = agora();
    try {
      const valor = JSON.stringify({
        em: new Date(agora()).toISOString(),
        links: [...resultados.values()].map(({ id, ok, httpStatus, ultimaConsultaEm, erro }) => ({
          id,
          ok,
          httpStatus,
          ultimaConsultaEm,
          erro,
        })),
      });
      await db
        .insert(configuracao)
        .values({ chave: "monitor_links_v1", valor })
        .onConflictDoUpdate({ target: configuracao.chave, set: { valor } });
    } catch {
      /* diagnóstico não pode atrapalhar a leitura */
    }
  }

  /**
   * Verifica TODOS os links ativos agora. Cada link é independente: a falha de
   * um não interrompe os outros (e `allSettled` garante que nenhum é cancelado).
   */
  function verificarTodos(motivo = "manual"): Promise<ResumoVerificacao> {
    if (rodada) return rodada;
    rodada = (async () => {
      const inicio = agora();
      const ativos = opcoes.links().filter((link) => link.ativo);
      const pedidos = ativos.map((link) => ({ link, ...verificarUmaVez(link) }));
      await Promise.allSettled(pedidos.map((p) => p.promessa));
      const avaliados = pedidos.map((p) => retrato(p.link));
      const foraDoAr = avaliados.filter((r) => r.ok === false).map((r) => r.id);
      const resumo: ResumoVerificacao = {
        motivo,
        iniciadoEm: new Date(inicio).toISOString(),
        terminadoEm: new Date(agora()).toISOString(),
        verificados: avaliados.length,
        ok: avaliados.filter((r) => r.ok === true).length,
        falhas: foraDoAr.length,
        ignorados: pedidos.filter((p) => !p.nova).length,
        foraDoAr,
      };
      await gravarRetrato().catch(() => null);
      return resumo;
    })().finally(() => {
      rodada = null;
    });
    return rodada;
  }

  /**
   * Abertura do app / sessão nova: verifica tudo agora, uma vez por janela.
   * Duas telas abertas juntas não geram duas rodadas.
   */
  async function abrirSessao(motivo = "abertura"): Promise<ResumoVerificacao | null> {
    if (rodada) return rodada;
    if (agora() - ultimaAberturaEm < janela) return null;
    ultimaAberturaEm = agora();
    return verificarTodos(motivo);
  }

  return {
    abrirSessao,
    verificarTodos,
    resultados: () => opcoes.links().map(retrato),
    emAndamento: () => emAndamento.size,
    ultimaAberturaEm: () => ultimaAberturaEm,
  };
}

/** Registro usado pelo servidor do CopaLinks. */
export const monitorDeLinks = criarMonitorDeLinks({
  links: linksMonitorados,
  persistir: true,
});

/** Chamado pela rota da abertura: verifica os links ativos agora. */
export function verificarLinksNaAbertura(motivo = "abertura") {
  return monitorDeLinks.abrirSessao(motivo);
}

/** Retrato para a API (diagnóstico; a tela não muda). */
export function linksParaApi(): ResultadoLink[] {
  return monitorDeLinks.resultados();
}
