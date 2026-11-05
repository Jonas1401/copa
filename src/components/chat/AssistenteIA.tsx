"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { motion } from "framer-motion";
import { Bot, ImagePlus, LoaderCircle, RotateCcw, Send, X } from "lucide-react";

type MsgIA = {
  id?: number;
  papel: "user" | "assistant";
  texto: string;
  criadoEm?: string;
  /** A mensagem tem imagem salva no servidor (GET /api/ia/imagem/[id]). */
  temImagem?: boolean;
  /** Prévia local da foto enviada agora (data URL), antes de recarregar a conversa. */
  previa?: string;
};

/** Lado máximo da foto enviada: o servidor também reduz, mas o celular gasta menos dados. */
const LADO_FOTO = 1024;

const SUGESTOES = [
  "🔧 Que peça é essa? Vou enviar uma foto.",
  "🚛 Meu caminhão perdeu força. O que pode ser?",
  "⚙️ Como funciona o sistema de embreagem?",
  "🔥 Meu motor está esquentando. O que verificar?",
  "⚡ Minha bateria não está carregando.",
  "🛞 Meu caminhão está com barulho na suspensão.",
];

/** Recursos exclusivamente automotivos apresentados na tela inicial. */
const PODE_FAZER: { emoji: string; titulo: string; texto: string; pergunta: string }[] = [
  { emoji: "🔧", titulo: "Identificar uma peça", texto: "Envie uma foto e descubra o nome, a função e a aplicação da peça.", pergunta: "Quero identificar uma peça do meu veículo. Vou enviar uma foto." },
  { emoji: "🚛", titulo: "Problemas no caminhão", texto: "Descreva o defeito e receba possíveis causas e orientações seguras.", pergunta: "Estou com um problema no caminhão. Ajude a investigar as possíveis causas." },
  { emoji: "🚗", titulo: "Problemas no carro", texto: "Hipóteses de diagnóstico e orientações para veículos de passeio.", pergunta: "Estou com um problema no carro. Ajude a investigar as possíveis causas." },
  { emoji: "⚡", titulo: "Elétrica automotiva", texto: "Bateria, alternador, sensores, módulos e falhas elétricas.", pergunta: "Quero ajuda com um problema elétrico automotivo." },
  { emoji: "🛠️", titulo: "Manutenção e reparos", texto: "Entenda como funcionam os componentes e os cuidados necessários.", pergunta: "Quero aprender sobre manutenção e reparos automotivos." },
  { emoji: "🔍", titulo: "Luzes e códigos de falha", texto: "Entenda alertas do painel e códigos OBD, ABS e EBS.", pergunta: "Quero entender uma luz de advertência ou um código de falha do veículo." },
];

/** Lê a foto escolhida e devolve JPEG reduzido (data URL), já com a rotação do celular. */
function lerFoto(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      try {
        const escala = Math.min(1, LADO_FOTO / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("sem canvas");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("imagem inválida"));
    };
    img.src = url;
  });
}

function urlImagemDaConversa(id: number, motoristaId: number) {
  return `/api/ia/imagem/${id}?motoristaId=${motoristaId}`;
}

/** Imagem dentro da bolha; toque abre em tamanho real. */
function ImagemConversa({ src, alt }: { src: string; alt: string }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-1.5 block overflow-hidden rounded-[12px] bg-black/25">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" className="max-h-72 w-full object-contain" />
    </a>
  );
}

