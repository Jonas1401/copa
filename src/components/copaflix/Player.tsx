"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { FonteMidia } from "@/lib/copaflix/tipos";
import { deveRetomar } from "@/lib/copaflix/retomada";
import { chaveDaFonte, montarListaDeFontes, proximaFonte, rotuloDaFonte } from "@/lib/copaflix/fontes-midia";

/**
 * Player do CopaFlix.
 *
 * - HLS (.m3u8) com hls.js quando o navegador não reproduz nativo (Android,
 *   Chrome, Edge, Firefox) e com o suporte nativo do Safari/iOS.
 * - MP4/WebM direto no elemento <video>.
 * - Itens do Jellyfin passam pelo proxy do CopaLinks (chave fica no servidor).
 * - Play/pause, barra de progresso, volume, tela cheia, qualidade (quando o
 *   fluxo oferece), retomar de onde parou, próximo episódio e mensagens de
 *   erro que explicam o que fazer (CORS, bloqueio geográfico, fonte fora do ar).
 *
 * Nada de DRM: se a fonte exigir DRM, o navegador não abre e o player avisa —
 * o CopaFlix não contorna proteção de conteúdo.
 */

type HlsNivel = { index: number; height?: number; name?: string };
type HlsInstancia = {
  attachMedia(media: HTMLMediaElement): void;
  loadSource(url: string): void;
  destroy(): void;
  currentLevel: number;
  levels: HlsNivel[];
  on(evento: string, cb: (...args: unknown[]) => void): void;
  startLoad(): void;
  recoverMediaError(): void;
};

const VELOCIDADE_MAXIMA_SALVAR_MS = 5000;

