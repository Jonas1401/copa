/**
 * ATUALIZAR MAIS RÁPIDO — as regras da tela, em funções puras (sem navegador,
 * fáceis de testar):
 *
 *   - quando a tela volta a aparecer, ela pede os dados na hora;
 *   - uma resposta atrasada nunca passa por cima de uma mais nova;
 *   - depois de uma publicação, a tela que ficou aberta com o código antigo se
 *     recarrega sozinha — só num momento em que não atrapalha, e nunca em laço.
 */

/* ------------------------------------------------- voltar para a tela */

/** “Voltei” chega por mais de um evento ao mesmo tempo (aba visível, rede de volta…): um pedido só. */
export const PAUSA_ENTRE_VOLTAS_MS = 1_000;

/** A tela está à vista e o último pedido por “voltei” não foi agora mesmo. */
export function deveAtualizarAoVoltar(visibilidade: string, agoraMs: number, ultimaVoltaMs: number): boolean {
  return visibilidade === "visible" && agoraMs - ultimaVoltaMs >= PAUSA_ENTRE_VOLTAS_MS;
}

/* ------------------------------------------------- a ordem das respostas */

/**
 * Cada pedido de estado leva um número crescente. A resposta só entra na tela
 * se o pedido dela for mais novo que o último que já entrou: numa rede ruim (ou
 * quando o pedido de “voltei” cruza com o do ciclo de 5 s) a resposta mais
 * velha pode chegar por último — e mostraria um dado mais antigo que o da tela.
 */
export function respostaAindaVale(numeroDoPedido: number, ultimoQueEntrou: number): boolean {
  return numeroDoPedido > ultimoQueEntrou;
}

/* ------------------------------------------------- versão nova publicada */

/** Com a tela à vista, de quanto em quanto tempo ela pergunta qual é a versão publicada. */
export const INTERVALO_DO_VIGIA_MS = 5 * 60_000;
/** Ao voltar para o app, só pergunta de novo se a última pergunta tem pelo menos isto. */
export const PAUSA_DO_VIGIA_AO_VOLTAR_MS = 60_000;
/** A resposta da versão tem de chegar dentro disto: rede ruim não é hora de recarregar. */
export const PRAZO_DA_VERSAO_MS = 4_000;
/** Ao voltar, espera isto antes de decidir: dá tempo de a notificação tocada abrir a conversa. */
export const ASSENTAR_AO_VOLTAR_MS = 1_200;
/** Tela à vista e parada (ninguém tocou) por este tempo, com versão nova no ar: recarrega. */
export const PARADA_PARA_RECARREGAR_MS = 5 * 60_000;
/** Recarregou e a versão continua “nova”: tenta só mais uma vez, depois disto. */
export const ESPERA_PARA_RECARREGAR_DE_NOVO_MS = 10 * 60_000;
/** Quantas vezes, no máximo, a mesma aba recarrega atrás da mesma versão. */
export const MAXIMO_DE_RECARGAS_POR_VERSAO = 2;
/**
 * Tela ocupada: há uma janela aberta por cima (a conversa, o assistente, um
 * alerta — todas usam `aria-modal`) ou um trecho marcado com `data-sem-recarga`.
 */
export const SELETOR_DE_TELA_OCUPADA = '[aria-modal="true"], [data-sem-recarga]';
/** Onde fica anotada a última recarga (vale só para esta aba). */
export const CHAVE_DA_RECARGA = "copalinks:recarga-de-versao";

/**
 * A versão que o servidor informou é outra? Devolve a versão nova, ou `null`
 * quando é a mesma, quando a tela não sabe a própria versão (carimbo vazio: o
 * vigia fica desligado) ou quando a resposta não é um carimbo.
 */
export function versaoNova(minha: string, doServidor: unknown): string | null {
  if (!minha || typeof doServidor !== "string") return null;
  const outra = doServidor.trim();
  return outra && outra.length <= 80 && outra !== minha ? outra : null;
}

export type Recarga = { versao: string; em: number; vezes: number };

/** A anotação da última recarga (texto guardado na aba) — `null` se não há ou não dá para ler. */
export function lerRecarga(texto: string | null | undefined): Recarga | null {
  if (!texto) return null;
  try {
    const v = JSON.parse(texto) as Partial<Recarga> | null;
    if (!v || typeof v.versao !== "string" || !v.versao || typeof v.em !== "number" || !Number.isFinite(v.em)) return null;
    const vezes = typeof v.vezes === "number" && Number.isFinite(v.vezes) && v.vezes >= 1 ? Math.floor(v.vezes) : 1;
    return { versao: v.versao, em: v.em, vezes };
  } catch {
    return null;
  }
}

