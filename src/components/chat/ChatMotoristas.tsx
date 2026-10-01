"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, Bot, MessagesSquare, Send, Smile, Sticker, Trash2, X } from "lucide-react";
import { EMOJIS, FIGURINHAS, figurinhaDe, soEmojis, textoDaFigurinha } from "@/lib/figurinhas";
import AssistenteIA from "@/components/chat/AssistenteIA";

export type MensagemChat = {
  id: number;
  motoristaId: number;
  nome: string;
  texto: string;
  criadoEm: string;
};

export const CHAVE_CHAT_LIDO = "copalinks-chat-lido";
const TAMANHO_MAX = 500;
const CORES_NOME = [
  "text-[#6fe7df]",
  "text-[#ffc83d]",
  "text-[#b98cf5]",
  "text-[#ff9f43]",
  "text-[#35e08a]",
  "text-[#7fb6f0]",
  "text-[#ff7a90]",
];

const FUSO = "America/Sao_Paulo";
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
  const [erro, setErro] = useState("");
  const [iaAberta, setIaAberta] = useState(false);
  // Silenciar SÓ as notificações do chat (vale para todos os aparelhos do motorista).
  const [silenciado, setSilenciado] = useState(false);
  const [trocandoSilencio, setTrocandoSilencio] = useState(false);
  const [avisoSilencio, setAvisoSilencio] = useState("");
  // Painel de emojis / figurinhas acima do campo de texto.
  const [painel, setPainel] = useState<null | "emojis" | "figurinhas">(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const ultimoId = useRef(0);
  const colado = useRef(true); // está no fim da conversa?
  const lista = useRef<HTMLDivElement>(null);

  const juntar = useCallback((novas: MensagemChat[]) => {
    if (!novas.length) return;
    setMsgs((atual) => {
      const ids = new Set(atual.map((m) => m.id));
      const tudo = [...atual, ...novas.filter((m) => !ids.has(m.id))].sort((a, b) => a.id - b.id).slice(-200);
      ultimoId.current = tudo.at(-1)?.id ?? ultimoId.current;
      return tudo;
    });
  }, []);

  // Carrega as últimas e busca novidades a cada 4 s. Enquanto o assistente
  // estiver sobre o chat, pausa a busca para a tela de trás não ficar rolando.
  // Ao fechar a IA, recarrega o chat e volta a buscar as mensagens novas.
  useEffect(() => {
    if (!aberto || iaAberta) return;
    let vivo = true;
    colado.current = true;
    void (async () => {
      try {
        const r = await fetch("/api/chat", { cache: "no-store" });
        const d = await r.json();
        if (!vivo) return;
        const m: MensagemChat[] = d.mensagens ?? [];
        ultimoId.current = m.at(-1)?.id ?? 0;
        setMsgs(m);
      } catch {
        if (vivo) setErro("Sem conexão com o chat.");
      } finally {
        if (vivo) setCarregado(true);
      }
    })();
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/chat?depois=${ultimoId.current || 0}`, { cache: "no-store" });
        const d = await r.json();
        if (vivo && ultimoId.current) juntar(d.mensagens ?? []);
        else if (vivo && (d.mensagens ?? []).length) juntar(d.mensagens);
        if (vivo) setErro("");
      } catch {
        /* tenta de novo em 4 s */
      }
    }, 4000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [aberto, iaAberta, juntar]);

  // Marca como lido e rola apenas a lista, não a página inteira. O chat
  // fica quieto enquanto o assistente cobre a tela.
  useEffect(() => {
    if (!aberto || iaAberta) return;
    const u = msgs.at(-1)?.id;
    if (u) onLido(u);
    const conteudo = lista.current;
    if (colado.current && conteudo) conteudo.scrollTop = conteudo.scrollHeight;
  }, [msgs, aberto, iaAberta, onLido]);

  // Estado do "silenciar chat" deste motorista, ao abrir o chat.
  useEffect(() => {
    if (!aberto || !motorista) return;
    let vivo = true;
    fetch("/api/chat/silencio", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d) setSilenciado(Boolean(d.silenciado)); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [aberto, motorista]);

  async function alternarSilencio() {
    if (!motorista || trocandoSilencio) return;
    const novo = !silenciado;
    setTrocandoSilencio(true);
    try {
      const r = await fetch("/api/chat/silencio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ silenciado: novo }),
      });
      if (!r.ok) throw new Error();
      setSilenciado(novo);
      setAvisoSilencio(novo
        ? "Notificações do chat silenciadas. Os avisos do seu ponto continuam chegando."
        : "Notificações do chat ativadas novamente.");
      setTimeout(() => setAvisoSilencio(""), 4000);
    } catch {
      setAvisoSilencio("Não foi possível mudar agora. Tente de novo.");
      setTimeout(() => setAvisoSilencio(""), 4000);
    } finally {
      setTrocandoSilencio(false);
    }
  }

  // Coloca o emoji onde está o cursor (ou no fim do texto).
  function inserirEmoji(emoji: string) {
    const el = campo.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const novo = (texto.slice(0, ini) + emoji + texto.slice(fim)).slice(0, TAMANHO_MAX);
    setTexto(novo);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = Math.min(ini + emoji.length, novo.length);
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function enviar(figurinha?: string) {
    const t = (figurinha ?? texto).trim();
    if (!t || enviando || !motorista) return;
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motoristaId: motorista.id, texto: t }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d.erro ?? "Não foi possível enviar.");
        return;
      }
      if (figurinha) setPainel(null);
      else setTexto("");
      colado.current = true;
      juntar([d.mensagem]);
    } catch {
      setErro("Sem conexão. A mensagem não foi enviada.");
    } finally {
      setEnviando(false);
    }
  }

  async function apagar(m: MensagemChat) {
    if (!motorista || !confirm("Apagar esta mensagem para todos?")) return;
    const r = await fetch(`/api/chat/${m.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motoristaId: motorista.id }),
    });
    if (r.ok) setMsgs((a) => a.filter((x) => x.id !== m.id));
    else setErro("Não foi possível apagar.");
  }

  if (!aberto) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Chat dos motoristas"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-[65] flex flex-col bg-[#063a78]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_50%_at_50%_0%,rgba(30,90,190,0.32),transparent_60%)]" />

      <header className="relative mx-auto w-full max-w-[360px] border-b border-[#1d4690]/60 px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#2f8cf0] text-white shadow-[0_0_22px_-6px_rgba(47,140,240,0.9)]">
            <MessagesSquare size={21} strokeWidth={2.3} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[18px] leading-tight font-extrabold text-white">Chat dos motoristas</h2>
            <p className={`truncate text-[12.5px] ${silenciado ? "text-ambar" : "text-gelo/70"}`}>
              {silenciado ? "🔕 Notificações do chat silenciadas" : "Recados sobre o trabalho · somem em 7 dias"}
            </p>
          </div>
          {motorista && (
            <button
              type="button"
              onClick={() => void alternarSilencio()}
              disabled={trocandoSilencio}
              aria-pressed={silenciado}
              aria-label={silenciado ? "Ativar notificações do chat" : "Silenciar notificações do chat"}
              title={silenciado ? "Ativar notificações do chat" : "Silenciar só as notificações do chat (os avisos do ponto continuam)"}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50 ${
                silenciado ? "bg-ambar/20 text-ambar hover:bg-ambar/30" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              {silenciado ? <BellOff size={20} /> : <Bell size={20} />}
            </button>
          )}
          <button type="button" onClick={onFechar} aria-label="Fechar o chat" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X size={22} />
          </button>
        </div>
        {/* Assistente de IA */}
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => setIaAberta(true)}
            aria-label="Abrir o assistente de IA"
            title="Assistente do CopaLinks: navios, caminhão, tempo e app"
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#8b3dff] px-3 text-[13px] font-bold text-white shadow-[0_0_22px_-6px_rgba(139,61,255,0.9)] hover:bg-[#9a5bff]"
          >
            <Bot size={17} className="shrink-0" /> <span className="truncate">Assistente IA</span>
          </button>
        </div>
        {avisoSilencio && (
          <p role="status" className="mt-2 rounded-xl border border-gelo/15 bg-black/35 px-3 py-2 text-[13px] text-gelo/90">{avisoSilencio}</p>
        )}
      </header>

      <div
        ref={lista}
        onScroll={(e) => {
          const el = e.currentTarget;
          colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-[360px] flex-col gap-1.5 px-3 py-4">
          {!carregado && <p className="py-8 text-center text-[14px] text-gelo/60">Carregando…</p>}
          {carregado && msgs.length === 0 && (
            <div className="mt-4 rounded-[20px] border border-[#2a5bb0]/55 bg-[#0b2152]/70 p-4 text-center">
              <MessagesSquare size={30} className="mx-auto text-azulclaro" />
              <p className="mt-2 font-display text-[16px] font-bold text-white">Nenhuma mensagem ainda</p>
              <p className="mt-1 text-[14px] text-gelo/75">Mande o primeiro recado: como está a fila, o pátio, a balança, o tempo…</p>
            </div>
          )}

          {msgs.map((m, i) => {
            const anterior = msgs[i - 1];
            const novoDia = !anterior || diaDe(anterior.criadoEm) !== diaDe(m.criadoEm);
            const sistema = m.motoristaId === 0;
            const meu = !sistema && motorista?.id === m.motoristaId;
            const seguida =
              !sistema &&
              !novoDia &&
              anterior?.motoristaId === m.motoristaId &&
              new Date(m.criadoEm).getTime() - new Date(anterior.criadoEm).getTime() < 5 * 60_000;
            return (
              <div key={m.id}>
                {novoDia && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-[#0b2152] px-3 py-1 text-[12px] font-semibold text-gelo/75 capitalize">
                      {rotuloDia(diaDe(m.criadoEm))}
                    </span>
                  </div>
                )}
                {sistema ? (
                  <div className="mt-1.5 rounded-[18px] border border-ambar/45 bg-ambar/[0.08] px-3.5 py-2.5">
                    <div className="text-[13px] font-bold text-ambar">{m.nome}</div>
                    <div className="mt-0.5 text-[14.5px] leading-snug break-words whitespace-pre-wrap text-gelo">
                      {m.texto}
                    </div>
                    <div className="tabular mt-1 text-right text-[11px] text-gelo/50">{hora(m.criadoEm)}</div>
                  </div>
                ) : (
                  <div className={`flex ${meu ? "justify-end" : "justify-start"} ${seguida ? "" : "mt-1.5"}`}>
                    <div
                      className={`max-w-[84%] rounded-[18px] px-3.5 pt-2 pb-1.5 ${
                        meu
                          ? `bg-[#2f7fe8] text-white ${seguida ? "rounded-tr-[18px]" : "rounded-tr-md"}`
                          : `border border-[#2a5bb0]/60 bg-[#0b2152]/90 text-gelo ${seguida ? "rounded-tl-[18px]" : "rounded-tl-md"}`
                      }`}
                    >
                      {!meu && !seguida && (
                        <div className={`mb-0.5 text-[13px] font-bold ${CORES_NOME[m.motoristaId % CORES_NOME.length]}`}>{m.nome}</div>
                      )}
                      <ConteudoMensagem texto={m.texto} meu={meu} />
                      <div className={`mt-0.5 flex items-center justify-end gap-2 text-[11px] ${meu ? "text-white/70" : "text-gelo/50"}`}>
                        {meu && (
                          <button type="button" onClick={() => void apagar(m)} aria-label="Apagar minha mensagem" className="inline-flex min-h-[24px] items-center gap-0.5 hover:text-white">
                            <Trash2 size={11} /> apagar
                          </button>
                        )}
                        <span className="tabular">{hora(m.criadoEm)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative border-t border-[#1d4690]/60 bg-[#06122b]/95 px-3 pt-2" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto w-full max-w-[360px]">
          {motorista ? (
            <>
              {erro && <p className="mb-1.5 text-[13px] text-ambar">{erro}</p>}
              {painel && (
                <div className="mb-2 rounded-[20px] border border-[#2a5bb0]/70 bg-[#0b2152] p-2">
                  <div className="mb-2 flex gap-1.5" role="tablist" aria-label="Emojis e figurinhas">
                    {(["emojis", "figurinhas"] as const).map((aba) => (
                      <button
                        key={aba}
                        type="button"
                        role="tab"
                        aria-selected={painel === aba}
                        onClick={() => setPainel(aba)}
                        className={`flex-1 rounded-full px-3 py-2 text-[13px] font-bold ${painel === aba ? "bg-[#2f7fe8] text-white" : "bg-white/5 text-gelo/75"}`}
                      >
                        {aba === "emojis" ? "😀 Emojis" : "🚛 Figurinhas"}
                      </button>
                    ))}
                    <button type="button" onClick={() => setPainel(null)} aria-label="Fechar emojis e figurinhas" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5 text-gelo/75 hover:text-white">
                      <X size={17} />
                    </button>
                  </div>
                  <div className="max-h-[210px] overflow-y-auto">
                    {painel === "emojis" ? (
                      <div className="grid grid-cols-8 gap-0.5">
                        {EMOJIS.map((e) => (
                          <button key={e} type="button" onClick={() => inserirEmoji(e)} aria-label={`Inserir ${e}`} className="grid aspect-square place-items-center rounded-xl text-[24px] hover:bg-white/10 active:scale-90">
                            {e}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {FIGURINHAS.map((f) => (
                          <button
                            key={f.texto}
                            type="button"
                            disabled={enviando}
                            onClick={() => void enviar(textoDaFigurinha(f))}
                            aria-label={`Enviar figurinha: ${f.texto}`}
                            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-left hover:bg-white/10 active:scale-95 disabled:opacity-50"
                          >
                            <span className="shrink-0 text-[28px] leading-none">{f.emoji}</span>
                            <span className="text-[12.5px] leading-tight font-bold text-white">{f.texto}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {painel === "figurinhas" && <p className="mt-1.5 text-center text-[11px] text-gelo/50">Toque para enviar na hora</p>}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enviar();
                }}
                className="flex items-end gap-2"
              >
                <button
                  type="button"
                  onClick={() => setPainel((p) => (p ? null : "emojis"))}
                  aria-label={painel ? "Fechar emojis e figurinhas" : "Abrir emojis e figurinhas"}
                  aria-expanded={Boolean(painel)}
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition-colors ${painel ? "bg-[#2f7fe8] text-white" : "bg-white/10 text-gelo/85 hover:bg-white/20"}`}
                >
                  {painel === "figurinhas" ? <Sticker size={22} /> : <Smile size={22} />}
                </button>
                <textarea
                  ref={campo}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value.slice(0, TAMANHO_MAX))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void enviar();
                    }
                  }}
                  rows={1}
                  placeholder="Escreva um recado para os motoristas…"
                  aria-label="Mensagem para o chat"
                  className="max-h-[120px] min-h-[48px] flex-1 resize-none rounded-[24px] border-[1.5px] border-[#2a5bb0]/80 bg-[#0b2152]/80 px-4 py-3 text-[15px] text-white outline-none placeholder:text-gelo/45 focus:border-ciano/70"
                />
                <button type="submit" disabled={!texto.trim() || enviando} aria-label="Enviar" className="ouro grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-45">
                  <Send size={20} strokeWidth={2.4} />
                </button>
              </form>
              <p className="mt-1 flex justify-between text-[11.5px] text-gelo/50">
                <span>Aparece para todos os motoristas do CopaLinks</span>
                {texto.length > TAMANHO_MAX - 80 && <span className="tabular">{texto.length}/{TAMANHO_MAX}</span>}
              </p>
            </>
          ) : (
            <p className="py-2 text-center text-[14px] text-gelo/75">Cadastre seu nome no app para participar do chat.</p>
          )}
        </div>
      </div>
      <AssistenteIA aberto={iaAberta} onFechar={() => setIaAberta(false)} motorista={motorista} />
    </motion.div>
  );
}

/** Texto comum, figurinha da lista (grande, com legenda) ou só emojis (grandes). */
function ConteudoMensagem({ texto, meu }: { texto: string; meu: boolean }) {
  const fig = figurinhaDe(texto);
  if (fig) {
    return (
      <div className="flex flex-col items-center px-2 pt-1 pb-0.5 text-center">
        <span className="text-[52px] leading-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]">{fig.emoji}</span>
        <span className={`mt-1.5 rounded-full px-3 py-1 font-display text-[14px] font-extrabold ${meu ? "bg-white/20 text-white" : "bg-[#2f7fe8]/25 text-white"}`}>
          {fig.texto}
        </span>
      </div>
    );
  }
  if (soEmojis(texto)) {
    return <div className="py-0.5 text-[44px] leading-tight">{texto.trim()}</div>;
  }
  return <div className="text-[15px] leading-snug break-words whitespace-pre-wrap">{texto}</div>;
}
