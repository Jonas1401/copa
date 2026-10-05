"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { motion } from "framer-motion";
import NextImage from "next/image";
import {
  ArrowLeft,
  AudioLines,
  BadgeCheck,
  Bell,
  BellOff,
  Bot,
  Camera,
  Check,
  ChevronRight,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  MapPin,
  Mic,
  Pause,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Smile,
  Sticker,
  Trash2,
  Users,
  Waves,
  X,
} from "lucide-react";
import { EMOJIS, FIGURINHAS, figurinhaDe, soEmojis, textoDaFigurinha } from "@/lib/figurinhas";
import AssistenteIA from "@/components/chat/AssistenteIA";

export type MensagemChat = {
  id: number;
  motoristaId: number;
  nome: string;
  texto: string;
  criadoEm: string;
  tipo?: "texto" | "audio" | "imagem" | "arquivo" | string;
  mediaNome?: string | null;
  mediaTipo?: string | null;
  mediaUrl?: string | null;
  duracaoSegundos?: number | null;
};

export const CHAVE_CHAT_LIDO = "copalinks-chat-lido";
const TAMANHO_MAX = 500;
const TAMANHO_MAX_MIDIA = 4 * 1024 * 1024;
const FUSO = "America/Sao_Paulo";

const CORES_NOME = [
  "text-[#6fe7df]",
  "text-[#ffc83d]",
  "text-[#b98cf5]",
  "text-[#ff9f43]",
  "text-[#35e08a]",
  "text-[#7fb6f0]",
  "text-[#ff7a90]",
];
const FUNDOS_AVATAR = ["#155c88", "#38528e", "#60458e", "#1c746c", "#8a572b", "#345c75", "#8a4057"];
const ALTURAS_ONDA = [5, 9, 14, 8, 18, 11, 6, 15, 22, 10, 17, 7, 13, 20, 9, 16, 6, 12, 19, 8, 14, 22, 10, 17, 7, 13, 19, 9, 15, 6, 12, 18];

const diaDe = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: FUSO });
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

