"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Titulo } from "@/lib/copaflix/tipos";
import Cartaz from "./Cartaz";

/**
 * Faixa horizontal de capas — a mesma ideia dos carrosséis das plataformas de
 * streaming, com rolagem por toque, roda do mouse, teclado e setas no desktop.
 */
export default function Fileira({
  id,
  titulo,
  itens,
}: {
  id: string;
  titulo: string;
  itens: Titulo[];
}) {
  const trilho = useRef<HTMLDivElement>(null);

  if (!itens.length) return null;

  function rolar(direcao: 1 | -1) {
    const el = trilho.current;
    if (!el) return;
    el.scrollBy({ left: direcao * Math.max(240, el.clientWidth * 0.82), behavior: "smooth" });
  }

  return (
    <section aria-labelledby={`fileira-${id}`} className="cf-ancora">
      <header className="mb-2.5 flex items-end justify-between gap-3">
        <h2
          id={`fileira-${id}`}
          className="font-display text-[clamp(15px,3.6vw,19px)] leading-tight font-extrabold tracking-tight text-gelo"
        >
          {titulo}
          <span aria-hidden className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-ciano align-middle" />
        </h2>
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <button
            type="button"
            aria-label={`Rolar ${titulo} para a esquerda`}
            onClick={() => rolar(-1)}
            className="grid h-8 w-8 place-items-center rounded-full border border-borda/90 bg-cartao text-aco transition-colors hover:border-ciano/60 hover:text-gelo"
          >
            <ChevronLeft size={16} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            aria-label={`Rolar ${titulo} para a direita`}
            onClick={() => rolar(1)}
            className="grid h-8 w-8 place-items-center rounded-full border border-borda/90 bg-cartao text-aco transition-colors hover:border-ciano/60 hover:text-gelo"
          >
            <ChevronRight size={16} strokeWidth={2.4} />
          </button>
        </div>
      </header>

      <div className="cf-fileira-caixa">
        <div
          ref={trilho}
          className="cf-fileira"
          role="list"
          tabIndex={0}
          aria-label={`${titulo} — use as setas do teclado para navegar`}
          onKeyDown={(evento) => {
            if (evento.key === "ArrowRight") {
              evento.preventDefault();
              rolar(1);
            } else if (evento.key === "ArrowLeft") {
              evento.preventDefault();
              rolar(-1);
            }
          }}
        >
          {itens.map((tituloItem) => (
            <div role="listitem" key={tituloItem.id}>
              <Cartaz titulo={tituloItem} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
