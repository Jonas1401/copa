"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, LoaderCircle, RotateCcw, Send, X } from "lucide-react";

type MsgIA = { papel: "user" | "assistant"; texto: string; criadoEm?: string };

const SUGESTOES = [
  "Quais navios de fertilizante estão chegando?",
  "Como está o tempo no porto?",
  "O freio tá falhando, e agora?",
  "Como cadastro meu ponto?",
];

/** O que o assistente sabe fazer (mostrado ao abrir, antes da 1ª pergunta). */
const PODE_FAZER: { emoji: string; titulo: string; texto: string }[] = [
  { emoji: "🚢", titulo: "Navios no porto", texto: "Quem está atracado, esperando ou chegando em Paranaguá e Antonina, com foco em fertilizante, toneladas e maré." },
  { emoji: "🚛", titulo: "Caminhão", texto: "Freio, motor, suspensão, elétrica, pneu, Arla… do básico ao mais cabeludo." },
  { emoji: "🌦️", titulo: "Tempo no porto", texto: "Chuva, vento e neblina agora, e o que isso muda na estrada e na fila." },
  { emoji: "📍", titulo: "Seus pontos e o app", texto: "Como anda a sua fila e como usar cada parte do CopaLinks." },
];

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
    if (!t || enviando || !motorista) return;
    setEnviando(true);
    setErro("");
    setTexto("");
    seguirFim.current = true;
    setMsgs((a) => [...a, { papel: "user", texto: t }]);
    try {
      const r = await fetch("/api/ia/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motoristaId: motorista.id, texto: t }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d.erro ?? "A IA não respondeu.");
        return;
      }
      setMsgs((a) => [...a, { papel: "assistant", texto: d.resposta, criadoEm: d.criadoEm }]);
    } catch {
      setErro("Sem conexão. A pergunta não foi enviada.");
    } finally {
      setEnviando(false);
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
      aria-label="Assistente de IA"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-[70] flex flex-col bg-[#050f28]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_50%_at_50%_0%,rgba(139,61,255,0.22),transparent_60%)]" />

      <header className="relative mx-auto flex w-full max-w-[640px] items-center gap-3 border-b border-[#1d4690]/60 px-3 py-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#8b3dff] text-white shadow-[0_0_22px_-6px_rgba(139,61,255,0.9)]">
          <Bot size={22} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[18px] leading-tight font-extrabold text-white">Assistente do CopaLinks</h2>
          <p className="truncate text-[12.5px] text-gelo/70">De motorista para motorista · navios, caminhão, tempo e app</p>
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
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2.5 px-3 py-4">
          {!motorista && (
            <p className="rounded-[16px] border border-ambar/40 bg-ambar/10 px-4 py-3 text-center text-[14px] text-gelo/85">
              Cadastre seu nome no app para conversar com o assistente.
            </p>
          )}
          {motorista && !carregado && msgs.length === 0 && (
            <p className="py-8 text-center text-[14px] text-gelo/60">Carregando…</p>
          )}
          {motorista && carregado && msgs.length === 0 && (
            <div className="rounded-[20px] border border-[#8b3dff]/45 bg-[#1a1040]/80 p-4">
              <p className="font-display text-[16px] font-bold text-white">
                E aí, {motorista.nome.trim().split(/\s+/)[0]}! Beleza? 👋
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-gelo/80">
                Sou o assistente do CopaLinks. Pode perguntar à vontade, que eu te ajudo com:
              </p>
              <ul className="mt-3 space-y-2">
                {PODE_FAZER.map((p) => (
                  <li key={p.titulo} className="flex gap-2.5 rounded-[14px] bg-white/[0.04] px-3 py-2">
                    <span className="shrink-0 text-[20px] leading-6" aria-hidden>{p.emoji}</span>
                    <span className="text-[13.5px] leading-snug text-gelo/85">
                      <b className="text-white">{p.titulo}:</b> {p.texto}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] text-gelo/65">Toca numa pergunta abaixo ou manda a sua. 🚛</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void enviar(s)}
                    disabled={enviando}
                    className="rounded-full border border-[#8b3dff]/60 bg-[#8b3dff]/15 px-3 py-2 text-left text-[13px] font-semibold text-gelo hover:bg-[#8b3dff]/25 disabled:opacity-50"
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
                <div className="max-w-[84%] rounded-[18px] rounded-tr-md bg-[#2f7fe8] px-3.5 py-2.5 text-[15px] leading-snug break-words whitespace-pre-wrap text-white">
                  {m.texto}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[88%] rounded-[18px] rounded-tl-md border border-[#8b3dff]/45 bg-[#150d33]/95 px-3.5 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-[#b98cf5]">
                    <Bot size={13} /> Assistente
                  </div>
                  <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-gelo">{m.texto}</div>
                </div>
              </div>
            ),
          )}
          {enviando && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-[18px] rounded-tl-md border border-[#8b3dff]/45 bg-[#150d33]/95 px-3.5 py-3 text-[14px] text-gelo/70">
                <LoaderCircle size={16} className="animate-spin" /> Já te respondo…
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className="relative border-t border-[#1d4690]/60 bg-[#06122b]/95 px-3 pt-2"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-[640px]">
          {erro && <p className="mb-1.5 text-[13px] text-ambar">{erro}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
            className="flex items-end gap-2"
          >
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
              placeholder={motorista ? "Manda sua pergunta: navio, caminhão, tempo…" : "Cadastre seu nome para conversar…"}
              aria-label="Pergunta para o assistente"
              className="max-h-[120px] min-h-[48px] flex-1 resize-none rounded-[24px] border-[1.5px] border-[#8b3dff]/60 bg-[#150d33]/80 px-4 py-3 text-[15px] text-white outline-none placeholder:text-gelo/45 focus:border-[#b98cf5] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!texto.trim() || enviando || !motorista}
              aria-label="Enviar pergunta"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#8b3dff] text-white shadow-[0_0_22px_-6px_rgba(139,61,255,0.9)] disabled:opacity-45"
            >
              <Send size={20} strokeWidth={2.4} />
            </button>
          </form>
          <p className="mt-1 text-[11.5px] text-gelo/50">Respostas automáticas — em emergência com freio/direção, pare e chame socorro.</p>
        </div>
      </div>
    </motion.div>
  );
}
