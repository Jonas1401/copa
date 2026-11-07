"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  EllipsisVertical,
  Pencil,
  ShieldCheck,
  X,
} from "lucide-react";

/**
 * Menu ⋮ do canto superior esquerdo da foto do caminhão.
 *
 * É o acesso discreto às ações da conta: trocar o nome do perfil, abrir o
 * pedido de notificações e entrar no painel de administração. Cada item
 * reaproveita a ação já existente no app. O gatilho tem o mesmo tamanho dos
 * outros controles do topo (44 px de toque), mas aparência ainda mais leve
 * (sem borda chamativa), para não brigar
 * com a foto.
 */
export default function MenuConta({
  nome,
  assinada,
  onRenomear,
  onAtivarNotificacoes,
}: {
  /** Nome atual do motorista (null = este aparelho ainda não tem perfil). */
  nome: string | null;
  /** Este aparelho já recebe os avisos (só muda o texto de apoio). */
  assinada: boolean;
  /** Mesma função da aba "Sobre": PATCH /api/motoristas/[id]. */
  onRenomear: (nome: string) => Promise<boolean>;
  /** Abre o painel de notificações já existente. */
  onAtivarNotificacoes: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [trocandoNome, setTrocandoNome] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [posicao, setPosicao] = useState({ top: 0, left: 12 });
  const botao = useRef<HTMLButtonElement>(null);
  const campoNome = useRef<HTMLInputElement>(null);

  function fechar() {
    setAberto(false);
    setTrocandoNome(false);
    setSalvando(false);
  }

  /**
   * O painel é `fixed` e nasce logo abaixo do botão: assim ele não é cortado
   * por nenhum ancestral com `overflow` nem fica preso ao empilhamento da foto.
   * Nas telas estreitas, o `left` é limitado para o menu não vazar à direita.
   */
  function abrir() {
    const r = botao.current?.getBoundingClientRect();
    const largura = Math.min(248, window.innerWidth - 24);
    setPosicao({
      top: (r?.bottom ?? 56) + 8,
      left: Math.max(12, Math.min(r?.left ?? 12, window.innerWidth - largura - 12)),
    });
    setAberto(true);
  }

  // Esc fecha; o clique fora é pego pela camada transparente que cobre a tela.
  // Girar o aparelho ou rolar a página também fecha (o menu é ancorado no botão).
  useEffect(() => {
    if (!aberto) return;
    const esc = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") fechar();
    };
    const rolar = () => setAberto(false);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", rolar, { passive: true });
    window.addEventListener("resize", rolar);
    return () => {
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", rolar);
      window.removeEventListener("resize", rolar);
    };
  }, [aberto]);

  useEffect(() => {
    if (trocandoNome) campoNome.current?.focus();
  }, [trocandoNome]);

  async function salvarNome() {
    const limpo = novoNome.replace(/\s+/g, " ").trim();
    if (limpo.length < 2 || salvando) return;
    setSalvando(true);
    const ok = await onRenomear(limpo);
    setSalvando(false);
    if (ok) fechar();
  }

  const item =
    "flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[13px] font-semibold text-gelo/90 transition-colors hover:bg-white/[.07] disabled:opacity-45";

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        aria-label="Mais opções"
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Mais opções"
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-black/20 text-gelo/55 backdrop-blur-[2px] transition-colors hover:border-white/25 hover:bg-black/40 hover:text-white sm:h-12 sm:w-12 ${
          aberto ? "border-white/25 bg-black/40 text-white" : ""
        }`}
      >
        <EllipsisVertical size={17} strokeWidth={1.8} />
      </button>

      {aberto && (
        // Camada transparente de tela cheia: qualquer toque fora fecha o menu.
        // z-[70] fica acima do rodapé (z-40) e abaixo dos diálogos (z-[80]).
        <div className="fixed inset-0 z-[70]" onClick={fechar}>
          <div
            role="menu"
            aria-label="Opções do CopaLinks"
            onClick={(evento) => evento.stopPropagation()}
            style={{ top: posicao.top, left: posicao.left }}
            className="absolute max-h-[calc(100dvh-96px)] w-[min(248px,calc(100vw-24px))] overflow-y-auto rounded-[20px] border border-[#183341]/50 bg-[#071A28]/[.98] p-1.5 shadow-[0_18px_50px_-18px_rgba(0,0,0,.85)] backdrop-blur-xl"
          >
            {trocandoNome ? (
              <div className="p-1.5">
                <label
                  htmlFor="menu-conta-nome"
                  className="micro mb-1.5 block text-gelo/55"
                >
                  Seu nome
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={campoNome}
                    id="menu-conta-nome"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void salvarNome();
                    }}
                    maxLength={60}
                    autoComplete="name"
                    autoCapitalize="words"
                    placeholder="Seu nome"
                    className="min-w-0 flex-1 rounded-full border-[1.5px] border-ouro/60 bg-[#071A28] px-3.5 py-2 font-display text-[14px] font-bold text-white outline-none placeholder:font-medium placeholder:text-gelo/40 focus:border-ouro"
                  />
                  <button
                    type="button"
                    onClick={() => void salvarNome()}
                    disabled={
                      salvando || novoNome.replace(/\s+/g, " ").trim().length < 2
                    }
                    aria-label="Salvar nome"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ouro text-[#000D16] disabled:opacity-45"
                  >
                    <CheckCircle2 size={17} strokeWidth={2.6} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrocandoNome(false)}
                    aria-label="Cancelar"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-gelo/25 text-gelo/80 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setNovoNome(nome ?? "");
                    setTrocandoNome(true);
                  }}
                  disabled={!nome}
                  className={item}
                >
                  <Pencil size={16} className="shrink-0 text-ouro" />
                  Trocar meu nome
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    fechar();
                    onAtivarNotificacoes();
                  }}
                  className={item}
                >
                  <Bell size={16} className="shrink-0 text-[#00B8BC]" />
                  <span className="min-w-0">
                    Ativar notificações
                    <span className="mt-0.5 block truncate text-[11px] leading-tight font-medium text-gelo/50">
                      {assinada
                        ? "Este aparelho já recebe os avisos"
                        : "Aviso quando seu número for chamado"}
                    </span>
                  </span>
                </button>
                <div className="my-1 h-px bg-white/[.08]" />
                <Link
                  href="/admin"
                  role="menuitem"
                  onClick={fechar}
                  className={item}
                >
                  <ShieldCheck size={16} className="shrink-0 text-gelo/50" />
                  Painel de administração
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
