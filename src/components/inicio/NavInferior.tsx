"use client";

import Link from "next/link";
import { House, MessagesSquare, Ship } from "lucide-react";

export type Aba = "inicio" | "sobre";

/**
 * Rodapé de navegação do app. É uma faixa estreita de propósito: ícones de
 * 22 px, rótulos de 12,5 px e o botão do chat de 48 px, para sobrar tela ao
 * conteúdo (o cartão do número continua inteiro acima dela).
 *
 * O terceiro item é o acesso ao COPALINKS de navios: ícone e nome de NAVIO,
 * e o selo numérico mostra a quantidade de navios de fertilizantes ATRACADOS.
 * Quando não há nenhum (ou enquanto a leitura não chegou), o selo mostra 0 —
 * nunca fica escondido. Um toque abre a cópia idêntica em /navios.
 * A antiga aba "Sobre" continua disponível pelo menu ⋮ do topo.
 */
export default function NavInferior({
  aba,
  onTrocar,
  naviosAtracados = 0,
  onChat,
  naoLidas,
}: {
  aba: Aba;
  onTrocar: (a: Aba) => void;
  /** Quantidade de navios de fertilizantes atracados (0 quando não há). */
  naviosAtracados?: number;
  /** Abre o chat dos motoristas (botão do meio). */
  onChat: () => void;
  /** Mensagens novas no chat desde a última vez que o motorista abriu. */
  naoLidas?: number;
}) {
  const total = Number.isFinite(naviosAtracados) ? Math.max(0, Math.trunc(naviosAtracados)) : 0;
  const selo = total > 99 ? "99+" : String(total);
  const ativoInicio = aba === "inicio";

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#183341]/60 bg-[#071A28]/95 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="largura-aparelho grid grid-cols-3 items-center gap-2 px-3 py-1.5">
        {/* ---------------------------------------------------------- Início */}
        <button
          type="button"
          onClick={() => onTrocar("inicio")}
          aria-current={ativoInicio ? "page" : undefined}
          className={`flex flex-col items-center justify-center gap-0.5 rounded-[18px] border-2 border-transparent py-1 transition-colors ${
            ativoInicio ? "text-ouro" : "text-aco hover:border-ciano/50 hover:text-gelo"
          }`}
        >
          <House size={22} strokeWidth={2} />
          <span className="text-[12.5px] leading-tight font-semibold">Início</span>
          <span aria-hidden className="h-[2.5px] w-8 rounded-full bg-transparent" />
        </button>

        {/* ------------------------------------------------------------ Chat */}
        <button
          type="button"
          onClick={onChat}
          aria-label={naoLidas ? `Abrir o chat · ${naoLidas} mensagens novas` : "Abrir o chat dos motoristas"}
          className="group flex flex-col items-center justify-center gap-0.5 py-0.5"
        >
          <span className="relative -mt-5 grid h-[48px] w-[48px] place-items-center rounded-full border-[3px] border-[#071A28] bg-ambar text-[#000D16] shadow-[0_8px_22px_-8px_rgba(255, 184, 46, 0.9)] transition-transform group-active:scale-95">
            <MessagesSquare size={21} strokeWidth={2.4} />
            {Boolean(naoLidas) && (
              <span aria-hidden className="tabular absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-[#183341] bg-red-500 px-1 font-display text-[10px] leading-none font-extrabold text-white">
                {(naoLidas ?? 0) > 99 ? "99+" : naoLidas}
              </span>
            )}
          </span>
          <span className="text-[11.5px] leading-tight font-semibold text-ouro">Chat</span>
        </button>

        {/* -------------------------------------------------- Navios (cópia) */}
        <Link
          href="/navios"
          aria-label={`Navios · ${total} ${total === 1 ? "navio atracado" : "navios atracados"}`}
          title="Navios de fertilizantes atracados — abrir o COPALINKS"
          className="flex flex-col items-center justify-center gap-0.5 rounded-[18px] border-2 border-transparent py-1 text-aco transition-colors hover:border-ciano/50 hover:text-gelo"
        >
          <span className="relative">
            <Ship size={22} strokeWidth={2} />
            {/* numeração: quantidade de navios atracados; 0 quando não há */}
            <span
              aria-hidden
              className="tabular absolute -top-1.5 left-[14px] grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-borda bg-ciano px-1 font-display text-[10px] leading-none font-extrabold text-fundo"
            >
              {selo}
            </span>
          </span>
          <span className="text-[12.5px] leading-tight font-semibold">Navios</span>
          <span aria-hidden className="h-[2.5px] w-8 rounded-full bg-transparent" />
        </Link>
      </div>
    </nav>
  );
}