function rotuloDia(dia: string) {
  const hoje = diaDe(new Date().toISOString());
  const ontem = diaDe(new Date(Date.now() - 86400000).toISOString());
  if (dia === hoje) return "Hoje";
  if (dia === ontem) return "Ontem";
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

function formatarDuracao(segundos: number) {
  if (!Number.isFinite(segundos) || segundos <= 0) return "0:00";
  const inteiro = Math.floor(segundos);
  return `${Math.floor(inteiro / 60)}:${String(inteiro % 60).padStart(2, "0")}`;
}

function AvatarCopa({ tamanho = 42, classe = "", robo = false }: { tamanho?: number; classe?: string; robo?: boolean }) {
  return (
    <span
      role="img"
      aria-label={robo ? "Robô oficial do CopaLinks" : "CopaLinks"}
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-[#73b6ff]/45 bg-[#061b3b] shadow-[0_0_16px_-8px_rgba(75,164,255,.9)] ${classe}`}
      style={{ width: tamanho, height: tamanho }}
    >
      {robo ? (
        <span className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_35%_25%,#1c61a1,#071b3b_72%)] text-[#9bdcff]">
          <Bot size={Math.round(tamanho * 0.53)} strokeWidth={1.9} />
        </span>
      ) : (
        <NextImage src="/icons/copalinks-192.png" alt="" fill sizes={`${tamanho}px`} unoptimized className="rounded-full object-cover" />
      )}
    </span>
  );
}

function AvatarMotorista({ nome, id, tamanho = 34 }: { nome: string; id: number; tamanho?: number }) {
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("") || "M";
  const fundo = FUNDOS_AVATAR[Math.abs(id) % FUNDOS_AVATAR.length];
  return (
    <span
      aria-label={`Avatar de ${nome}`}
      className="grid shrink-0 place-items-center rounded-full border border-white/15 font-display font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16)]"
      style={{ width: tamanho, height: tamanho, background: `linear-gradient(145deg, ${fundo}, #092044)`, fontSize: Math.max(11, tamanho * 0.34) }}
    >
      {iniciais}
    </span>
  );
}

type TipoPainel = null | "emojis" | "figurinhas" | "anexos";
type AudioGravacao = {
  gravador: MediaRecorder;
  fluxo: MediaStream;
  partes: BlobPart[];
  iniciouEm: number;
};

export default function ChatMotoristas({
  aberto,
  onFechar,
  motorista,
  onLido,
}: {
  aberto: boolean;
  onFechar: () => void;
  motorista: { id: number; nome: string } | null;
  /** Avisa o app até qual mensagem o motorista já viu (zera a bolinha). */
  onLido: (ultimoId: number) => void;
}) {
  const [msgs, setMsgs] = useState<MensagemChat[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviandoMidia, setEnviandoMidia] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [iaAberta, setIaAberta] = useState(false);
  const [silenciado, setSilenciado] = useState(false);
  const [trocandoSilencio, setTrocandoSilencio] = useState(false);
  const [participantes, setParticipantes] = useState<number | null>(null);
  const [painel, setPainel] = useState<TipoPainel>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [infoAberta, setInfoAberta] = useState(false);
  const [mensagensNovas, setMensagensNovas] = useState(0);
  const [gravando, setGravando] = useState(false);
  const [solicitandoMicrofone, setSolicitandoMicrofone] = useState(false);
  const [tempoGravacao, setTempoGravacao] = useState(0);
  const [alturaVisual, setAlturaVisual] = useState<{ altura: number; topo: number } | null>(null);

  const campo = useRef<HTMLTextAreaElement>(null);
  const ultimoId = useRef(0);
  const idsConhecidos = useRef(new Set<number>());
  const colado = useRef(true);
  const lista = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gravacao = useRef<AudioGravacao | null>(null);
  const cancelarGravacao = useRef(false);
  const fotoInput = useRef<HTMLInputElement>(null);
  const galeriaInput = useRef<HTMLInputElement>(null);
  const arquivoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const motoristaId = motorista?.id;

  const juntar = useCallback((novas: MensagemChat[]) => {
    const unicas = novas.filter((mensagem) => {
      if (idsConhecidos.current.has(mensagem.id)) return false;
      idsConhecidos.current.add(mensagem.id);
      return true;
    });
    if (!unicas.length) return;
    ultimoId.current = Math.max(ultimoId.current, ...unicas.map((mensagem) => mensagem.id));
    if (!colado.current) setMensagensNovas((quantidade) => quantidade + unicas.length);
    setMsgs((atual) => [...atual, ...unicas].sort((a, b) => a.id - b.id).slice(-200));
  }, []);

  // A viewport visual encolhe ao abrir o teclado no iOS/Android. Usá-la como
  // altura do diálogo mantém o compositor acima do teclado, sem rolar a página.
  useEffect(() => {
    if (!aberto) return;
    const atualizar = () => {
      const visual = window.visualViewport;
      setAlturaVisual({ altura: visual?.height ?? window.innerHeight, topo: visual?.offsetTop ?? 0 });
    };
    atualizar();
    window.visualViewport?.addEventListener("resize", atualizar);
    window.visualViewport?.addEventListener("scroll", atualizar);
    window.addEventListener("resize", atualizar);
    return () => {
      window.visualViewport?.removeEventListener("resize", atualizar);
      window.visualViewport?.removeEventListener("scroll", atualizar);
      window.removeEventListener("resize", atualizar);
    };
  }, [aberto]);

  // Bloqueia a rolagem da tela anterior enquanto a conversa estiver aberta.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = anterior; };
  }, [aberto]);

  // Carrega as últimas mensagens e consulta novidades a cada 4 s. O corpo da
  // mídia nunca é puxado junto com o polling: só vem quando alguém dá play.
  useEffect(() => {
    if (!aberto || iaAberta) return;
    let vivo = true;
    colado.current = true;
    setMensagensNovas(0);
    setCarregado(false);
    const controller = new AbortController();

    void (async () => {
      try {
        const resposta = await fetch("/api/chat", { cache: "no-store", signal: controller.signal });
        if (!resposta.ok) throw new Error("Falha ao carregar o chat.");
        const dados = await resposta.json();
        if (!vivo) return;
        const iniciais = (dados.mensagens ?? []) as MensagemChat[];
        idsConhecidos.current = new Set(iniciais.map((mensagem) => mensagem.id));
        ultimoId.current = iniciais.at(-1)?.id ?? 0;
        setMsgs(iniciais);
        setErro("");
      } catch {
        if (vivo) setErro("Sem conexão com o chat. Vou tentar novamente em instantes.");
      } finally {
        if (vivo) setCarregado(true);
      }
    })();

    const intervalo = setInterval(async () => {
      try {
        const resposta = await fetch(`/api/chat?depois=${ultimoId.current || 0}`, { cache: "no-store" });
        if (!resposta.ok) throw new Error("Falha ao atualizar o chat.");
        const dados = await resposta.json();
        if (!vivo) return;
        juntar((dados.mensagens ?? []) as MensagemChat[]);
        setErro("");
      } catch {
        // Uma indisponibilidade momentânea não interrompe as próximas consultas.
      }
    }, 4000);

    return () => {
      vivo = false;
      controller.abort();
      clearInterval(intervalo);
    };
  }, [aberto, iaAberta, juntar]);

  // Estado do "silenciar chat" deste motorista, sincronizado entre aparelhos.
  useEffect(() => {
    if (!aberto || !motoristaId) return;
    let vivo = true;
    fetch("/api/chat/silencio", { cache: "no-store" })
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((dados) => { if (vivo && dados) setSilenciado(Boolean(dados.silenciado)); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [aberto, motoristaId]);

  // Marca como lido e rola somente a lista das mensagens.
  useEffect(() => {
    if (!aberto || iaAberta) return;
    const ultimo = msgs.at(-1)?.id;
    if (ultimo) onLido(ultimo);
  }, [msgs, aberto, iaAberta, onLido]);

  useLayoutEffect(() => {
    if (!aberto || iaAberta || !colado.current) return;
    const conteudo = lista.current;
    if (conteudo) conteudo.scrollTop = conteudo.scrollHeight;
  }, [msgs, aberto, iaAberta]);

  useEffect(() => {
    if (!aberto || !motoristaId) return;
    let vivo = true;
    const carregarContagem = async () => {
      try {
        const resposta = await fetch("/api/motoristas", { cache: "no-store" });
        const dados = resposta.ok ? await resposta.json() : null;
        if (vivo && dados) setParticipantes(Number(dados.total) || 0);
      } catch { /* a contagem é apenas indicativa */ }
    };
    void carregarContagem();
    const timer = setInterval(() => void carregarContagem(), 60_000);
    return () => { vivo = false; clearInterval(timer); };
  }, [aberto, motoristaId]);

  // Fecha menus com Esc/clique fora. O foco volta ao compositor após fechar.
  useEffect(() => {
    if (!menuAberto) return;
    const fora = (evento: PointerEvent) => {
      if (evento.target instanceof Node && !menuRef.current?.contains(evento.target)) setMenuAberto(false);
    };
    const esc = (evento: KeyboardEvent) => { if (evento.key === "Escape") setMenuAberto(false); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [menuAberto]);

  useEffect(() => {
    if (!gravando) return;
    const timer = setInterval(() => {
      const atual = gravacao.current;
      if (atual) setTempoGravacao(Math.floor((Date.now() - atual.iniciouEm) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [gravando]);

  useEffect(() => {
    if (aberto) return;
    cancelarGravacao.current = true;
    const atual = gravacao.current;
    if (atual) {
      atual.fluxo.getTracks().forEach((trilha) => trilha.stop());
      if (atual.gravador.state !== "inactive") atual.gravador.stop();
      gravacao.current = null;
    }
    setGravando(false);
    setTempoGravacao(0);
  }, [aberto]);

  async function alternarSilencio() {
    if (!motorista || trocandoSilencio) return;
    const novo = !silenciado;
    setTrocandoSilencio(true);
    try {
      const resposta = await fetch("/api/chat/silencio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ silenciado: novo }),
      });
      if (!resposta.ok) throw new Error();
      setSilenciado(novo);
      setAviso(novo
        ? "Notificações do chat silenciadas. Os avisos do seu ponto continuam chegando."
        : "Notificações do chat ativadas novamente.");
      setTimeout(() => setAviso(""), 4000);
    } catch {
      setAviso("Não foi possível mudar as notificações agora. Tente novamente.");
      setTimeout(() => setAviso(""), 4000);
    } finally {
      setTrocandoSilencio(false);
    }
  }

  function inserirEmoji(emoji: string) {
    const el = campo.current;
    const inicio = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const novo = (texto.slice(0, inicio) + emoji + texto.slice(fim)).slice(0, TAMANHO_MAX);
    setTexto(novo);
    requestAnimationFrame(() => {
      if (!el) return;
      const posicao = Math.min(inicio + emoji.length, novo.length);
      el.focus();
      el.setSelectionRange(posicao, posicao);
    });
  }

  async function enviar(conteudo?: string) {
    const mensagem = (conteudo ?? texto).trim();
    if (!mensagem || enviando || !motorista) return;
    setEnviando(true);
    setErro("");
    try {
      const resposta = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motoristaId: motorista.id, texto: mensagem }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setErro(dados.erro ?? "Não foi possível enviar o recado.");
        return;
      }
      if (conteudo === undefined) setTexto("");
      setPainel(null);
      colado.current = true;
      setMensagensNovas(0);
      juntar([dados.mensagem as MensagemChat]);
    } catch {
      setErro("Sem conexão. A mensagem não foi enviada.");
    } finally {
      setEnviando(false);
    }
  }

  async function enviarMidia(arquivo: Blob, tipo: "audio" | "imagem" | "arquivo", duracao?: number, nome?: string) {
    if (!motorista || enviandoMidia) return;
    if (!arquivo.size || arquivo.size > TAMANHO_MAX_MIDIA) {
      setErro("O anexo precisa ter até 4 MB.");
      return;
    }
    setEnviandoMidia(true);
    setErro("");
    try {
      const form = new FormData();
      form.set("motoristaId", String(motorista.id));
      form.set("tipo", tipo);
      if (duracao) form.set("duracaoSegundos", String(duracao));
      form.set("arquivo", arquivo, nome || (tipo === "audio" ? "recado-de-voz.webm" : "anexo"));
      const resposta = await fetch("/api/chat", { method: "POST", body: form });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setErro(dados.erro ?? "Não foi possível enviar o anexo.");
        return;
      }
      setPainel(null);
      colado.current = true;
      setMensagensNovas(0);
      juntar([dados.mensagem as MensagemChat]);
      setAviso(tipo === "audio" ? "Áudio enviado para os motoristas." : "Anexo enviado para os motoristas.");
      setTimeout(() => setAviso(""), 2800);
    } catch {
      setErro("Sem conexão. O anexo não foi enviado.");
    } finally {
      setEnviandoMidia(false);
    }
  }

  async function duracaoDeAudio(arquivo: File) {
    const url = URL.createObjectURL(arquivo);
    try {
      const duracao = await new Promise<number>((resolve) => {
        const elemento = new Audio();
        const limpar = () => {
          elemento.onloadedmetadata = null;
          elemento.onerror = null;
          URL.revokeObjectURL(url);
        };
        const limite = setTimeout(() => { limpar(); resolve(0); }, 2500);
        elemento.onloadedmetadata = () => {
          clearTimeout(limite);
          const valor = Number.isFinite(elemento.duration) ? Math.round(elemento.duration) : 0;
          limpar();
          resolve(valor);
        };
        elemento.onerror = () => { clearTimeout(limite); limpar(); resolve(0); };
        elemento.src = url;
      });
      return duracao;
    } catch {
      URL.revokeObjectURL(url);
      return 0;
    }
  }

  async function escolherAnexo(arquivo: File, tipo: "audio" | "imagem" | "arquivo") {
    if (tipo === "audio") {
      const duracao = await duracaoDeAudio(arquivo);
      await enviarMidia(arquivo, tipo, duracao, arquivo.name);
      return;
    }
    await enviarMidia(arquivo, tipo, undefined, arquivo.name);
  }

  function mudouArquivo(evento: ChangeEvent<HTMLInputElement>, tipo: "audio" | "imagem" | "arquivo") {
    const input = evento.currentTarget;
    const arquivo = input.files?.[0];
    input.value = "";
    if (arquivo) void escolherAnexo(arquivo, tipo);
  }

  function iniciarGravacao() {
    if (!motorista || gravando || solicitandoMicrofone) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErro("Este navegador não oferece gravação de áudio. Escolha um arquivo de áudio no botão +.");
      return;
    }
    setSolicitandoMicrofone(true);
    setErro("");
    void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((fluxo) => {
        if (!aberto) {
          fluxo.getTracks().forEach((trilha) => trilha.stop());
          return;
        }
        const formatos = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
        const mime = formatos.find((formato) => MediaRecorder.isTypeSupported(formato));
        let gravador: MediaRecorder;
        try {
          gravador = mime ? new MediaRecorder(fluxo, { mimeType: mime }) : new MediaRecorder(fluxo);
        } catch (erro) {
          fluxo.getTracks().forEach((trilha) => trilha.stop());
          throw erro;
        }
        const partes: BlobPart[] = [];
        const iniciouEm = Date.now();
        gravacao.current = { gravador, fluxo, partes, iniciouEm };
        cancelarGravacao.current = false;
        gravador.ondataavailable = (evento) => { if (evento.data.size) partes.push(evento.data); };
        gravador.onerror = () => {
          fluxo.getTracks().forEach((trilha) => trilha.stop());
          gravacao.current = null;
          setGravando(false);
          setErro("A gravação foi interrompida. Tente novamente.");
        };
        gravador.onstop = () => {
          fluxo.getTracks().forEach((trilha) => trilha.stop());
          gravacao.current = null;
          if (cancelarGravacao.current) {
            cancelarGravacao.current = false;
            setTempoGravacao(0);
            return;
          }
          const blob = new Blob(partes, { type: gravador.mimeType || "audio/webm" });
          const duracao = Math.max(1, Math.round((Date.now() - iniciouEm) / 1000));
          if (!blob.size) {
            setErro("Não foi possível capturar o áudio. Grave novamente.");
            return;
          }
          void enviarMidia(blob, "audio", duracao, `recado-${Date.now()}.${(gravador.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm"}`);
        };
        try {
          gravador.start(250);
        } catch (erro) {
          fluxo.getTracks().forEach((trilha) => trilha.stop());
          gravacao.current = null;
          throw erro;
        }
        setTempoGravacao(0);
        setGravando(true);
        setPainel(null);
      })
      .catch(() => setErro("Não foi possível acessar o microfone. Verifique a permissão do navegador."))
      .finally(() => setSolicitandoMicrofone(false));
  }

  function encerrarGravacao(enviarAudio: boolean) {
    const atual = gravacao.current;
    if (!atual) return;
    cancelarGravacao.current = !enviarAudio;
    setGravando(false);
    if (!enviarAudio) {
      atual.fluxo.getTracks().forEach((trilha) => trilha.stop());
      setTempoGravacao(0);
      setAviso("Gravação cancelada.");
      setTimeout(() => setAviso(""), 1800);
    }
    if (atual.gravador.state !== "inactive") atual.gravador.stop();
  }

  function compartilharLocalizacao() {
    setPainel(null);
    if (!navigator.geolocation) {
      setErro("Seu navegador não permite compartilhar localização.");
      return;
    }
    setErro("");
    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        const latitude = posicao.coords.latitude.toFixed(5);
        const longitude = posicao.coords.longitude.toFixed(5);
        void enviar(`📍 Localização compartilhada:\nhttps://www.google.com/maps?q=${latitude},${longitude}`);
      },
      () => setErro("Não foi possível obter a localização. Confira a permissão do navegador."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
    );
  }

  async function apagar(mensagem: MensagemChat) {
    if (!motorista || !confirm("Apagar esta mensagem para todos?")) return;
    try {
      const resposta = await fetch(`/api/chat/${mensagem.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motoristaId: motorista.id }),
      });
      if (!resposta.ok) throw new Error();
      idsConhecidos.current.delete(mensagem.id);
      setMsgs((anteriores) => anteriores.filter((item) => item.id !== mensagem.id));
    } catch {
      setErro("Não foi possível apagar a mensagem.");
    }
  }

  async function atualizarAgora() {
    setMenuAberto(false);
    setErro("");
    try {
      const url = ultimoId.current ? `/api/chat?depois=${ultimoId.current}` : "/api/chat";
      const resposta = await fetch(url, { cache: "no-store" });
      if (!resposta.ok) throw new Error();
      const dados = await resposta.json();
      if (ultimoId.current) juntar((dados.mensagens ?? []) as MensagemChat[]);
      else {
        const mensagens = (dados.mensagens ?? []) as MensagemChat[];
        idsConhecidos.current = new Set(mensagens.map((mensagem) => mensagem.id));
        ultimoId.current = mensagens.at(-1)?.id ?? 0;
        setMsgs(mensagens);
      }
      setAviso("Conversa atualizada.");
      setTimeout(() => setAviso(""), 1800);
    } catch {
      setErro("Não foi possível atualizar a conversa.");
    }
  }

  function irParaUltimaMensagem() {
    const conteudo = lista.current;
    if (!conteudo) return;
    colado.current = true;
    setMensagensNovas(0);
    conteudo.scrollTo({ top: conteudo.scrollHeight, behavior: "smooth" });
  }

  function ajustarAlturaCampo() {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(112, Math.max(52, el.scrollHeight))}px`;
  }

  useEffect(() => { ajustarAlturaCampo(); }, [texto]);

  if (!aberto) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Chat dos motoristas"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="fundo-app fixed inset-x-0 z-[65] flex flex-col overflow-hidden text-gelo"
      style={{
        top: alturaVisual ? `${alturaVisual.topo}px` : 0,
        height: alturaVisual ? `${alturaVisual.altura}px` : "100dvh",
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_48%_at_50%_0%,rgba(44,126,230,.27),transparent_68%)]" />

      <header className="largura-aparelho relative z-20 w-full shrink-0 border-b border-[#1d4690]/60 px-3 pb-2.5 pt-[max(8px,env(safe-area-inset-top))] sm:px-5">
        <div className="flex min-h-[54px] items-center gap-2">
          <button
            type="button"
            onClick={onFechar}
            aria-label="Voltar para o CopaLinks"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-[#061b3b]/75 text-white transition-colors hover:border-[#6fe7df]/50 hover:bg-[#0c2a4a]"
          >
            <ArrowLeft size={21} strokeWidth={2.3} />
          </button>
          <AvatarCopa tamanho={42} />
          <div className="min-w-0 flex-1 pl-0.5 text-center">
            <h2 className="truncate font-display text-[16.5px] leading-tight font-extrabold text-white sm:text-[18px]">Chat dos motoristas</h2>
            <p className="mt-0.5 flex min-w-0 items-center justify-center gap-1 truncate text-[11px] leading-tight text-gelo/65 sm:text-[12px]">
              <span className="truncate">Recados sobre o trabalho</span>
              <span className="shrink-0 text-gelo/30">·</span>
              <Users size={11} className="shrink-0 text-[#7fb6f0]" />
              <span className="shrink-0">{participantes === null ? "motoristas" : `${participantes} motorista${participantes === 1 ? "" : "s"}`}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void alternarSilencio()}
            disabled={!motorista || trocandoSilencio}
            aria-pressed={silenciado}
            aria-label={silenciado ? "Ativar notificações do chat" : "Silenciar notificações do chat"}
            title={silenciado ? "Ativar notificações do chat" : "Silenciar notificações do chat"}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-45 ${silenciado ? "border-amber-300/20 bg-amber-400/10 text-amber-200" : "border-white/10 bg-[#061b3b]/75 text-gelo/90 hover:border-[#6fe7df]/45 hover:text-ciano"}`}
          >
            {silenciado ? <BellOff size={18} /> : <Bell size={18} />}
          </button>
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuAberto((aberto) => !aberto)}
              aria-expanded={menuAberto}
              aria-label="Mais opções do chat"
              className={`grid h-10 w-10 place-items-center rounded-full border transition-colors ${menuAberto ? "border-[#6fe7df]/50 bg-[#0b2152] text-ciano" : "border-white/10 bg-[#061b3b]/75 text-gelo/90 hover:border-[#6fe7df]/45 hover:text-ciano"}`}
            >
              <EllipsisVertical size={20} />
            </button>
            {menuAberto && (
              <div role="menu" className="absolute right-0 top-[48px] z-30 w-[236px] overflow-hidden rounded-[20px] border border-[#3972bb]/50 bg-[#071b3a]/[.98] p-1.5 shadow-[0_18px_50px_-18px_rgba(0,0,0,.85)] backdrop-blur-xl">
                <button type="button" role="menuitem" onClick={() => void atualizarAgora()} className="flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[13px] font-semibold text-gelo/90 hover:bg-white/[.07]">
                  <RefreshCw size={16} className="text-[#7fb6f0]" /> Atualizar conversa
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuAberto(false); void alternarSilencio(); }} disabled={!motorista} className="flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[13px] font-semibold text-gelo/90 hover:bg-white/[.07] disabled:opacity-45">
                  {silenciado ? <Bell size={16} className="text-ciano" /> : <BellOff size={16} className="text-[#7fb6f0]" />}
                  {silenciado ? "Ativar notificações" : "Silenciar notificações"}
                </button>
                <div className="my-1 h-px bg-white/[.08]" />
                <button type="button" role="menuitem" onClick={() => { setMenuAberto(false); setInfoAberta(true); }} className="flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[13px] font-semibold text-gelo/90 hover:bg-white/[.07]">
                  <Info size={16} className="text-[#7fb6f0]" /> Sobre este grupo
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Atalho permanente para a conversa real do Assistente IA do CopaLinks. */}
      <div className="largura-aparelho relative z-10 w-full shrink-0 px-3 pt-2.5 pb-2 sm:px-5">
        <button
          type="button"
          onClick={() => setIaAberta(true)}
          aria-label="Abrir conversa com a Assistente IA"
          className="group relative flex min-h-[78px] w-full items-center gap-3 overflow-hidden rounded-[22px] border border-[#a271ff]/40 bg-[linear-gradient(112deg,#211344_0%,#32175c_52%,#18275d_100%)] px-3.5 py-3 text-left shadow-[0_10px_32px_-22px_rgba(139,61,255,.85),inset_0_1px_0_rgba(255,255,255,.09)] transition duration-200 hover:border-[#b98cf5]/70 hover:shadow-[0_12px_34px_-18px_rgba(139,61,255,.75)] active:scale-[.99] sm:px-4"
        >
          <span aria-hidden className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-[#8b3dff]/15 blur-2xl" />
          <span className="relative grid h-[48px] w-[48px] shrink-0 place-items-center rounded-[17px] border border-white/15 bg-[linear-gradient(145deg,#8b3dff,#5f43c2)] text-white shadow-[0_0_24px_-8px_rgba(139,61,255,.9)]">
            <Bot size={24} strokeWidth={2.1} />
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block font-display text-[15.5px] leading-tight font-extrabold text-white">Assistente IA</span>
            <span className="mt-1 block truncate text-[12px] leading-tight text-[#e5d9ff]/75 sm:text-[12.5px]">Tire suas dúvidas e receba informações rápidas!</span>
          </span>
          <ChevronRight size={21} className="relative shrink-0 text-[#c9b3ff] transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <main className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={lista}
          role="log"
          aria-label="Mensagens do chat"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(evento) => {
            const elemento = evento.currentTarget;
            colado.current = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < 72;
            if (colado.current) setMensagensNovas(0);
          }}
          className="barra-rolagem largura-aparelho relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5"
        >
          <div className="mx-auto flex min-h-full w-full max-w-[728px] flex-col gap-2.5 py-3.5 sm:py-5">
            {!carregado && msgs.length === 0 && (
              <div className="flex flex-1 items-center justify-center py-12 text-center text-[13px] text-gelo/55">
                <span className="inline-flex items-center gap-2"><LoaderCircle size={17} className="animate-spin text-[#7fb6f0]" /> Carregando recados…</span>
              </div>
            )}
            {carregado && msgs.length === 0 && (
              <div className="my-auto rounded-[25px] border border-[#2a5bb0]/55 bg-[linear-gradient(145deg,rgba(12,38,83,.78),rgba(5,20,49,.72))] px-5 py-7 text-center shadow-[inset_0_1px_0_rgba(255,255,255,.06)] sm:px-8">
                <span className="mx-auto grid h-[58px] w-[58px] place-items-center rounded-[20px] border border-[#6fe7df]/20 bg-[#2f8cf0]/15 text-[#8dd8ff]">
                  <Waves size={27} />
                </span>
                <h3 className="mt-4 font-display text-[17px] font-extrabold text-white">A conversa começa aqui</h3>
                <p className="mx-auto mt-1.5 max-w-[330px] text-[13.5px] leading-relaxed text-gelo/70">Compartilhe uma informação da estrada, da fila ou do porto com os motoristas do CopaLinks.</p>
                {motorista && (
                  <button type="button" onClick={() => campo.current?.focus()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-[#6fe7df]/30 bg-[#2f8cf0]/10 px-4 text-[12.5px] font-bold text-[#a7e6ff] transition-colors hover:bg-[#2f8cf0]/20">
                    <Send size={14} /> Enviar o primeiro recado
                  </button>
                )}
              </div>
            )}

            {msgs.map((mensagem, indice) => {
              const anterior = msgs[indice - 1];
              const novoDia = !anterior || diaDe(anterior.criadoEm) !== diaDe(mensagem.criadoEm);
              const sistema = mensagem.motoristaId === 0;
              const oficial = sistema && /copa\s*links/i.test(mensagem.nome.replace(/[^a-zA-Z]/g, ""));
              const meu = !sistema && motorista?.id === mensagem.motoristaId;
              const seguida = !sistema && !novoDia && anterior?.motoristaId === mensagem.motoristaId &&
                new Date(mensagem.criadoEm).getTime() - new Date(anterior.criadoEm).getTime() < 5 * 60_000;
              return (
                <div key={mensagem.id}>
                  {novoDia && (
                    <div className="my-2.5 flex justify-center">
                      <span className="rounded-full border border-white/[.06] bg-[#071b3b]/85 px-3.5 py-1 text-[11px] font-bold capitalize tracking-wide text-gelo/65 shadow-sm">
                        {rotuloDia(diaDe(mensagem.criadoEm))}
                      </span>
                    </div>
                  )}
                  {sistema ? (
                    <div className={`mt-1 flex max-w-full items-end gap-2 ${oficial ? "" : "opacity-95"}`}>
                      <AvatarCopa tamanho={35} robo={oficial} classe={oficial ? "border-[#6fb8ff]/55" : "border-white/10 opacity-85"} />
                      <div className={`relative min-w-0 flex-1 overflow-hidden rounded-[19px] border px-3.5 pt-2.5 pb-2 ${oficial ? "border-[#3477c1]/55 bg-[linear-gradient(135deg,rgba(11,38,83,.98),rgba(7,25,58,.96))] shadow-[0_10px_26px_-24px_rgba(65,158,255,.8)]" : "border-[#2a5bb0]/45 bg-[#091d43]/85"}`}>
                        {oficial && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-[linear-gradient(180deg,#6fe7df,#2f8cf0)]" />}
                        <div className="flex items-center gap-1.5 pl-1">
                          {oficial ? (
                            <>
                              <span className="font-display text-[13px] font-extrabold text-white">CopaLinks</span>
                              <BadgeCheck size={15} className="fill-[#2f8cf0] text-white" aria-label="Conta oficial verificada" />
                              <span className="ml-auto rounded-full border border-[#6fe7df]/20 bg-[#2f8cf0]/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[.13em] text-[#9bdaff]">Oficial</span>
                            </>
                          ) : (
                            <span className="font-display text-[12.5px] font-bold text-[#9bc5f1]">{mensagem.nome}</span>
                          )}
                        </div>
                        <div className="mt-1.5 pl-1 text-[14px] leading-[1.48] break-words whitespace-pre-wrap text-gelo"><ConteudoMensagem texto={mensagem.texto} meu={false} /></div>
                        <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[10.5px] text-gelo/45">
                          <span>{hora(mensagem.criadoEm)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex w-full items-end gap-2 ${meu ? "flex-row-reverse" : ""} ${seguida ? "mt-0.5" : "mt-1"}`}>
                      <AvatarMotorista nome={mensagem.nome} id={mensagem.motoristaId} />
                      <div className={`min-w-0 flex-1 rounded-[19px] border px-3.5 pt-2.5 pb-2 shadow-[0_8px_22px_-20px_rgba(0,0,0,.9)] ${meu ? "border-[#4c92e8]/45 bg-[linear-gradient(145deg,rgba(19,64,129,.93),rgba(10,43,91,.95))]" : "border-[#2a5bb0]/55 bg-[linear-gradient(145deg,rgba(10,31,70,.97),rgba(7,24,57,.96))]"}`}>
                        {!seguida && <div className={`mb-1 font-display text-[12.5px] font-extrabold ${meu ? "text-[#a9dbff]" : CORES_NOME[Math.abs(mensagem.motoristaId) % CORES_NOME.length]}`}>{meu ? "Você" : mensagem.nome}</div>}
                        {mensagem.tipo === "audio" ? (
                          <PlayerAudio mensagem={mensagem} />
                        ) : mensagem.tipo === "imagem" && mensagem.mediaUrl ? (
                          <div>
                            <a href={mensagem.mediaUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[14px] border border-white/10 bg-black/20">
                              <span className="relative block h-[220px] w-full sm:h-[270px]">
                                <NextImage src={mensagem.mediaUrl} alt={mensagem.mediaNome || "Imagem enviada ao chat"} fill sizes="(max-width: 640px) 80vw, 640px" unoptimized className="object-contain" />
                              </span>
                            </a>
                            {mensagem.mediaNome && <p className="mt-1.5 truncate text-[11px] text-gelo/60">{mensagem.mediaNome}</p>}
                          </div>
                        ) : mensagem.tipo === "arquivo" && mensagem.mediaUrl ? (
                          <a href={mensagem.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-[14px] border border-[#6fa7e7]/20 bg-[#071b3b]/65 p-2.5 transition-colors hover:bg-[#0d2b58]">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-[#2f8cf0]/15 text-[#9bd7ff]"><FileText size={19} /></span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-bold text-white">{mensagem.mediaNome || "Arquivo"}</span><span className="mt-0.5 block text-[10.5px] text-gelo/50">Toque para abrir ou baixar</span></span>
                            <ExternalLink size={15} className="shrink-0 text-gelo/45" />
                          </a>
                        ) : (
                          <ConteudoMensagem texto={mensagem.texto} meu={meu} />
                        )}
                        <div className={`mt-1.5 flex items-center justify-end gap-2 text-[10.5px] ${meu ? "text-[#d6eaff]/55" : "text-gelo/45"}`}>
                          {meu && (
                            <button type="button" onClick={() => void apagar(mensagem)} aria-label="Apagar minha mensagem" className="inline-flex min-h-[24px] items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-white/10 hover:text-white">
                              <Trash2 size={11} /> apagar
                            </button>
                          )}
                          <span className="tabular">{hora(mensagem.criadoEm)}</span>
                          {meu && <Check size={13} className="text-[#8ed8ff]" aria-label="Enviada" />}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {erro && !motorista && <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/[.07] px-3 py-2 text-center text-[12px] text-amber-100/85">{erro}</p>}
          </div>
        </div>
        {mensagensNovas > 0 && (
          <button type="button" onClick={irParaUltimaMensagem} className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#6fe7df]/35 bg-[#092451]/95 px-4 py-2.5 text-[12px] font-extrabold text-white shadow-[0_12px_26px_-12px_rgba(0,0,0,.8)] backdrop-blur-lg">
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#2f8cf0] px-1 tabular text-[10px]">{mensagensNovas > 9 ? "9+" : mensagensNovas}</span>
            Nova mensagem
            <ChevronRight size={14} className="rotate-90 text-ciano" />
          </button>
        )}
      </main>

      <footer className="relative z-20 w-full shrink-0 border-t border-[#1d4690]/60 bg-[#06122b]/[.96] px-3 pt-2.5 backdrop-blur-xl sm:px-5" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        <div className="largura-aparelho">
          {erro && motorista && <p role="alert" className="mb-1.5 rounded-xl border border-amber-300/20 bg-amber-300/[.07] px-3 py-2 text-[12px] leading-snug text-amber-100/90">{erro}</p>}
          {aviso && <p role="status" className="mb-1.5 flex items-center gap-2 rounded-xl border border-[#6fe7df]/15 bg-[#2f8cf0]/[.08] px-3 py-1.5 text-[11.5px] text-[#b7e5ff]"><Check size={14} />{aviso}</p>}

          {painel === "anexos" && (
            <div className="mb-2.5 rounded-[19px] border border-[#2a5bb0]/55 bg-[#081d40]/[.98] p-2.5 shadow-[0_12px_30px_-20px_rgba(0,0,0,.8)]">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="font-display text-[12px] font-extrabold text-white">Compartilhar com o grupo</span>
                <button type="button" onClick={() => setPainel(null)} aria-label="Fechar menu de anexos" className="grid h-8 w-8 place-items-center rounded-full text-gelo/55 hover:bg-white/10 hover:text-white"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-5 gap-1">
                <AcaoAnexo icone={Camera} rotulo="Foto" onClick={() => { setPainel(null); fotoInput.current?.click(); }} />
                <AcaoAnexo icone={ImageIcon} rotulo="Galeria" onClick={() => { setPainel(null); galeriaInput.current?.click(); }} />
                <AcaoAnexo icone={FileText} rotulo="Arquivo" onClick={() => { setPainel(null); arquivoInput.current?.click(); }} />
                <AcaoAnexo icone={MapPin} rotulo="Localização" onClick={compartilharLocalizacao} />
                <AcaoAnexo icone={Mic} rotulo="Áudio" onClick={() => { setPainel(null); audioInput.current?.click(); }} />
              </div>
            </div>
          )}

          {(painel === "emojis" || painel === "figurinhas") && (
            <div className="mb-2.5 rounded-[20px] border border-[#2a5bb0]/60 bg-[#081d40]/[.98] p-2.5 shadow-[0_12px_30px_-20px_rgba(0,0,0,.8)]">
              <div className="mb-2 flex gap-1.5" role="tablist" aria-label="Emojis e figurinhas">
                {(["emojis", "figurinhas"] as const).map((aba) => (
                  <button key={aba} type="button" role="tab" aria-selected={painel === aba} onClick={() => setPainel(aba)} className={`flex-1 rounded-full px-3 py-2 text-[12px] font-extrabold transition-colors ${painel === aba ? "bg-[#2f7fe8] text-white" : "bg-white/[.05] text-gelo/65 hover:bg-white/10"}`}>
                    {aba === "emojis" ? "😀 Emojis" : "🚛 Figurinhas"}
                  </button>
                ))}
                <button type="button" onClick={() => setPainel(null)} aria-label="Fechar emojis e figurinhas" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[.05] text-gelo/70 hover:text-white"><X size={16} /></button>
              </div>
              <div className="max-h-[190px] overflow-y-auto">
                {painel === "emojis" ? (
                  <div className="grid grid-cols-8 gap-0.5 sm:grid-cols-10">
                    {EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => inserirEmoji(emoji)} aria-label={`Inserir ${emoji}`} className="grid aspect-square place-items-center rounded-xl text-[23px] transition-colors hover:bg-white/10 active:scale-90">{emoji}</button>)}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {FIGURINHAS.map((figurinha) => (
                      <button key={figurinha.texto} type="button" disabled={enviando || !motorista} onClick={() => void enviar(textoDaFigurinha(figurinha))} aria-label={`Enviar figurinha: ${figurinha.texto}`} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.035] px-2.5 py-2 text-left transition-colors hover:bg-white/10 active:scale-[.98] disabled:opacity-45">
                        <span className="shrink-0 text-[27px] leading-none">{figurinha.emoji}</span>
                        <span className="text-[11.5px] leading-tight font-bold text-white">{figurinha.texto}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {painel === "figurinhas" && <p className="mt-1.5 text-center text-[10px] text-gelo/45">Toque numa figurinha para enviar</p>}
            </div>
          )}

          <form
            onSubmit={(evento) => { evento.preventDefault(); void enviar(); }}
            className="flex items-end gap-2"
          >
            <button
              type="button"
              onClick={() => { setPainel((atual) => atual === "anexos" ? null : "anexos"); campo.current?.blur(); }}
              disabled={!motorista || enviando || enviandoMidia || gravando}
              aria-label={painel === "anexos" ? "Fechar anexos" : "Adicionar anexo"}
              aria-expanded={painel === "anexos"}
              className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-40 ${painel === "anexos" ? "rotate-45 border-[#6fe7df]/40 bg-[#2f8cf0]/20 text-ciano" : "border-white/10 bg-white/[.07] text-gelo/90 hover:border-[#6fe7df]/35 hover:bg-white/10"}`}
            >
              <Plus size={23} strokeWidth={2.1} />
            </button>

            {gravando ? (
              <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-[22px] border border-rose-300/25 bg-[#351628]/85 px-3.5">
                <span className="relative grid h-2.5 w-2.5 shrink-0 place-items-center rounded-full bg-rose-400 shadow-[0_0_13px_rgba(251,113,133,.65)]"><span className="absolute h-full w-full animate-ping rounded-full bg-rose-400/70" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-[.08em] text-rose-100"><AudioLines size={14} /> Gravando áudio</span>
                  <span className="tabular mt-0.5 block font-display text-[13px] font-bold text-white">{formatarDuracao(tempoGravacao)} <span className="font-sans text-[10px] font-normal text-rose-100/55">· toque em enviar para compartilhar</span></span>
                </span>
                <button type="button" onClick={() => encerrarGravacao(false)} aria-label="Cancelar gravação" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[.07] text-gelo/75 hover:bg-white/15 hover:text-white"><X size={17} /></button>
              </div>
            ) : solicitandoMicrofone ? (
              <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-[22px] border border-[#2a5bb0]/55 bg-[#0b2152]/75 px-4 text-[12.5px] text-gelo/65"><LoaderCircle size={16} className="animate-spin text-ciano" /> Aguardando acesso ao microfone…</div>
            ) : (
              <div className="relative min-w-0 flex-1">
                <textarea
                  ref={campo}
                  value={texto}
                  onChange={(evento) => setTexto(evento.target.value.slice(0, TAMANHO_MAX))}
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter" && !evento.shiftKey) {
                      evento.preventDefault();
                      void enviar();
                    }
                  }}
                  rows={1}
                  disabled={!motorista || enviando || enviandoMidia}
                  placeholder={motorista ? "Escreva um recado para os motoristas…" : "Cadastre seu nome para participar…"}
                  aria-label="Mensagem para o chat dos motoristas"
                  className="barra-rolagem block max-h-[112px] min-h-[52px] w-full resize-none rounded-[23px] border border-[#2a5bb0]/75 bg-[#0b2152]/80 py-[15px] pl-4 pr-[76px] text-[13px] leading-[20px] text-white outline-none transition-colors placeholder:text-gelo/40 focus:border-[#6fe7df]/65 focus:ring-2 focus:ring-[#6fe7df]/10 disabled:opacity-50 sm:text-[14px]"
                />
                <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5">
                  <button type="button" onClick={() => setPainel((atual) => atual === "emojis" ? null : "emojis")} disabled={!motorista || enviando || enviandoMidia} aria-label="Abrir emojis" aria-expanded={painel === "emojis" || painel === "figurinhas"} className={`grid h-9 w-8 place-items-center rounded-full transition-colors disabled:opacity-35 ${painel === "emojis" || painel === "figurinhas" ? "text-ciano" : "text-gelo/55 hover:bg-white/[.07] hover:text-gelo"}`}>
                    {painel === "figurinhas" ? <Sticker size={18} /> : <Smile size={18} />}
                  </button>
                  <button type="button" onClick={() => { setPainel("anexos"); campo.current?.blur(); }} disabled={!motorista || enviando || enviandoMidia} aria-label="Anexar arquivo" className="grid h-9 w-8 place-items-center rounded-full text-gelo/55 transition-colors hover:bg-white/[.07] hover:text-gelo disabled:opacity-35"><Paperclip size={17} /></button>
                </div>
                {texto.length > TAMANHO_MAX - 80 && <span className="absolute -top-5 right-1 tabular text-[9.5px] text-gelo/45">{texto.length}/{TAMANHO_MAX}</span>}
              </div>
            )}

            {gravando ? (
              <button type="button" onClick={() => encerrarGravacao(true)} aria-label="Enviar gravação de áudio" className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-[#2f8cf0] text-white shadow-[0_0_22px_-7px_rgba(47,140,240,.9)] transition-transform hover:scale-[1.03] active:scale-95"><Send size={19} strokeWidth={2.3} /></button>
            ) : (
              <button
                type="button"
                onClick={() => texto.trim() ? void enviar() : iniciarGravacao()}
                disabled={!motorista || enviando || enviandoMidia || solicitandoMicrofone || (!texto.trim() && !carregado)}
                aria-label={texto.trim() ? "Enviar mensagem" : enviandoMidia ? "Enviando anexo" : "Gravar áudio"}
                title={texto.trim() ? "Enviar mensagem" : "Gravar áudio"}
                className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full text-white transition-all disabled:opacity-40 ${texto.trim() ? "bg-[linear-gradient(145deg,#39a5ff,#236dd0)] shadow-[0_0_22px_-8px_rgba(55,165,255,.85)]" : "bg-[linear-gradient(145deg,#2f8cf0,#2366c5)] shadow-[0_0_22px_-7px_rgba(47,140,240,.85)] hover:shadow-[0_0_26px_-6px_rgba(47,140,240,.9)]"}`}
              >
                {enviando || enviandoMidia ? <LoaderCircle size={20} className="animate-spin" /> : texto.trim() ? <Send size={19} strokeWidth={2.3} /> : <Mic size={20} strokeWidth={2.2} />}
              </button>
            )}
          </form>

          <div className="mt-1.5 flex min-h-[17px] items-center justify-center gap-1.5 pb-0.5 text-center text-[10.5px] leading-tight text-gelo/45 sm:text-[11px]">
            <Users size={12} className="shrink-0 text-[#7fb6f0]/70" />
            <span>Aparece para todos os motoristas do CopaLinks</span>
          </div>

          <input ref={fotoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(evento) => mudouArquivo(evento, "imagem")} />
          <input ref={galeriaInput} type="file" accept="image/*" className="hidden" onChange={(evento) => mudouArquivo(evento, "imagem")} />
          <input ref={arquivoInput} type="file" accept=".pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,text/plain" className="hidden" onChange={(evento) => mudouArquivo(evento, "arquivo")} />
          <input ref={audioInput} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm" className="hidden" onChange={(evento) => mudouArquivo(evento, "audio")} />
        </div>
      </footer>

      {infoAberta && (
        <div className="absolute inset-0 z-[68] flex items-end justify-center bg-[#020a19]/70 p-3 backdrop-blur-sm sm:items-center" onClick={() => setInfoAberta(false)}>
          <section role="dialog" aria-modal="true" aria-label="Sobre o chat dos motoristas" onClick={(evento) => evento.stopPropagation()} className="largura-aparelho relative overflow-hidden rounded-[26px] border border-[#3877c1]/45 bg-[linear-gradient(150deg,#0b2858,#071a3b_70%)] p-5 shadow-[0_24px_80px_-30px_rgba(0,0,0,.9)] sm:max-w-[440px]">
            <button type="button" onClick={() => setInfoAberta(false)} aria-label="Fechar detalhes" className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-white/[.06] text-gelo/70 hover:bg-white/10 hover:text-white"><X size={18} /></button>
            <div className="flex items-center gap-3 pr-9"><AvatarCopa tamanho={48} /><div><h3 className="font-display text-[17px] font-extrabold text-white">Chat dos motoristas</h3><p className="mt-0.5 text-[11.5px] text-gelo/55">Comunidade CopaLinks · Paranaguá</p></div></div>
            <div className="mt-4 space-y-2.5">
              <p className="flex items-start gap-2.5 rounded-[15px] bg-white/[.04] px-3 py-3 text-[12.5px] leading-relaxed text-gelo/80"><Users size={16} className="mt-0.5 shrink-0 text-[#7fb6f0]" />{participantes === null ? "Motoristas CopaLinks" : `${participantes} motorista${participantes === 1 ? "" : "s"}`} na comunidade. Seus recados podem ser vistos por todos.</p>
              <p className="flex items-start gap-2.5 rounded-[15px] bg-white/[.04] px-3 py-3 text-[12.5px] leading-relaxed text-gelo/80"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-ciano" />As mensagens ficam disponíveis por até 7 dias. Áudios e anexos são armazenados junto da mensagem.</p>
            </div>
            <button type="button" onClick={() => setInfoAberta(false)} className="mt-4 min-h-11 w-full rounded-full bg-[#2f8cf0] font-display text-[13px] font-extrabold text-white shadow-[0_8px_24px_-12px_rgba(47,140,240,.9)]">Entendi</button>
          </section>
        </div>
      )}

      <AssistenteIA aberto={iaAberta} onFechar={() => setIaAberta(false)} motorista={motorista} />
    </motion.div>
  );
}

function AcaoAnexo({ icone: Icone, rotulo, onClick }: { icone: typeof Camera; rotulo: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-w-0 flex-col items-center gap-1.5 rounded-[15px] px-1 py-2.5 text-center transition-colors hover:bg-white/[.07] active:scale-95">
      <span className="grid h-10 w-10 place-items-center rounded-[14px] border border-[#5794d6]/20 bg-[#2f8cf0]/[.13] text-[#a9dfff]"><Icone size={19} strokeWidth={1.9} /></span>
      <span className="max-w-full truncate text-[9.5px] font-bold leading-tight text-gelo/75 sm:text-[10.5px]">{rotulo}</span>
    </button>
  );
}

function PlayerAudio({ mensagem }: { mensagem: MensagemChat }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [tempoAtual, setTempoAtual] = useState(0);
  const [duracaoReal, setDuracaoReal] = useState(0);
  const barras = useMemo(() => ALTURAS_ONDA.map((altura, indice) => {
    const deslocamento = Math.abs(((mensagem.id * 11 + indice * 17) % 13) - 6);
    return Math.max(5, altura + deslocamento - 3);
  }), [mensagem.id]);

  useEffect(() => {
    const elemento = audio.current;
    if (!elemento) return;
    const atualizarTempo = () => setTempoAtual(elemento.currentTime || 0);
    const carregarDuracao = () => { if (Number.isFinite(elemento.duration)) setDuracaoReal(elemento.duration); };
    const terminou = () => { setTocando(false); setTempoAtual(0); };
    const pausado = () => setTocando(false);
    const pausarOutro = () => { if (!elemento.paused) elemento.pause(); };
    elemento.addEventListener("timeupdate", atualizarTempo);
    elemento.addEventListener("loadedmetadata", carregarDuracao);
    elemento.addEventListener("ended", terminou);
    elemento.addEventListener("pause", pausado);
    window.addEventListener("copalinks-pausar-outros-audios", pausarOutro);
    return () => {
      elemento.removeEventListener("timeupdate", atualizarTempo);
      elemento.removeEventListener("loadedmetadata", carregarDuracao);
      elemento.removeEventListener("ended", terminou);
      elemento.removeEventListener("pause", pausado);
      window.removeEventListener("copalinks-pausar-outros-audios", pausarOutro);
    };
  }, []);

  const duracao = mensagem.duracaoSegundos || duracaoReal;
  const progresso = duracao > 0 ? Math.min(1, tempoAtual / duracao) : 0;

  async function alternar() {
    const elemento = audio.current;
    if (!elemento || !mensagem.mediaUrl) return;
    if (tocando) {
      elemento.pause();
      setTocando(false);
      return;
    }
    window.dispatchEvent(new Event("copalinks-pausar-outros-audios"));
    try {
      await elemento.play();
      setTocando(true);
    } catch {
      setTocando(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <audio ref={audio} src={mensagem.mediaUrl ?? undefined} preload={mensagem.duracaoSegundos ? "none" : "metadata"} className="hidden" />
      <button type="button" onClick={() => void alternar()} disabled={!mensagem.mediaUrl} aria-label={tocando ? "Pausar áudio" : "Reproduzir áudio"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#8ddcff]/25 bg-[#2f8cf0] text-white shadow-[0_0_18px_-8px_rgba(47,140,240,.8)] transition-transform hover:scale-[1.04] active:scale-95 disabled:opacity-40">
        {tocando ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-[30px] min-w-0 items-center justify-between gap-[2px] overflow-hidden" aria-label="Forma de onda do áudio">
          {barras.map((altura, indice) => {
            const ativa = indice / barras.length <= progresso;
            return (
              <motion.span
                key={`${mensagem.id}-${indice}`}
                aria-hidden
                className={`chat-wave-bar w-[3px] shrink-0 rounded-full ${ativa ? "bg-[#7fe5e3]" : "bg-[#64a9ec]/65"}`}
                style={{ height: `${Math.min(24, altura)}px`, transformOrigin: "center" }}
                animate={tocando ? { scaleY: [0.62, 1, 0.7, 0.92] } : { scaleY: 1 }}
                transition={tocando ? { duration: 0.58 + (indice % 4) * 0.09, repeat: Infinity, repeatType: "mirror", delay: (indice % 7) * 0.035, ease: "easeInOut" } : { duration: 0.15 }}
              />
            );
          })}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] tabular text-gelo/55">
          <span>{tocando ? formatarDuracao(tempoAtual) : formatarDuracao(duracao)}</span>
          <span className="flex shrink-0 items-center gap-1"><AudioLines size={12} /> Áudio</span>
        </div>
      </div>
    </div>
  );
}

/** Texto comum, figurinha, emojis grandes ou link de localização compartilhada. */
function ConteudoMensagem({ texto, meu }: { texto: string; meu: boolean }) {
  const figurinha = figurinhaDe(texto);
  if (figurinha) {
    return (
      <div className="flex flex-col items-center px-2 pt-1 pb-0.5 text-center">
        <span className="text-[48px] leading-none drop-shadow-[0_4px_10px_rgba(0,0,0,.4)]">{figurinha.emoji}</span>
        <span className={`mt-1.5 rounded-full px-3 py-1 font-display text-[13px] font-extrabold ${meu ? "bg-white/15 text-white" : "bg-[#2f7fe8]/20 text-white"}`}>{figurinha.texto}</span>
      </div>
    );
  }
  if (soEmojis(texto)) return <div className="py-0.5 text-[40px] leading-tight">{texto.trim()}</div>;

  const localizacao = texto.match(/📍\s*Localização compartilhada:\s*\n?(https:\/\/www\.google\.com\/maps\?q=[-\d.,]+)/i);
  if (localizacao) {
    return (
      <div className="rounded-[14px] border border-[#6da9e8]/20 bg-[#061b3b]/55 p-2.5">
        <div className="flex items-center gap-2 text-[13px] font-bold text-white"><MapPin size={16} className="text-ciano" /> Localização compartilhada</div>
        <a href={localizacao[1]} target="_blank" rel="noreferrer" className="mt-2 flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-[#2f8cf0]/15 px-3 text-[11.5px] font-extrabold text-[#a9ddff] transition-colors hover:bg-[#2f8cf0]/25">Abrir no mapa <ExternalLink size={13} /></a>
      </div>
    );
  }

  return <div className="text-[14px] leading-[1.48] break-words whitespace-pre-wrap text-gelo">{texto}</div>;
}
