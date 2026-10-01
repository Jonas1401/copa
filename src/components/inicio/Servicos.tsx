"use client";

import { useState } from "react";
import {
  Calculator,
  ChevronRight,
  FileText,
  LayoutGrid,
  Lock,
  Phone,
  ScrollText,
  ShieldCheck,
  Ship,
} from "lucide-react";
import {
  SERVICOS,
  type CorServico,
  type IconeServico,
  type Servico,
} from "@/lib/servicos";

const ICONES: Record<IconeServico, typeof Lock> = {
  cadeado: Lock,
  documento: ScrollText,
  ficha: FileText,
  calculadora: Calculator,
  telefone: Phone,
  escudo: ShieldCheck,
  navio: Ship,
};

const CORES: Record<CorServico, { cartao: string; icone: string }> = {
  laranja: {
    cartao:
      "border-[#d9822b] bg-[linear-gradient(135deg,#5b3414_0%,#3a2519_55%,#231c24_100%)]",
    icone: "bg-[#e8892d] shadow-[0_0_22px_-4px_rgba(232,137,45,0.8)]",
  },
  roxo: {
    cartao:
      "border-[#9b4dff] bg-[linear-gradient(135deg,#40207a_0%,#2d1a5c_55%,#1f1846_100%)]",
    icone: "bg-[#8b3dff] shadow-[0_0_22px_-4px_rgba(139,61,255,0.8)]",
  },
  verde: {
    cartao:
      "border-[#1fbf6a] bg-[linear-gradient(135deg,#0f4b33_0%,#0d3830_55%,#0b2630_100%)]",
    icone: "bg-[#22c06d] shadow-[0_0_22px_-4px_rgba(34,192,109,0.8)]",
  },
  azul: {
    cartao:
      "border-[#2f7fe0] bg-[linear-gradient(135deg,#153f80_0%,#10316a_55%,#0c2454_100%)]",
    icone: "bg-[#2f8cf0] shadow-[0_0_22px_-4px_rgba(47,140,240,0.8)]",
  },
  vermelho: {
    cartao:
      "border-[#e0334d] bg-[linear-gradient(135deg,#5a1a2d_0%,#421830_55%,#2a1528_100%)]",
    icone: "bg-[#e63950] shadow-[0_0_22px_-4px_rgba(230,57,80,0.8)]",
  },
  turquesa: {
    cartao:
      "border-[#1ba3b8] bg-[linear-gradient(135deg,#0f5166_0%,#0d3e56_55%,#0b2c45_100%)]",
    icone: "bg-[#1aa6b8] shadow-[0_0_22px_-4px_rgba(26,166,184,0.8)]",
  },
  indigo: {
    cartao:
      "border-[#5b6cf0] bg-[linear-gradient(135deg,#232f7a_0%,#1b2560_55%,#141c48_100%)]",
    icone: "bg-[#5b6cf0] shadow-[0_0_22px_-4px_rgba(91,108,240,0.8)]",
  },
};

function CartaoServico({
  s,
  largo = false,
  onSemLink,
}: {
  s: Servico;
  largo?: boolean;
  onSemLink: (s: Servico) => void;
}) {
  const Icone = ICONES[s.icone];
  const cor = CORES[s.cor];
  const externo = /^https?:\/\//i.test(s.href);
  const classe = `group relative flex min-h-[132px] min-w-0 flex-col overflow-hidden rounded-[20px] border-[1.5px] p-3.5 text-left transition-transform active:scale-[0.98] ${largo ? "col-span-2" : ""} ${cor.cartao}`;

  const conteudo = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-white ${cor.icone}`}>
          <Icone size={21} strokeWidth={2.2} />
        </span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-[1.5px] border-white/70 text-white transition-colors group-hover:bg-white/10">
          <ChevronRight size={17} strokeWidth={2.4} />
        </span>
      </span>
      <span className="mt-auto block pt-3 font-display text-[clamp(15px,4.3vw,17px)] leading-tight font-extrabold text-white [overflow-wrap:anywhere]">
        {s.titulo}
      </span>
      <span className="mt-1 block text-[13px] leading-snug text-gelo/80">{s.subtitulo}</span>
    </>
  );

  if (!s.href) {
    return (
      <button type="button" onClick={() => onSemLink(s)} className={classe}>
        {conteudo}
      </button>
    );
  }
  return (
    <a
      href={s.href}
      className={classe}
      {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {conteudo}
    </a>
  );
}

export default function Servicos({
  onSemLink,
}: {
  onSemLink: (s: Servico) => void;
}) {
  // Como na referência: uma linha de cards e o "Ver todos" para revelar o resto.
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const visiveis = mostrarTodos ? SERVICOS : SERVICOS.slice(0, 2);
  const temMais = SERVICOS.length > 2;
  return (
    <section className="rounded-[26px] border border-[#1d4690]/60 bg-[#0a1c42]/70 p-4">
      <header className="mb-4 flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-3 font-display text-[22px] font-extrabold tracking-[0.02em] text-white uppercase">
          <LayoutGrid size={26} strokeWidth={2.2} className="text-gelo" />
          Serviços
        </h2>
        {temMais && (
          <button
            type="button"
            onClick={() => setMostrarTodos((v) => !v)}
            aria-expanded={mostrarTodos}
            title={mostrarTodos ? "Mostrar menos serviços" : "Mostrar todos os serviços"}
            className="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-1.5 font-display text-[15px] font-bold text-white transition-colors hover:text-ciano"
          >
            {mostrarTodos ? "Ver menos" : "Ver todos"}
            <ChevronRight
              size={19}
              strokeWidth={2.4}
              className={`transition-transform ${mostrarTodos ? "rotate-90" : ""}`}
            />
          </button>
        )}
      </header>
      <div className="grid grid-cols-2 gap-2.5 min-[400px]:gap-3">
        {visiveis.map((s, i) => (
          <CartaoServico
            key={s.id}
            s={s}
            // número ímpar de cards: o último ocupa a linha inteira
            largo={visiveis.length % 2 === 1 && i === visiveis.length - 1}
            onSemLink={onSemLink}
          />
        ))}
      </div>
    </section>
  );
}
