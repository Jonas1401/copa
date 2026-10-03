"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: ReactNode;
  icon?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  uppercase?: boolean;
  aberto?: boolean;
  onAbertoChange?: (aberto: boolean) => void;
};

/** Card do painel que começa fechado e revela seus detalhes ao ser acionado. */
export default function CartaoExpansivelAdmin({
  title,
  icon,
  summary,
  children,
  className = "mt-4 rounded-[22px] border border-[#2a5bb0]/60 bg-[#08183a]/90 p-4",
  contentClassName = "mt-3",
  uppercase = true,
  aberto: abertoControlado,
  onAbertoChange,
}: Props) {
  const [abertoInterno, setAbertoInterno] = useState(false);
  const aberto = abertoControlado ?? abertoInterno;
  const conteudoId = useId();

  function alternar() {
    const proximo = !aberto;
    if (abertoControlado === undefined) setAbertoInterno(proximo);
    onAbertoChange?.(proximo);
  }

  return (
    <section className={className}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        aria-controls={conteudoId}
        className="group flex w-full items-center justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ciano/70"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span
              role="heading"
              aria-level={2}
              className={`block font-display text-[17px] font-bold tracking-[0.03em] text-white ${uppercase ? "uppercase" : ""}`}
            >
              {title}
            </span>
            {summary && (
              <span className="mt-0.5 block text-[12.5px] leading-snug text-gelo/65">
                {summary}
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-gelo/65 transition-colors group-hover:text-ciano">
          <span>{aberto ? "Fechar" : "Abrir"}</span>
          <ChevronDown size={17} className={`transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
        </span>
      </button>
      <div id={conteudoId} hidden={!aberto} className={contentClassName}>
        {children}
      </div>
    </section>
  );
}
