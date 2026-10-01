"use client";

import { House, Info, MessagesSquare } from "lucide-react";

export type Aba = "inicio" | "sobre";

const ITENS: { id: Aba; rotulo: string; Icone: typeof House }[] = [
  { id: "inicio", rotulo: "Início", Icone: House },
  { id: "sobre", rotulo: "Sobre", Icone: Info },
];

/**
 * Rodapé de navegação do app. É uma faixa estreita de propósito: ícones de
 * 22 px, rótulos de 12,5 px e o botão do chat de 48 px, para sobrar tela ao
 * conteúdo (o cartão do número continua inteiro acima dela).
 */
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
      <div className="largura-aparelho grid grid-cols-3 items-center gap-2 px-3 py-1.5">
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
              className={`flex flex-col items-center justify-center gap-0.5 rounded-[18px] border-2 border-transparent py-1 transition-colors ${
                ativo ? "text-ouro" : "text-aco hover:text-gelo"
              }`}
            >
              <span className="relative">
                <Icone
                  size={22}
                  strokeWidth={2}
                  className={ativo ? "fill-ouro/90 text-ouro" : ""}
                />
                {id === "sobre" && Boolean(totalMotoristas) && (
                  <span
                    aria-hidden
                    className="tabular absolute -top-1.5 left-[14px] grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-[#06122b] bg-[#2f8cf0] px-1 font-display text-[10px] leading-none font-extrabold text-white"
                  >
                    {(totalMotoristas ?? 0) > 99 ? "99+" : totalMotoristas}
                  </span>
                )}
              </span>
              <span className="text-[12.5px] leading-tight font-semibold">{rotulo}</span>
              {/* traço dourado embaixo do item ativo (como na referência) */}
              <span
                aria-hidden
                className={`h-[2.5px] w-8 rounded-full transition-colors ${
                  ativo ? "bg-ouro shadow-[0_0_10px_rgba(245,197,24,0.85)]" : "bg-transparent"
                }`}
              />
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
              className="group flex flex-col items-center justify-center gap-0.5 py-0.5"
            >
              <span className="relative -mt-5 grid h-[48px] w-[48px] place-items-center rounded-full border-[3px] border-[#06122b] bg-[linear-gradient(135deg,#ffd84d,#e9a400)] text-[#2a1a00] shadow-[0_8px_22px_-8px_rgba(245,197,24,0.9)] transition-transform group-active:scale-95">
                <MessagesSquare size={21} strokeWidth={2.4} />
                {Boolean(naoLidas) && (
                  <span aria-hidden className="tabular absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-[#06122b] bg-red-500 px-1 font-display text-[10px] leading-none font-extrabold text-white">
                    {(naoLidas ?? 0) > 99 ? "99+" : naoLidas}
                  </span>
                )}
              </span>
              <span className="text-[11.5px] leading-tight font-semibold text-ouro">Chat</span>
            </button>,
          ];
        })}
      </div>
    </nav>
  );
}
