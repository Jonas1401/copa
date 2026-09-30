"use client";

import { House, Info, MessagesSquare } from "lucide-react";

export type Aba = "inicio" | "sobre";

const ITENS: { id: Aba; rotulo: string; Icone: typeof House }[] = [
  { id: "inicio", rotulo: "Início", Icone: House },
  { id: "sobre", rotulo: "Sobre", Icone: Info },
];

export default function NavInferior({
  aba,
  onTrocar,
  totalMotoristas,
  onChat,
  naoLidas,
}: {
  aba: Aba;
  onTrocar: (a: Aba) => void;
  /** Abre o chat dos motoristas (botão do meio). */
  onChat: () => void;
  /** Mensagens novas no chat desde a última vez que o motorista abriu. */
  naoLidas?: number;
  /** Contagem de motoristas mostrada no ícone "Sobre". */
  totalMotoristas?: number | null;
}) {
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#1d4690]/60 bg-[#06122b]/95 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-[390px] grid-cols-3 items-center gap-2 px-3 py-2.5">
        {ITENS.map(({ id, rotulo, Icone }, i) => {
          const ativo = aba === id;
          const botao = (
            <button
              key={id}
              type="button"
              onClick={() => onTrocar(id)}
              aria-current={ativo ? "page" : undefined}
              aria-label={
                id === "sobre" && totalMotoristas
                  ? `${rotulo} · ${totalMotoristas} motorista${totalMotoristas === 1 ? "" : "s"}`
                  : undefined
              }
              className={`flex flex-col items-center justify-center gap-1 rounded-[22px] border-2 py-2 transition-colors ${
                ativo
                  ? "border-ouro bg-ouro/5 text-ouro"
                  : "border-transparent text-aco hover:text-gelo"
              }`}
            >
              <span className="relative">
                <Icone
                  size={27}
                  strokeWidth={2}
                  className={ativo ? "fill-ouro/90 text-ouro" : ""}
                />
                {id === "sobre" && Boolean(totalMotoristas) && (
                  <span
                    aria-hidden
                    className="tabular absolute -top-2 left-[18px] grid h-[22px] min-w-[22px] place-items-center rounded-full border-2 border-[#06122b] bg-[#2f8cf0] px-1.5 font-display text-[12px] leading-none font-extrabold text-white"
                  >
                    {(totalMotoristas ?? 0) > 99 ? "99+" : totalMotoristas}
                  </span>
                )}
              </span>
              <span className="text-[15px] font-semibold">{rotulo}</span>
            </button>
          );
          if (i !== 0) return botao;
          return [
            botao,
            <button
              key="chat"
              type="button"
              onClick={onChat}
              aria-label={naoLidas ? `Abrir o chat · ${naoLidas} mensagens novas` : "Abrir o chat dos motoristas"}
              className="group flex flex-col items-center justify-center gap-1 py-1"
            >
              <span className="relative -mt-7 grid h-[62px] w-[62px] place-items-center rounded-full border-4 border-[#06122b] bg-[linear-gradient(135deg,#ffd84d,#e9a400)] text-[#2a1a00] shadow-[0_10px_28px_-8px_rgba(245,197,24,0.9)] transition-transform group-active:scale-95">
                <MessagesSquare size={26} strokeWidth={2.4} />
                {Boolean(naoLidas) && (
                  <span aria-hidden className="tabular absolute -top-1 -right-1 grid h-[22px] min-w-[22px] place-items-center rounded-full border-2 border-[#06122b] bg-red-500 px-1.5 font-display text-[12px] leading-none font-extrabold text-white">
                    {(naoLidas ?? 0) > 99 ? "99+" : naoLidas}
                  </span>
                )}
              </span>
              <span className="text-[13px] font-semibold text-ouro">Chat</span>
            </button>,
          ];
        })}
      </div>
    </nav>
  );
}