/** O que anotar na aba ANTES de recarregar atrás de `nova`. */
export function anotarRecarga(nova: string, ultima: Recarga | null, agora: number): Recarga {
  return { versao: nova, em: agora, vezes: ultima && ultima.versao === nova ? ultima.vezes + 1 : 1 };
}

/** Telas de trabalho do administrador: nunca recarregam sozinhas. */
const SEM_RECARGA = /^\/(admin|monitor)(\/|$)/;

export type MomentoDaRecarga =
  /** A pessoa acabou de voltar para o app e ainda não tocou em nada. */
  | "voltou"
  /** A tela está à vista; confere-se de tempos em tempos. */
  | "a-vista";

/**
 * Pode recarregar AGORA para pegar a versão nova?
 *
 *   - só com a tela à vista (nunca em segundo plano: lá pode haver um áudio
 *     tocando, a câmera aberta para uma foto…);
 *   - nunca se algo foi digitado ou escolhido na página (texto, foto, opção):
 *     recarregar apagaria;
 *   - nunca com um campo em foco (a pessoa foi buscar algo para colar), com
 *     áudio ou vídeo tocando, ou com a tela ocupada (uma janela aberta por
 *     cima: a conversa, um alerta — `SELETOR_DE_TELA_OCUPADA`);
 *   - nunca nas telas do administrador;
 *   - nunca em laço: a mesma aba recarrega no máximo duas vezes atrás da mesma
 *     versão, com 10 minutos entre uma e outra — e sem conseguir anotar a
 *     recarga, não recarrega;
 *   - “voltou”: só se a pessoa ainda não tocou na tela desde que voltou;
 *   - “a-vista”: só com a tela parada há 5 minutos.
 */
export function podeRecarregar(d: {
  nova: string | null;
  momento: MomentoDaRecarga;
  /** A tela está à vista neste instante. */
  aVista: boolean;
  /** Algo foi digitado ou escolhido nesta página desde que ela abriu (ou um seletor de arquivo foi aberto). */
  digitou: boolean;
  /** Há um campo de texto, lista ou área editável em foco. */
  campoEmFoco: boolean;
  /** Há áudio ou vídeo tocando. */
  midiaTocando: boolean;
  /** Há uma janela aberta por cima ou um trecho marcado (`SELETOR_DE_TELA_OCUPADA`). */
  ocupada: boolean;
  /** Tempo desde o último toque ou tecla (ms); `null` = ninguém tocou desde que a página abriu. */
  paradaHaMs: number | null;
  /** Já tocou na tela desde que voltou para o app. */
  tocouDesdeQueVoltou: boolean;
  caminho: string;
  ultima: Recarga | null;
  agora: number;
  /** A aba consegue anotar a recarga (sem isso não há como evitar o laço). */
  podeAnotar: boolean;
}): boolean {
  if (!d.nova || !d.aVista || !d.podeAnotar) return false;
  if (d.digitou || d.campoEmFoco || d.midiaTocando || d.ocupada) return false;
  if (SEM_RECARGA.test(d.caminho)) return false;
  if (d.ultima && d.ultima.versao === d.nova) {
    if (d.ultima.vezes >= MAXIMO_DE_RECARGAS_POR_VERSAO) return false;
    if (d.agora - d.ultima.em < ESPERA_PARA_RECARREGAR_DE_NOVO_MS) return false;
  }
  if (d.momento === "voltou") return !d.tocouDesdeQueVoltou;
  return d.paradaHaMs === null || d.paradaHaMs >= PARADA_PARA_RECARREGAR_MS;
}

/* ------------------------------------------------- a ligação com o navegador */

/*
 * As duas funções abaixo ligam as regras acima aos eventos do navegador. Tudo
 * de que precisam (documento, janela, relógio, rede) entra por parâmetro: no
 * app entram os objetos de verdade; nos testes, uns de mentira.
 */

type EventoDaTela = { target?: unknown; persisted?: boolean; type?: string };
type Ouvinte = (ev: EventoDaTela) => void;
type AlvoDeEventos = {
  addEventListener(tipo: string, ouvinte: Ouvinte, opcoes?: boolean | { capture?: boolean; passive?: boolean }): void;
  removeEventListener(tipo: string, ouvinte: Ouvinte, opcoes?: boolean | { capture?: boolean }): void;
};
export type DocumentoDaTela = AlvoDeEventos & {
  readonly visibilityState: string;
  readonly activeElement: unknown;
  querySelector(seletor: string): unknown;
  querySelectorAll(seletor: string): ArrayLike<unknown>;
};