function tempo(segundos: number) {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const total = Math.floor(segundos);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ehHls(fonte: FonteMidia) {
  if (fonte.tipo === "hls") return true;
  if (fonte.tipo !== "arquivo") return false;
  const url = (fonte.url ?? "").split("?")[0].toLowerCase();
  return url.endsWith(".m3u8");
}

/** Safari/iOS reproduzem HLS nativamente; no restante usamos hls.js. */
function reproduzHlsNativo(video: HTMLVideoElement) {
  if (typeof navigator === "undefined") return false;
  const safari = /^((?!chrome|chromium|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
  return safari && video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

/** Traduz o erro do <video> em algo que o usuário entende. */
function explicarErro(codigo?: number) {
  switch (codigo) {
    case 1:
      return "A reprodução foi interrompida.";
    case 2:
      return "A conexão com a fonte caiu. Verifique a internet e tente de novo.";
    case 3:
      return "O vídeo não pôde ser decodificado neste aparelho (codec não suportado).";
    case 4:
      return "O formato não é suportado por este navegador ou a fonte recusou o acesso.";
    default:
      return "Não foi possível iniciar a reprodução.";
  }
}

export default function Player({
  titulo,
  subtitulo,
  fonte,
  alternativas = [],
  inicio = 0,
  capa,
  aoProgredir,
  aoTerminar,
  aoProximo,
  rotuloProximo,
  autoIniciar = true,
}: {
  titulo: string;
  subtitulo?: string;
  fonte: FonteMidia | null;
  /** Espelhos: tentados em ordem se a fonte principal falhar. */
  alternativas?: FonteMidia[];
  /** Segundos para retomar. */
  inicio?: number;
  capa?: string;
  aoProgredir?: (posicao: number, duracao: number) => void;
  aoTerminar?: () => void;
  aoProximo?: () => void;
  rotuloProximo?: string;
  autoIniciar?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsInstancia | null>(null);
  const ultimoSalvar = useRef(0);
  const retomou = useRef(false);
  const progressoRef = useRef({ posicao: 0, duracao: 0 });
  const temporizadorOcioso = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Callbacks guardados em ref: a ficha passa funções novas a cada render e o
  // player NÃO pode recarregar o vídeo por causa disso.
  const aoProgredirRef = useRef(aoProgredir);
  const aoTerminarRef = useRef(aoTerminar);
  aoProgredirRef.current = aoProgredir;
  aoTerminarRef.current = aoTerminar;

  /**
   * Lista de fontes: a principal e os espelhos, sem repetir endereço. O player
   * troca sozinho quando uma fonte falha (fora do ar, CORS, bloqueio regional)
   * e só mostra erro quando todas falharam.
   */
  const chavePrincipal = chaveDaFonte(fonte);
  const fontes = montarListaDeFontes(fonte, alternativas);

  const [indiceFonte, setIndiceFonte] = useState(0);
  const [avisoFonte, setAvisoFonte] = useState<string | null>(null);
  const fonteAtiva = fontes[Math.min(indiceFonte, Math.max(fontes.length - 1, 0))] ?? null;

  // Só recarrega quando a MÍDIA muda de verdade (tipo + endereço + item).
  const fonteRef = useRef<FonteMidia | null>(fonteAtiva);
  fonteRef.current = fonteAtiva;
  const fonteChave = chaveDaFonte(fonteAtiva);
  const fontesRef = useRef(fontes);
  fontesRef.current = fontes;
  const indiceRef = useRef(indiceFonte);
  indiceRef.current = indiceFonte;

  // Trocou o título/episódio: volta para a primeira fonte.
  useEffect(() => {
    setIndiceFonte(0);
    setAvisoFonte(null);
  }, [chavePrincipal]);
  const inicioInicial = useRef(inicio).current;

  const [tocando, setTocando] = useState(false);
  const [posicao, setPosicao] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [carregado, setCarregado] = useState(0);
  const [volume, setVolume] = useState(1);
  const [mudo, setMudo] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [niveis, setNiveis] = useState<HlsNivel[]>([]);
  const [nivelAtual, setNivelAtual] = useState(-1);
  const [ocioso, setOcioso] = useState(false);
  const [precisaToque, setPrecisaToque] = useState(false);
  const [retomando, setRetomando] = useState(inicio > 5);
  const [aoVivo, setAoVivo] = useState(false);

  /** Passa para o próximo espelho; devolve false quando acabaram. */
  const tentarProxima = useCallback(() => {
    const passo = proximaFonte(fontesRef.current, indiceRef.current);
    if (!passo) return false;
    setAvisoFonte(
      `A fonte ${rotuloDaFonte(passo.de)} não respondeu — tentando ${rotuloDaFonte(passo.para, "outra fonte")}…`,
    );
    setIndiceFonte(passo.indice);
    return true;
  }, []);

  const salvar = useCallback((forcar = false) => {
    const salvarCb = aoProgredirRef.current;
    if (!salvarCb) return;
    const { posicao: p, duracao: d } = progressoRef.current;
    const agora = Date.now();
    if (!forcar && agora - ultimoSalvar.current < VELOCIDADE_MAXIMA_SALVAR_MS) return;
    if (!d || !Number.isFinite(d) || p <= 0) return;
    ultimoSalvar.current = agora;
    salvarCb(p, d);
  }, []);

  /* ------------------------------------------------------- carregar a fonte */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const fonteAtual = fonteRef.current;
    retomou.current = false;
    setErro(null);
    setNiveis([]);
    setNivelAtual(-1);
    setPosicao(0);
    setDuracao(0);
    setPreparando(Boolean(fonteAtual));
    setTocando(false);
    setPrecisaToque(false);
    setRetomando(inicioInicial > 5);

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (!fonteAtual) {
      setPreparando(false);
      setErro("Nenhuma fonte de vídeo autorizada para este título.");
      return;
    }
    if (fonteAtual.tipo === "externo") {
      setPreparando(false);
      return;
    }

    video.removeAttribute("src");
    video.load();
    if (fonteAtual.tipo === "jellyfin") {
      const url = `/api/copaflix/jellyfin/stream/${encodeURIComponent(fonteAtual.itemId ?? "")}`;
      video.src = url;
      video.load();
      return;
    }
    const url = fonteAtual.url;
    if (!url) {
      setPreparando(false);
      setErro("Fonte sem endereço de reprodução.");
      return;
    }

    let cancelado = false;

    if (ehHls(fonteAtual)) {
      if (reproduzHlsNativo(video)) {
        video.src = url;
        video.load();
      } else {
        void import("hls.js")
          .then((modulo) => {
            if (cancelado) return;
            const Hls = modulo.default;
            if (!Hls.isSupported()) {
              setPreparando(false);
              setErro(
                "Este navegador não consegue reproduzir HLS. Tente no Chrome, Edge, Safari ou no app instalado.",
              );
              return;
            }
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              maxBufferLength: 20,
              backBufferLength: 30,
            }) as unknown as HlsInstancia;
            hlsRef.current = hls;
            hls.on("hlsError", (_evento, dados) => {
              const info = dados as { fatal?: boolean; type?: string; details?: string } | undefined;
              if (!info?.fatal) return;
              if (info.type === "networkError") {
                try {
                  hls.startLoad();
                  return;
                } catch {
                  /* cai para a mensagem abaixo */
                }
              } else if (info.type === "mediaError") {
                try {
                  hls.recoverMediaError();
                  return;
                } catch {
                  /* cai para a mensagem abaixo */
                }
              }
              setPreparando(false);
              if (tentarProxima()) return;
              setErro(
                info.details?.includes("manifestLoadError")
                  ? "A fonte não liberou o acesso a partir deste site (CORS) ou saiu do ar."
                  : "A transmissão falhou. Pode ser bloqueio geográfico ou fonte indisponível.",
              );
            });
            hls.on("hlsManifestParsed", () => {
              const lista = (hls.levels ?? []).map((nivel, indice) => ({
                index: indice,
                height: nivel.height,
                name: nivel.name,
              }));
              setNiveis(lista);
            });
            hls.attachMedia(video);
            hls.loadSource(url);
          })
          .catch(() => {
            if (!cancelado) {
              setPreparando(false);
              setErro("Não foi possível carregar o suporte a HLS neste aparelho.");
            }
          });
      }
    } else {
      video.src = url;
      video.load();
    }

    return () => {
      cancelado = true;
      salvar(true);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [fonteChave, tentativa, inicioInicial, salvar, tentarProxima]);

  /* --------------------------------------------------- eventos do elemento */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const aoCarregarMetadados = () => {
      setPreparando(false);
      setAvisoFonte(null);
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      setDuracao(d);
      setAoVivo(video.duration === Infinity);
      progressoRef.current.duracao = d;
      if (!retomou.current && deveRetomar(inicioInicial, d)) {
        retomou.current = true;
        try {
          video.currentTime = inicioInicial;
          setPosicao(inicioInicial);
        } catch {
          /* alguns fluxos ao vivo não permitem */
        }
      }
      if (autoIniciar) {
        void video.play().catch(() => setPrecisaToque(true));
      }
      // Se o "retomando" foi aplicado, some com o aviso depois de alguns segundos.
      if (inicioInicial > 5) setTimeout(() => setRetomando(false), 4500);
    };
    const aoTocar = () => {
      setTocando(true);
      setPrecisaToque(false);
    };
    const aoPausar = () => {
      setTocando(false);
      salvar(true);
    };
    const aoMudarTempo = () => {
      const p = video.currentTime;
      setPosicao(p);
      progressoRef.current.posicao = p;
      if (video.buffered.length) {
        try {
          setCarregado(video.buffered.end(video.buffered.length - 1));
        } catch {
          /* ignora */
        }
      }
      salvar();
    };
    const aoDuracao = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      setDuracao(d);
      setAoVivo(video.duration === Infinity);
      progressoRef.current.duracao = d;
    };
    const aoEsperar = () => setPreparando(true);
    const aoReproduzir = () => setPreparando(false);
    const aoErro = () => {
      setPreparando(false);
      if (tentarProxima()) return;
      setErro(explicarErro(video.error?.code));
    };
    const aoTerminarVideo = () => {
      setTocando(false);
      salvar(true);
      aoTerminarRef.current?.();
    };

    video.addEventListener("loadedmetadata", aoCarregarMetadados);
    video.addEventListener("play", aoTocar);
    video.addEventListener("pause", aoPausar);
    video.addEventListener("timeupdate", aoMudarTempo);
    video.addEventListener("durationchange", aoDuracao);
    video.addEventListener("waiting", aoEsperar);
    video.addEventListener("playing", aoReproduzir);
    video.addEventListener("error", aoErro);
    video.addEventListener("ended", aoTerminarVideo);

    return () => {
      video.removeEventListener("loadedmetadata", aoCarregarMetadados);
      video.removeEventListener("play", aoTocar);
      video.removeEventListener("pause", aoPausar);
      video.removeEventListener("timeupdate", aoMudarTempo);
      video.removeEventListener("durationchange", aoDuracao);
      video.removeEventListener("waiting", aoEsperar);
      video.removeEventListener("playing", aoReproduzir);
      video.removeEventListener("error", aoErro);
      video.removeEventListener("ended", aoTerminarVideo);
    };
  }, [autoIniciar, inicioInicial, salvar, tentativa, tentarProxima]);

  /* --------------------------------------------------------- tela cheia */
  useEffect(() => {
    const aoMudar = () =>
      setTelaCheia(Boolean(document.fullscreenElement && caixaRef.current?.contains(document.fullscreenElement)));
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  /* --------------------------------------------- esconder controles ociosos */
  const acordar = useCallback(() => {
    setOcioso(false);
    if (temporizadorOcioso.current) clearTimeout(temporizadorOcioso.current);
    temporizadorOcioso.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setOcioso(true);
    }, 3200);
  }, []);

  useEffect(() => {
    if (!tocando) {
      setOcioso(false);
      if (temporizadorOcioso.current) clearTimeout(temporizadorOcioso.current);
      return;
    }
    acordar();
    return () => {
      if (temporizadorOcioso.current) clearTimeout(temporizadorOcioso.current);
    };
  }, [tocando, acordar]);

  /* ------------------------------------------------------------- ações */
  function alternarPlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {
        setPrecisaToque(true);
        setErro("O navegador bloqueou a reprodução automática. Toque em play.");
      });
    } else {
      video.pause();
    }
    acordar();
  }

  function procurar(fracao: number) {
    const video = videoRef.current;
    if (!video || !duracao) return;
    const alvo = Math.min(Math.max(fracao, 0), 1) * duracao;
    video.currentTime = alvo;
    setPosicao(alvo);
    progressoRef.current.posicao = alvo;
    acordar();
  }

  function mudarVolume(valor: number) {
    const video = videoRef.current;
    if (!video) return;
    const v = Math.min(Math.max(valor, 0), 1);
    video.volume = v;
    video.muted = v === 0;
    setVolume(v);
    setMudo(v === 0);
  }

  function alternarMudo() {
    const video = videoRef.current;
    if (!video) return;
    const m = !video.muted;
    video.muted = m;
    setMudo(m);
    if (!m && volume === 0) mudarVolume(1);
  }

  async function alternarTelaCheia() {
    const caixa = caixaRef.current;
    if (!caixa) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await caixa.requestFullscreen();
    } catch {
      setErro("Este navegador não permitiu a tela cheia. Use o botão do próprio aparelho.");
    }
  }

  function mudarQualidade(valor: string) {
    const hls = hlsRef.current;
    if (!hls) return;
    const nivel = Number(valor);
    hls.currentLevel = Number.isFinite(nivel) ? nivel : -1;
    setNivelAtual(Number.isFinite(nivel) ? nivel : -1);
  }

  const percentual = duracao ? Math.min(100, (posicao / duracao) * 100) : 0;
  const percentualCarregado = duracao ? Math.min(100, (carregado / duracao) * 100) : 0;

  return (
    <div
      ref={caixaRef}
      className="cf-player"
      data-ocioso={ocioso ? "true" : "false"}
      onPointerMove={acordar}
      onPointerDown={acordar}
      tabIndex={0}
      aria-label={`Player de ${titulo}`}
      onKeyDown={(evento) => {
        const video = videoRef.current;
        if (!video) return;
        if (evento.key === " " || evento.key === "k") {
          evento.preventDefault();
          alternarPlay();
        } else if (evento.key === "ArrowRight") {
          evento.preventDefault();
          video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
        } else if (evento.key === "ArrowLeft") {
          evento.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
        } else if (evento.key === "f") {
          evento.preventDefault();
          void alternarTelaCheia();
        } else if (evento.key === "m") {
          evento.preventDefault();
          alternarMudo();
        }
      }}
    >
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        poster={capa}
        className="w-full"
        onClick={alternarPlay}
        aria-label={subtitulo ? `${titulo} — ${subtitulo}` : titulo}
      />

      {preparando && !erro && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#000D16]/35">
          <span className="flex items-center gap-2 rounded-full border border-borda bg-cartao/90 px-4 py-2 font-display text-[12.5px] font-bold text-gelo">
            <Loader2 size={15} className="animate-spin text-ciano" aria-hidden />
            Preparando a transmissão…
          </span>
        </div>
      )}

      {precisaToque && !erro && (
        <button
          type="button"
          onClick={alternarPlay}
          className="absolute inset-0 grid place-items-center bg-black/35"
          aria-label="Reproduzir"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-ouro text-fundo shadow-[0_18px_40px_-18px_rgba(255,184,46,0.9)]">
            <Play size={26} strokeWidth={2.6} className="ml-0.5 fill-current" />
          </span>
        </button>
      )}

      {erro && (
        <div className="cf-player-erro" role="alert">
          <div className="max-w-[420px]">
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full border border-ouro/40 bg-ouro/10 text-ouro">
              <AlertTriangle size={20} />
            </span>
            <p className="font-display text-[15px] font-extrabold text-gelo">
              Não foi possível reproduzir agora
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-aco">{erro}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" className="cf-botao-fantasma !min-h-[40px] !px-4" onClick={() => {
                setErro(null);
                setAvisoFonte(null);
                setIndiceFonte(0);
                setTentativa((n) => n + 1);
              }}>
                <RotateCcw size={15} /> Tentar de novo
              </button>
              {fonte?.tipo === "externo" && fonte.url && (
                <a href={fonte.url} target="_blank" rel="noreferrer noopener" className="cf-botao-fantasma !min-h-[40px] !px-4">
                  <ExternalLink size={15} /> Abrir no site oficial
                </a>
              )}
            </div>
            {fontes.length > 1 && (
              <p className="mt-3 text-[11.5px] leading-relaxed text-aco">
                Fontes testadas: {fontes.map((f) => f.rotulo ?? "fonte").join(", ")}.
              </p>
            )}
            <p className="mt-2 text-[11.5px] leading-relaxed text-discreto">
              Canais e títulos de terceiros podem ter bloqueio geográfico, sair do ar ou exigir
              DRM. O CopaLinks respeita essas restrições.
            </p>
          </div>
        </div>
      )}

      <div className="cf-player-controles">
        {avisoFonte && !erro && (
          <span className="mb-1.5 mr-1.5 inline-flex items-center gap-1.5 rounded-full border border-ouro/45 bg-ouro/10 px-2.5 py-1 text-[11px] font-semibold text-ouro">
            <Shuffle size={11} /> {avisoFonte}
          </span>
        )}
        {retomando && !erro && (
          <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-ciano/45 bg-ciano/10 px-2.5 py-1 text-[11px] font-semibold text-ciano">
            <RotateCcw size={11} /> Retomando de {tempo(inicioInicial)}
          </span>
        )}

        <div
          className="cf-barra"
          role="slider"
          tabIndex={0}
          aria-label="Progresso do vídeo"
          aria-valuemin={0}
          aria-valuemax={Math.round(duracao)}
          aria-valuenow={Math.round(posicao)}
          aria-valuetext={`${tempo(posicao)} de ${tempo(duracao)}`}
          onPointerDown={(evento) => {
            const alvo = evento.currentTarget;
            const retangulo = alvo.getBoundingClientRect();
            const mover = (x: number) => procurar((x - retangulo.left) / retangulo.width);
            mover(evento.clientX);
            alvo.setPointerCapture?.(evento.pointerId);
            const aoMover = (e: PointerEvent) => mover(e.clientX);
            const aoSoltar = () => {
              alvo.removeEventListener("pointermove", aoMover);
              alvo.removeEventListener("pointerup", aoSoltar);
            };
            alvo.addEventListener("pointermove", aoMover);
            alvo.addEventListener("pointerup", aoSoltar);
          }}
          onKeyDown={(evento) => {
            if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(evento.key)) return;
            evento.preventDefault();
            evento.stopPropagation();
            if (evento.key === "ArrowRight") procurar((posicao + 10) / (duracao || 1));
            else if (evento.key === "ArrowLeft") procurar((posicao - 10) / (duracao || 1));
            else if (evento.key === "Home") procurar(0);
            else if (evento.key === "End") procurar(0.999);
          }}
        >
          <div className="cf-barra-trilho">
            <span className="cf-barra-carregado" style={{ width: `${percentualCarregado}%` }} />
            <span className="cf-barra-visto" style={{ width: `${percentual}%` }} />
          </div>
          <span className="cf-barra-alca" style={{ left: `${percentual}%` }} aria-hidden />
        </div>

        <div className="mt-0.5 flex items-center gap-1">
          <button type="button" className="cf-controle" onClick={alternarPlay} aria-label={tocando ? "Pausar" : "Reproduzir"}>
            {tocando ? <Pause size={18} className="fill-current" /> : <Play size={18} className="ml-0.5 fill-current" />}
          </button>

          <div className="group flex items-center">
            <button type="button" className="cf-controle" onClick={alternarMudo} aria-label={mudo ? "Ativar som" : "Silenciar"}>
              {mudo || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={mudo ? 0 : volume}
              onChange={(e) => mudarVolume(Number(e.target.value))}
              aria-label="Volume"
              className="cf-volume hidden accent-ciano sm:block"
            />
          </div>

          <span className="tabular px-1 font-display text-[11.5px] font-semibold text-gelo/80">
            {tempo(posicao)} <span className="text-aco/60">/</span>{" "}
            {duracao ? tempo(duracao) : aoVivo ? "ao vivo" : "--:--"}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {niveis.length > 1 && (
              <select
                aria-label="Qualidade do vídeo"
                className="cf-select hidden sm:block"
                value={nivelAtual}
                onChange={(e) => mudarQualidade(e.target.value)}
              >
                <option value={-1}>Auto</option>
                {niveis.map((nivel) => (
                  <option key={nivel.index} value={nivel.index}>
                    {nivel.height ? `${nivel.height}p` : nivel.name || `Nível ${nivel.index + 1}`}
                  </option>
                ))}
              </select>
            )}
            {aoProximo && (
              <button
                type="button"
                className="cf-controle"
                onClick={() => {
                  salvar(true);
                  aoProximo();
                }}
                aria-label={rotuloProximo ? `Próximo: ${rotuloProximo}` : "Próximo episódio"}
                title={rotuloProximo ? `Próximo: ${rotuloProximo}` : "Próximo episódio"}
              >
                <SkipForward size={18} />
              </button>
            )}
            <button
              type="button"
              className="cf-controle"
              onClick={() => void alternarTelaCheia()}
              aria-label={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
            >
              {telaCheia ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
