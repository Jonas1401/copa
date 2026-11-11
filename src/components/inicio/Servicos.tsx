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
import type { CartaoDoTicket } from "@/lib/ticket-card";

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
      "border-[#183341] bg-[#071A28]",
    icone: "bg-[#FFB82E] shadow-[0_0_22px_-4px_rgba(255, 184, 46, 0.8)]",
  },
  roxo: {
    cartao:
      "border-[#183341] bg-[#071A28]",
    icone: "bg-[#00B8BC] shadow-[0_0_22px_-4px_rgba(0, 184, 188, 0.8)]",
  },
  verde: {
    cartao:
      "border-[#183341] bg-[#071A28]",
    icone: "bg-[#00C853] shadow-[0_0_22px_-4px_rgba(0, 200, 83, 0.8)]",
  },
  azul: {
    cartao:
      "border-[#183341] bg-[#071A28]",
    icone: "bg-[#00B8BC] shadow-[0_0_22px_-4px_rgba(0, 184, 188, 0.8)]",
  },
  vermelho: {
    cartao:
      "border-[#183341] bg-[#071A28]",
    icone: "bg-[#FFB82E] shadow-[0_0_22px_-4px_rgba(255, 184, 46, 0.8)]",
  },
  turquesa: {
    cartao:
      "border-[#183341] bg-[#071A28]",
    icone: "bg-[#00B8BC] shadow-[0_0_22px_-4px_rgba(0, 184, 188, 0.8)]",
  },
  indigo: {
    cartao:
      "border-[#183341] bg-[#071A28]",
    icone: "bg-[#00B8BC] shadow-[0_0_22px_-4px_rgba(0, 184, 188, 0.8)]",
  },
};

/**
 * Card “Saldo de Ganhos” com leitura: só três números — viagens, valor bruto
 * e comissão da semana, somando todos os pontos do motorista — e, quando a
 * leitura é antiga ou parcial, uma linha miúda dizendo isso. Enquanto falta a
 * porcentagem de algum ponto, a comissão dá lugar a “Falta %” (em âmbar).
 */
function NumerosDoTicket({ c }: { c: Extract<CartaoDoTicket, { modo: "numeros" }> }) {
  // Dinheiro nunca é cortado com “…”: quando o valor não cabe ao lado do
  // rótulo (card estreito, valor grande), ele desce inteiro para a linha de baixo.
  const linha = "flex flex-wrap items-baseline justify-between gap-x-2";
  const rotulo = "shrink-0 text-[12.5px] text-gelo/75";
  const valor = `tabular ml-auto font-display text-[14px] leading-tight font-extrabold whitespace-nowrap ${c.velho ? "opacity-70" : ""}`;
  return (
    <span className="mt-1.5 block space-y-0.5" data-ticket="numeros">
      <span className={linha}>
        <span className={rotulo}>Viagens</span>
        <span className={`${valor} text-white`}>{c.viagens}</span>
      </span>
      <span className={linha}>
        <span className={rotulo}>Bruto</span>
        <span className={`${valor} text-white`}>{c.bruto}</span>
      </span>
      <span className={linha}>
        <span className={rotulo}>Comissão</span>
        <span className={`${valor} ${c.faltaPorcentagem ? "text-ambar" : "text-ouro"}`}>{c.comissao}</span>
      </span>
      {c.nota && <span className={`block pt-0.5 text-[11px] leading-tight ${c.velho || c.faltaPorcentagem ? "text-ambar" : "text-gelo/65"}`}>{c.nota}</span>}
    </span>
  );
}

function CartaoServico({
  s,
  largo = false,
  onSemLink,
  ticket,
}: {
  s: Servico;
  largo?: boolean;
  onSemLink: (s: Servico) => void;
  /** Só no card “Saldo de Ganhos”: o que a leitura do Ticket trouxe. */
  ticket?: CartaoDoTicket | null;
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
      {ticket?.modo === "numeros" ? (
        <NumerosDoTicket c={ticket} />
      ) : (
        <span className="mt-1 block text-[13px] leading-snug text-gelo/80">{ticket?.modo === "texto" ? ticket.texto : s.subtitulo}</span>
      )}
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
  ticket = null,
}: {
  onSemLink: (s: Servico) => void;
  /**
   * O que o card “Saldo de Ganhos” mostra para o motorista com cadastro neste
   * aparelho: o que o servidor leu na aba “Ticket” do portal. Quem consulta é a
   * tela inicial, UMA vez só: o mesmo resumo alimenta este card e o “Você vai
   * receber” do cartão do número. null = visitante, ou ainda sem resposta.
   */
  ticket?: CartaoDoTicket | null;
}) {
  // Como na referência: uma linha de cards e o "Ver todos" para revelar o resto.
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const visiveis = mostrarTodos ? SERVICOS : SERVICOS.slice(0, 2);
  const temMais = SERVICOS.length > 2;
  return (
    <section className="rounded-[26px] border border-[#183341]/60 bg-[#071A28]/70 p-4">
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
            ticket={s.id === "consulta-ponto" ? ticket : undefined}
          />
        ))}
      </div>
    </section>
  );
}