export default function AssistenteIA({
  aberto,
  onFechar,
  motorista,
}: {
  aberto: boolean;
  onFechar: () => void;
  motorista: { id: number; nome: string } | null;
}) {
  const [msgs, setMsgs] = useState<MsgIA[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const fotoInput = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const seguirFim = useRef(true);
  const motoristaId = motorista?.id;

  // Recarrega a conversa só ao abrir ou trocar de motorista. O app atualiza o
  // relógio a cada segundo e recria o objeto `motorista` a cada renderização;
  // depender do objeto disparava GET contínuos, piscadas e saltos de rolagem.
  useEffect(() => {
    if (!aberto) return;
    seguirFim.current = true;
    if (!motoristaId) {
      setMsgs([]);
      setCarregado(true);
      return;
    }
    const controller = new AbortController();
    setCarregado(false);
    setErro("");
    void (async () => {
      try {
        const r = await fetch(`/api/ia/chat?motoristaId=${motoristaId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const d = await r.json();
        if (controller.signal.aborted) return;
        if (r.ok) setMsgs((d.mensagens ?? []) as MsgIA[]);
        else setErro(d.erro ?? "Não foi possível carregar a conversa.");
      } catch {
        if (!controller.signal.aborted) setErro("Sem conexão com o assistente.");
      } finally {
        if (!controller.signal.aborted) setCarregado(true);
      }
    })();
    return () => controller.abort();
  }, [aberto, motoristaId]);

  // Rola APENAS a lista de mensagens, não o documento nem o chat atrás dela.
  // Quando o motorista sobe para reler mensagens, não o puxa de volta ao fim.
  useLayoutEffect(() => {
    if (!aberto || !seguirFim.current) return;
    const lista = listaRef.current;
    if (lista) lista.scrollTop = lista.scrollHeight;
  }, [msgs, aberto, enviando, carregado]);

  async function enviar(pergunta?: string) {
    const t = (pergunta ?? texto).trim();
    const imagem = foto;
    if ((!t && !imagem) || enviando || !motorista) return;
    setEnviando(true);
    setErro("");
    setTexto("");
    setFoto(null);
    seguirFim.current = true;
    setMsgs((a) => [...a, { papel: "user", texto: t, previa: imagem ?? undefined }]);
    try {
      const r = await fetch("/api/ia/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motoristaId: motorista.id, texto: t, ...(imagem ? { imagem } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d.erro ?? "A IA não respondeu.");
        if (imagem) setFoto(imagem);
        return;
      }
      setMsgs((a) => [
        ...a,
        {
          papel: "assistant",
          texto: d.resposta,
          criadoEm: d.criadoEm,
          id: d.idResposta ?? undefined,
          temImagem: Boolean(d.temImagem),
        },
      ]);
    } catch {
      setErro("Sem conexão. A pergunta não foi enviada.");
      if (imagem) setFoto(imagem);
    } finally {
      setEnviando(false);
    }
  }

  async function escolherFoto(evento: ChangeEvent<HTMLInputElement>) {
    const input = evento.currentTarget;
    const arquivo = input.files?.[0];
    input.value = "";
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) {
      setErro("Escolha um arquivo de imagem (JPG, PNG ou WebP).");
      return;
    }
    try {
      setFoto(await lerFoto(arquivo));
      setErro("");
    } catch {
      setErro("Não consegui abrir essa foto. Tente outra.");
    }
  }

  async function novaConversa() {
    if (!motorista || !confirm("Apagar esta conversa e começar outra?")) return;
    setErro("");
    try {
      await fetch(`/api/ia/chat?motoristaId=${motorista.id}`, { method: "DELETE" });
    } catch {
      /* limpa a tela mesmo sem rede */
    }
    seguirFim.current = true;
    setMsgs([]);
  }

  if (!aberto) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Assistente Mecânico CopaLinks"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="fundo-app fixed inset-0 z-[70] flex flex-col bg-fundo"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_50%_at_50%_0%,rgba(0, 184, 188, 0.22),transparent_60%)]" />

      <header className="largura-aparelho relative flex items-center gap-3 border-b border-[#183341]/60 px-3 py-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#00B8BC] text-[#000D16] shadow-[0_0_22px_-6px_rgba(0, 184, 188, 0.9)]">
          <Bot size={22} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[18px] leading-tight font-extrabold text-white">Assistente Mecânico CopaLinks</h2>
          <p className="truncate text-[12.5px] text-gelo/70">Seu mecânico inteligente para veículos de todas as categorias</p>
        </div>
        <button
          type="button"
          onClick={() => void novaConversa()}
          aria-label="Nova conversa"
          title="Nova conversa"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <RotateCcw size={19} />
        </button>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar o assistente"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X size={22} />
        </button>
      </header>

      <div
        ref={listaRef}
        onScroll={(e) => {
          const lista = e.currentTarget;
          seguirFim.current = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 64;
        }}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="largura-aparelho flex flex-col gap-2.5 px-3 py-4">
          {!motorista && (
            <p className="rounded-[16px] border border-ambar/40 bg-ambar/10 px-4 py-3 text-center text-[14px] text-gelo/85">
              Cadastre seu nome no app para conversar com o assistente.
            </p>
          )}
          {motorista && !carregado && msgs.length === 0 && (
            <p className="py-8 text-center text-[14px] text-gelo/60">Carregando…</p>
          )}
          {motorista && carregado && msgs.length === 0 && (
            <div className="rounded-[20px] border border-[#183341]/45 bg-[#071A28]/80 p-4">
              <p className="font-display text-[16px] font-bold text-white">
                Assistente Mecânico CopaLinks 🔧
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-gelo/80">
                Seu mecânico inteligente! Identifique peças, descubra possíveis defeitos, entenda problemas mecânicos e receba orientações de manutenção para seu veículo.
              </p>
              <ul className="mt-3 space-y-2">
                {PODE_FAZER.map((p) => (
                  <li key={p.titulo}>
                    <button
                      type="button"
                      onClick={() => void enviar(p.pergunta)}
                      disabled={enviando}
                      className="flex w-full gap-2.5 rounded-[14px] bg-white/[0.04] px-3 py-2 text-left transition hover:bg-[#00B8BC]/10 disabled:opacity-50"
                    >
                      <span className="shrink-0 text-[20px] leading-6" aria-hidden>{p.emoji}</span>
                      <span className="text-[13.5px] leading-snug text-gelo/85">
                        <b className="text-white">{p.titulo}</b><span className="block">{p.texto}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] text-gelo/65">Escolha um assunto ou descreva o que acontece com seu veículo.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void enviar(s)}
                    disabled={enviando}
                    className="rounded-full border border-[#183341]/60 bg-[#00B8BC]/15 px-3 py-2 text-left text-[13px] font-semibold text-gelo hover:bg-[#00B8BC]/25 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) =>
            m.papel === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[84%] rounded-[18px] rounded-tr-md border border-[#183341] bg-[#002F3B] px-3.5 py-2.5 text-[15px] leading-snug break-words whitespace-pre-wrap text-gelo">
                  {(m.previa || (m.temImagem && m.id)) && (
                    <ImagemConversa
                      src={m.previa ?? urlImagemDaConversa(m.id as number, motoristaId ?? 0)}
                      alt="Foto enviada"
                    />
                  )}
                  {m.texto}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[88%] rounded-[18px] rounded-tl-md border border-[#183341]/45 bg-[#071A28]/95 px-3.5 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-[#8FA8AC]">
                    <Bot size={13} /> Assistente
                  </div>
                  {m.temImagem && m.id && (
                    <ImagemConversa src={urlImagemDaConversa(m.id, motoristaId ?? 0)} alt="Imagem criada pelo assistente" />
                  )}
                  <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-gelo">{m.texto}</div>
                </div>
              </div>
            ),
          )}
          {enviando && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-[18px] rounded-tl-md border border-[#183341]/45 bg-[#071A28]/95 px-3.5 py-3 text-[14px] text-gelo/70">
                <LoaderCircle size={16} className="animate-spin" /> Já te respondo…
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className="relative border-t border-[#183341]/60 bg-[#071A28]/95 px-3 pt-2"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="largura-aparelho">
          {erro && <p className="mb-1.5 text-[13px] text-ambar">{erro}</p>}
          {foto && (
            <div className="mb-1.5 flex items-center gap-2 rounded-[16px] border border-[#183341]/45 bg-[#071A28]/80 p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto} alt="Foto escolhida" className="h-12 w-12 shrink-0 rounded-[10px] object-cover" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-gelo/80">Foto pronta. Escreva o que quer saber ou pedir.</span>
              <button
                type="button"
                onClick={() => setFoto(null)}
                aria-label="Tirar a foto"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
            className="flex items-end gap-2"
          >
            <input ref={fotoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void escolherFoto(e)} />
            <button
              type="button"
              onClick={() => fotoInput.current?.click()}
              disabled={!motorista || enviando}
              aria-label="Enviar uma foto"
              title="Enviar uma foto"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-45"
            >
              <ImagePlus size={20} />
            </button>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={1}
              disabled={!motorista}
              placeholder={motorista ? (foto ? "Pergunte sobre a peça ou o defeito na foto…" : "Descreva o problema ou faça uma pergunta de mecânica…") : "Cadastre seu nome para conversar…"}
              aria-label="Pergunta para o assistente"
              className="max-h-[120px] min-h-[48px] flex-1 resize-none rounded-[24px] border-[1.5px] border-[#183341]/60 bg-[#071A28]/80 px-4 py-3 text-[15px] text-white outline-none placeholder:text-gelo/45 focus:border-[#00B8BC] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={(!texto.trim() && !foto) || enviando || !motorista}
              aria-label="Enviar pergunta"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#00B8BC] text-[#000D16] shadow-[0_0_22px_-6px_rgba(0, 184, 188, 0.9)] disabled:opacity-45"
            >
              <Send size={20} strokeWidth={2.4} />
            </button>
          </form>
          <p className="mt-1 text-[11.5px] text-gelo/50">Orientações de IA: diagnósticos são hipóteses. Em falha de freio, direção ou superaquecimento grave, pare em local seguro e procure assistência.</p>
        </div>
      </div>
    </motion.div>
  );
}
