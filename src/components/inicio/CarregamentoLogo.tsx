"use client";

import { useEffect, useRef, useState } from "react";
import { Truck } from "lucide-react";
import { LOGO } from "@/lib/logo";
import {
  TEMPO_SAIDA_MS,
  deveSair,
  fraseDaVez,
  progressoCarregamento,
} from "@/lib/carregamento";

/**
 * Tela de carregamento do CopaLinks: a logo com brilho passando, ondas de
 * radar (o app "monitora" a fila) e uma estrada onde um caminhãozinho anda
 * conforme o app carrega. Some sozinha quando o app fica pronto.
 *
 * Já vem desenhada do servidor (cobre a tela desde o primeiro instante) e
 * tem uma trava só em CSS: mesmo sem JavaScript, some depois de 12 s.
 */
export default function CarregamentoLogo({ pronto, onTerminar }: { pronto: boolean; onTerminar: () => void }) {
  const [decorrido, setDecorrido] = useState(0);
  const [saindo, setSaindo] = useState(false);
  const inicio = useRef<number | null>(null);
  const prontoRef = useRef(pronto);
  const fim = useRef(onTerminar);
  useEffect(() => {
    prontoRef.current = pronto;
    fim.current = onTerminar;
  }, [pronto, onTerminar]);

  // Limpa o vídeo da vinheta antiga guardado no aparelho (ocupava espaço).
  useEffect(() => {
    try {
      localStorage.removeItem("copalinks_vinheta_video");
      localStorage.removeItem("copalinks-vinheta-vista");
    } catch {
      /* sem armazenamento: nada a limpar */
    }
  }, []);

  useEffect(() => {
    if (inicio.current === null) inicio.current = performance.now();
    let saiu = false;
    const t = setInterval(() => {
      const d = performance.now() - (inicio.current ?? 0);
      setDecorrido(d);
      if (!saiu && deveSair(d, prontoRef.current)) {
        saiu = true;
        setSaindo(true);
        clearInterval(t);
        setTimeout(() => fim.current(), TEMPO_SAIDA_MS);
      }
    }, 90);
    return () => clearInterval(t);
  }, []);

  const progresso = saindo ? 1 : progressoCarregamento(decorrido, pronto);
  const frase = saindo ? "Pronto!" : fraseDaVez(decorrido, pronto);
  const mascara = `url("${LOGO.src}")`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Abrindo o CopaLinks · ${frase}`}
      className={`carga-tela fixed inset-0 z-[95] flex flex-col items-center justify-center overflow-hidden px-6 transition-[opacity,transform] duration-500 ease-out ${
        saindo ? "pointer-events-none scale-[1.04] opacity-0" : "opacity-100"
      }`}
      style={{ background: "radial-gradient(110% 65% at 50% 42%, #00479e 0%, #002b6b 54%, #000d28 100%)" }}
    >
      {/* grade suave do pátio ao fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(127,182,240,1) 1px, transparent 1px), linear-gradient(90deg, rgba(127,182,240,1) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(60% 50% at 50% 45%, black, transparent)",
          WebkitMaskImage: "radial-gradient(60% 50% at 50% 45%, black, transparent)",
        }}
      />

      {/* logo + radar */}
      <div className="relative grid w-[min(300px,74vw)] place-items-center">
        <span aria-hidden className="carga-radar absolute aspect-square w-[78%] rounded-full border border-ciano/50" />
        <span aria-hidden className="carga-radar carga-radar-2 absolute aspect-square w-[78%] rounded-full border border-ciano/40" />
        <span aria-hidden className="carga-halo absolute aspect-square w-[95%] rounded-full" />

        <div className="carga-logo relative w-full" style={{ aspectRatio: `${LOGO.largura} / ${LOGO.altura}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO.src}
            alt="CopaLinks"
            width={LOGO.largura}
            height={LOGO.altura}
            fetchPriority="high"
            decoding="async"
            draggable={false}
            className="h-full w-full select-none drop-shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
          />
          {/* brilho que atravessa só a logo */}
          <span
            aria-hidden
            className="carga-brilho pointer-events-none absolute inset-0 overflow-hidden"
            style={{
              maskImage: mascara,
              WebkitMaskImage: mascara,
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskPosition: "center",
            }}
          />
        </div>
      </div>

      {/* estrada com o caminhãozinho */}
      <div className="relative mt-10 w-[min(280px,72vw)]" aria-hidden>
        <div className="relative h-[6px] overflow-hidden rounded-full bg-white/[0.08]">
          <div className="carga-faixa absolute inset-y-[2.5px] left-0 right-0" />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ouro via-[#ffd95a] to-ciano shadow-[0_0_14px_rgba(111,231,223,0.7)] transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(progresso * 100)}%` }}
          />
        </div>
        <div
          className="absolute -top-[26px] transition-[left] duration-300 ease-out"
          style={{ left: `calc(${progresso * 100}% - 13px)` }}
        >
          <Truck size={26} strokeWidth={2.2} className="carga-caminhao text-ouro drop-shadow-[0_0_8px_rgba(245,197,24,0.75)]" />
        </div>
      </div>

      <p className="mt-5 h-5 text-center font-display text-[14px] font-semibold tracking-[0.04em] text-gelo/80">
        <span key={frase} className="carga-frase inline-block">{frase}</span>
      </p>
    </div>
  );
}