/**
 * Chama `acao` quando a tela volta a aparecer: o app saiu do segundo plano, a
 * página voltou do cache de navegação ou a rede voltou. Devolve a função que
 * desliga.
 */
export function ligarAoVoltarParaATela(
  documento: Pick<DocumentoDaTela, "visibilityState" | "addEventListener" | "removeEventListener">,
  janela: AlvoDeEventos,
  acao: () => void,
  agora: () => number = Date.now,
): () => void {
  let ultima = Number.NEGATIVE_INFINITY;
  const disparar = () => {
    const t = agora();
    if (!deveAtualizarAoVoltar(documento.visibilityState, t, ultima)) return;
    ultima = t;
    acao();
  };
  const aoMostrar: Ouvinte = (ev) => {
    if (ev.persisted) disparar();
  };
  documento.addEventListener("visibilitychange", disparar);
  janela.addEventListener("pageshow", aoMostrar);
  janela.addEventListener("online", disparar);
  return () => {
    documento.removeEventListener("visibilitychange", disparar);
    janela.removeEventListener("pageshow", aoMostrar);
    janela.removeEventListener("online", disparar);
  };
}

/** Gestos da pessoa (a rolagem automática de um carrossel não conta como toque). */
const TOQUES = ["pointerdown", "keydown", "wheel", "touchstart", "click"] as const;

const ehCampo = (elemento: unknown): boolean => {
  const e = elemento as { tagName?: unknown; isContentEditable?: unknown } | null;
  return Boolean(e) && (["INPUT", "TEXTAREA", "SELECT"].includes(String(e?.tagName)) || e?.isContentEditable === true);
};
const ehSeletorDeArquivo = (elemento: unknown): boolean => {
  const e = elemento as { tagName?: unknown; type?: unknown } | null;
  return Boolean(e) && e?.tagName === "INPUT" && e?.type === "file";
};

