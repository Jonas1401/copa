"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw, WifiOff } from "lucide-react";

/**
 * Limite de erro do módulo: se algo inesperado acontecer na montagem do
 * acervo, a pessoa continua no CopaLinks e pode tentar de novo — não fica
 * presa numa tela quebrada.
 */
export default function CopaFlixErro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[copaflix] erro na tela:", error);
  return (
    <main className="copaflix grid min-h-dvh place-items-center px-4 py-10">
      <div className="cf-halo" aria-hidden />
      <div className="cf-card w-full max-w-[460px] p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ouro/12 text-ouro">
          <WifiOff size={22} />
        </span>
        <h1 className="mt-3 font-display text-[20px] font-extrabold text-gelo">
          O CopaFlix não conseguiu abrir agora
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-aco">
          Pode ser a conexão com uma fonte autorizada (Jellyfin, lista M3U ou TMDB). O restante do
          CopaLinks continua funcionando normalmente.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="cf-botao-ouro !min-h-[42px]">
            <RotateCcw size={15} /> Tentar de novo
          </button>
          <Link href="/" className="cf-botao-fantasma !min-h-[42px]">
            <ArrowLeft size={15} /> Voltar ao CopaLinks
          </Link>
        </div>
      </div>
    </main>
  );
}
