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
      title="Previsão do tempo"
      className="group flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/20 pr-2.5 pl-2 text-gelo/65 backdrop-blur-[2px] transition-colors hover:border-white/25 hover:bg-black/40 hover:text-white sm:h-12 sm:pr-3"
    >
      <IconeLinha icone={agora?.icone ?? "nuvem"} tamanho={17} className="opacity-80 transition-opacity group-hover:opacity-100" />
      <span className="tabular font-display text-[14px] leading-none font-bold">
        {agora ? `${agora.temperatura}°` : "—°"}
      </span>
      <span className="hidden text-[12px] leading-none font-medium whitespace-nowrap opacity-70 min-[420px]:inline">
        {agora ? agora.descricao : "Paranaguá"}
      </span>
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
        <h1 className="order-last w-full min-w-0 font-display text-[clamp(22px,6.6vw,26px)] leading-tight font-extrabold text-white drop-shadow-[0_2px_12px_rgba(0,10,30,0.75)] [overflow-wrap:anywhere] min-[460px]:order-none min-[460px]:w-auto min-[460px]:flex-1 min-[460px]:text-center min-[460px]:text-[24px]">
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
        {/* controles discretos no canto: ícones pequenos, quase sem "caixa",
            para não brigar com a foto do caminhão. Ganhos de toque mantidos
            em 44 px (acessibilidade). */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCompartilhar}
            aria-label="Compartilhar o aplicativo"
            title="Compartilhar"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-black/20 text-gelo/65 backdrop-blur-[2px] transition-colors hover:border-white/25 hover:bg-black/40 hover:text-white sm:h-12 sm:w-12"
          >
            <Share2 size={17} strokeWidth={1.8} />
          </button>
          <ChipClima />
        </div>
      </header>

    </>
  );
}