/** Os temporizadores (no app: os do navegador; nos testes: um relógio de mentira). */
export type Temporizadores = {
  setTimeout(tarefa: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(tarefa: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
};
const TEMPORIZADORES_DO_NAVEGADOR: Temporizadores = {
  setTimeout: (tarefa, ms) => setTimeout(tarefa, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (tarefa, ms) => setInterval(tarefa, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export type AmbienteDoVigia = {
  /** O carimbo desta tela (vazio = o vigia não liga). */
  versao: string;
  documento: DocumentoDaTela;
  janela: AlvoDeEventos;
  /** Pede `/api/versao` (no app: `fetch`). */
  buscar: (endereco: string, opcoes: { cache: "no-store"; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  /** O armazenamento da aba (no app: `sessionStorage`); pode lançar erro quando o navegador o bloqueia. */
  armazenamento: () => { getItem(chave: string): string | null; setItem(chave: string, valor: string): void };
  caminho: () => string;
  recarregar: () => void;
  agora?: () => number;
  temporizadores?: Temporizadores;
};

/**
 * VIGIA DE VERSÃO. Pergunta ao servidor qual é a versão no ar — quando a
 * pessoa volta para o app e, com a tela à vista, a cada 5 minutos — e, quando
 * é outra, recarrega a página se `podeRecarregar` deixar. Só recarrega logo
 * depois de o servidor responder, e depressa: sem rede (ou com rede ruim) a
 * tela fica como está. Devolve a função que desliga.
 */
export function ligarVigiaDeVersao(a: AmbienteDoVigia): () => void {
  if (!a.versao) return () => {};
  const agora = a.agora ?? Date.now;
  const relogio = a.temporizadores ?? TEMPORIZADORES_DO_NAVEGADOR;
  let desligado = false;
  let perguntando = false;
  let ultimaPergunta = Number.NEGATIVE_INFINITY;
  let digitou = false;
  let ultimoToque: number | null = null;
  let tocouDesdeQueVoltou = false;
  let assentar: unknown = null;
  let perguntaNoAr: AbortController | null = null;

  const anotarDigitacao = () => {
    digitou = true;
  };
  const anotarToque: Ouvinte = (ev) => {
    ultimoToque = agora();
    tocouDesdeQueVoltou = true;
    // Abriu o seletor de arquivo (foto, câmera): a página sai de vista e volta com um arquivo escolhido.
    if (ev.type === "click" && ehSeletorDeArquivo(ev.target)) digitou = true;
  };

  /** A versão nova — só se o servidor respondeu AGORA, dentro do prazo; senão `null`. */
  const perguntar = async (): Promise<string | null> => {
    if (perguntando) return null;
    perguntando = true;
    ultimaPergunta = agora();
    const controle = new AbortController();
    perguntaNoAr = controle;
    const prazo = relogio.setTimeout(() => controle.abort(), PRAZO_DA_VERSAO_MS);
    try {
      const r = await a.buscar("/api/versao", { cache: "no-store", signal: controle.signal });
      if (!r.ok) return null;
      const corpo = (await r.json()) as { versao?: unknown } | null;
      // Resposta que chegou depois do prazo não vale: a rede está lenta demais para recarregar agora.
      return controle.signal.aborted ? null : versaoNova(a.versao, corpo?.versao);
    } catch {
      return null; // sem rede ou rede lenta: não é hora de recarregar
    } finally {
      relogio.clearTimeout(prazo);
      perguntaNoAr = null;
      perguntando = false;
    }
  };

  const recarregarSePuder = (nova: string | null, momento: MomentoDaRecarga) => {
    if (!nova || desligado) return;
    const t = agora();
    let anotado: string | null = null;
    let podeAnotar = true;
    try {
      anotado = a.armazenamento().getItem(CHAVE_DA_RECARGA);
    } catch {
      podeAnotar = false;
    }
    const ultima = lerRecarga(anotado);
    const pode = podeRecarregar({
      nova,
      momento,
      aVista: a.documento.visibilityState === "visible",
      digitou,
      campoEmFoco: ehCampo(a.documento.activeElement),
      midiaTocando: Array.from(a.documento.querySelectorAll("audio, video")).some((m) => (m as { paused?: unknown }).paused === false),
      ocupada: a.documento.querySelector(SELETOR_DE_TELA_OCUPADA) != null,
      paradaHaMs: ultimoToque === null ? null : t - ultimoToque,
      tocouDesdeQueVoltou,
      caminho: a.caminho(),
      ultima,
      agora: t,
      podeAnotar,
    });
    if (!pode) return;
    try {
      a.armazenamento().setItem(CHAVE_DA_RECARGA, JSON.stringify(anotarRecarga(nova, ultima, t)));
    } catch {
      return; // sem conseguir anotar não há como evitar o laço: não recarrega
    }
    desligado = true; // uma recarga só: a página nova liga o próprio vigia
    a.recarregar();
  };

  const cancelarAssentar = () => {
    if (assentar !== null) relogio.clearTimeout(assentar);
    assentar = null;
  };
  const aoVoltar = () => {
    tocouDesdeQueVoltou = false;
    cancelarAssentar();
    if (agora() - ultimaPergunta < PAUSA_DO_VIGIA_AO_VOLTAR_MS) return;
    const resposta = perguntar();
    assentar = relogio.setTimeout(() => {
      assentar = null;
      void resposta.then((nova) => recarregarSePuder(nova, "voltou"));
    }, ASSENTAR_AO_VOLTAR_MS);
  };
  const aoMudarVisibilidade = () => {
    // (Saiu de vista: nada a fazer aqui — `podeRecarregar` só deixa recarregar com a tela à vista.)
    if (a.documento.visibilityState === "visible") aoVoltar();
  };
  const aoMostrar: Ouvinte = (ev) => {
    if (ev.persisted) aoVoltar();
  };
  const ciclo = relogio.setInterval(() => {
    if (a.documento.visibilityState !== "visible") return;
    void perguntar().then((nova) => recarregarSePuder(nova, "a-vista"));
  }, INTERVALO_DO_VIGIA_MS);

  a.documento.addEventListener("input", anotarDigitacao, true);
  a.documento.addEventListener("change", anotarDigitacao, true);
  for (const tipo of TOQUES) a.documento.addEventListener(tipo, anotarToque, { capture: true, passive: true });
  a.documento.addEventListener("visibilitychange", aoMudarVisibilidade);
  a.janela.addEventListener("pageshow", aoMostrar);
  return () => {
    desligado = true;
    relogio.clearInterval(ciclo);
    cancelarAssentar();
    perguntaNoAr?.abort();
    a.documento.removeEventListener("input", anotarDigitacao, true);
    a.documento.removeEventListener("change", anotarDigitacao, true);
    for (const tipo of TOQUES) a.documento.removeEventListener(tipo, anotarToque, { capture: true });
    a.documento.removeEventListener("visibilitychange", aoMudarVisibilidade);
    a.janela.removeEventListener("pageshow", aoMostrar);
  };
}
