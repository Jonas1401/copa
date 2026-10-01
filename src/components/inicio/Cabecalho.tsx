"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import type { Icone } from "@/lib/tempo";
import { IconeLinha } from "@/components/tempo/IconeTempo";
import { LOGO } from "@/lib/logo";

type Agora = { temperatura: number; descricao: string; icone: Icone };

/** Chip do clima: mesma previsão da tela de tempo (APPA/SIMPORT). Toque abre a tela. */
function ChipClima() {
  const [agora, setAgora] = useState<Agora | null>(null);

  useEffect(() => {
    let vivo = true;
    const buscar = () =>
      fetch("/api/tempo", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => vivo && d?.agora && setAgora(d.agora))
        .catch(() => {});
    void buscar();
    const t = setInterval(buscar, 10 * 60 * 1000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  return (
    <Link
      href="/tempo"
      aria-label="Abrir a previsão do tempo"
      className="flex h-12 shrink-0 items-center gap-1.5 rounded-full border border-[#2a5bb0]/70 bg-[#0b2152]/80 pr-3 pl-2.5 transition-colors hover:border-ciano/70 sm:h-[54px] sm:gap-2 sm:pr-4 sm:pl-3"
    >
      <IconeLinha icone={agora?.icone ?? "nuvem"} tamanho={24} />
      <div className="leading-none">
        <div className="tabular text-right font-display text-[18px] font-bold text-white sm:text-[20px]">
          {agora ? `${agora.temperatura}°` : "—°"}
        </div>
        <div className="mt-1 text-right text-[12px] font-medium whitespace-nowrap text-gelo/90">
          {agora ? agora.descricao : "Paranaguá"}
        </div>
      </div>
    </Link>
  );
}

export default function Cabecalho({
  nome,
  onCompartilhar,
}: {
  /** Primeiro nome do motorista ("Mestre" só existe na tela de boas-vindas). */
  nome?: string | null;
  onCompartilhar: () => void;
}) {
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <img
          src={LOGO.src}
          alt="CopaLinks"
          width={LOGO.largura}
          height={LOGO.altura}
          className="h-[50px] w-auto max-w-[46vw] shrink-0 object-contain sm:h-[60px]"
        />
        <h1 className="order-last w-full min-w-0 font-display text-[clamp(22px,6.6vw,26px)] leading-tight font-extrabold text-white [overflow-wrap:anywhere] min-[460px]:order-none min-[460px]:w-auto min-[460px]:flex-1 min-[460px]:text-center min-[460px]:text-[24px]">
          {nome ? (
            <>
              Olá,{" "}
              <span className="text-[#3a9dff] drop-shadow-[0_0_18px_rgba(58,157,255,0.45)]">
                {nome}!
              </span>
            </>
          ) : (
            "Olá!"
          )}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onCompartilhar}
          aria-label="Compartilhar o aplicativo"
          title="Compartilhar"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#2a5bb0]/70 bg-[#0b2152]/80 text-white transition-colors hover:border-ciano/70 hover:text-ciano sm:h-[54px] sm:w-[54px]"
        >
          <Share2 size={22} strokeWidth={1.9} />
        </button>
        <ChipClima />
        </div>
      </header>

    </>
  );
}
