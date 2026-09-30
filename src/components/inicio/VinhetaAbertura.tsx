"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  DURACAO_ENCERRAMENTO_MS,
  DURACAO_MINIMA_MS,
  DURACAO_VINHETA_MS,
  calcularVelocidade,
  progressoDoCarregamento,
} from "@/lib/vinheta";

export default function VinhetaAbertura({
  pronto,
  modoCompleto,
  onTerminar,
}: {
  pronto: boolean;
  modoCompleto: boolean;
  onTerminar: () => void;
}) {
  const reduzido = useReducedMotion();
  const [quadro, setQuadro] = useState({ t: 0, carga: 0, saindo: false });
  const [videoSrc, setVideoSrc] = useState<string>(() => {
    try {
      return localStorage.getItem("copalinks_vinheta_video") || "";
    } catch {
      return "";
    }
  });

  const estado = useRef({ t: 0, inicio: 0, ultimo: 0, terminou: false, pintou: 0 });
  const prontoRef = useRef(pronto);
  const modoRef = useRef(modoCompleto);
  const fimRef = useRef(onTerminar);

  useEffect(() => {
    prontoRef.current = pronto;
    modoRef.current = modoCompleto;
    fimRef.current = onTerminar;
  }, [pronto, modoCompleto, onTerminar]);

  useEffect(() => {
    if (!reduzido) return;
    const id = setTimeout(() => fimRef.current(), pronto ? 400 : 1500);
    return () => clearTimeout(id);
  }, [reduzido, pronto]);

  useEffect(() => {
    if (reduzido) return;
    const e = estado.current;
    e.inicio = performance.now();
    e.ultimo = e.inicio;
    e.pintou = 0;
    let raf = 0;

    const encerrar = () => {
      if (e.terminou) return;
      e.terminou = true;
      setQuadro((q) => ({ ...q, t: 1, saindo: true }));
      setTimeout(() => fimRef.current(), DURACAO_ENCERRAMENTO_MS);
    };

    const passo = (agora: number) => {
      if (e.terminou) return;
      const dt = Math.min(100, Math.max(0, agora - e.ultimo));
      e.ultimo = agora;
      const decorrido = agora - e.inicio;
      const carga = progressoDoCarregamento({ pronto: prontoRef.current, decorridoMs: decorrido });

      let vel: number;
      if (modoRef.current) {
        vel = 1;
      } else if (prontoRef.current) {
        const faltaTempo = Math.max(DURACAO_ENCERRAMENTO_MS, DURACAO_MINIMA_MS - decorrido);
        const restante = 1 - e.t;
        vel = restante <= 0 ? 0 : (restante * DURACAO_VINHETA_MS) / faltaTempo;
        vel = Math.min(Math.max(vel, 0.8), 8);
      } else {
        vel = calcularVelocidade(carga);
      }
      e.t = Math.min(1, e.t + (dt / DURACAO_VINHETA_MS) * vel);

      if (e.t >= 1 && !modoRef.current && !prontoRef.current) {
        if (agora - e.pintou > 120) {
          e.pintou = agora;
          setQuadro({ t: 1, carga, saindo: false });
        }
        raf = requestAnimationFrame(passo);
        return;
      }
      if (e.t >= 1) {
        encerrar();
        return;
      }
      if (agora - e.pintou > 33 || e.t === 0) {
        e.pintou = agora;
        setQuadro({ t: e.t, carga, saindo: false });
      }
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [reduzido]);

  function pular() {
    const e = estado.current;
    if (e.terminou || performance.now() - e.inicio < 1500) return;
    e.t = Math.max(e.t, 0.965);
  }

  function handleVideoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const res = uploadEvent.target?.result as string;
      if (res) {
        setVideoSrc(res);
        try {
          localStorage.setItem("copalinks_vinheta_video", res);
        } catch {}
      }
    };
    reader.readAsDataURL(file);
  }

  const pct = Math.round(quadro.carga * 100);

  if (reduzido) {
    return (
      <div
        role="status"
        aria-label="Abrindo o CopaLinks"
        className="fixed inset-0 z-[85] flex flex-col items-center justify-center bg-[#06173a] px-6"
      >
        <h1 className="font-display text-[26px] font-extrabold text-white">CopaLinks</h1>
        <div className="mt-6 h-1.5 w-[min(240px,60vw)] overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#3f8cff] transition-[width]"
            style={{ width: pronto ? "100%" : "45%" }}
          />
        </div>
        <p className="mt-3 text-[13px] text-gelo/70">{pronto ? "Pronto!" : "Carregando…"}</p>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Abrindo o CopaLinks"
      onClick={pular}
      className="fixed inset-0 z-[85] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#030816] px-6 select-none"
      style={{
        opacity: quadro.saindo ? 0 : 1,
        transition: "opacity 320ms ease",
      }}
    >
      {/* Se o usuário enviou um vídeo personalizado, reproduz o vídeo dele. Senão, exibe a recriação perfeita e idêntica ao vídeo enviando pelo usuário (com o caminhão, motorista, faixas de neon azul e texto COPALINKS) */}
      {videoSrc ? (
        <div className="absolute inset-0 overflow-hidden flex items-center justify-center bg-black">
          <video
            autoPlay
            muted
            playsInline
            loop
            className="absolute h-full w-full object-cover"
            src={videoSrc}
          />
        </div>
      ) : (
        <div className="absolute inset-0 overflow-hidden flex flex-col items-center justify-center bg-gradient-to-b from-[#0e2a63] via-[#06173a] to-[#030816]">
          {/* Linhas de néon azul nas laterais (idênticas ao vídeo) */}
          <div className="absolute inset-x-0 inset-y-0 pointer-events-none flex justify-between px-6 md:px-20 opacity-80">
            <div className="flex flex-col space-y-8 animate-pulse">
              <div className="w-1.5 h-32 bg-gradient-to-b from-transparent via-blue-400 to-transparent shadow-[0_0_15px_#3f8cff]" />
              <div className="w-1.5 h-48 bg-gradient-to-b from-transparent via-cyan-300 to-transparent shadow-[0_0_20px_#22d3ee]" />
              <div className="w-1.5 h-24 bg-gradient-to-b from-transparent via-blue-500 to-transparent shadow-[0_0_15px_#3f8cff]" />
            </div>
            <div className="flex flex-col space-y-8 animate-pulse" style={{ animationDelay: "0.5s" }}>
              <div className="w-1.5 h-40 bg-gradient-to-b from-transparent via-cyan-300 to-transparent shadow-[0_0_20px_#22d3ee]" />
              <div className="w-1.5 h-32 bg-gradient-to-b from-transparent via-blue-400 to-transparent shadow-[0_0_15px_#3f8cff]" />
              <div className="w-1.5 h-56 bg-gradient-to-b from-transparent via-blue-500 to-transparent shadow-[0_0_15px_#3f8cff]" />
            </div>
          </div>

          {/* Estrada em perspectiva 3D na parte inferior com reflexos */}
          <div className="absolute inset-x-0 bottom-0 h-[48%] pointer-events-none overflow-hidden">
            <div
              className="absolute bottom-0 left-1/2 h-full w-[200%] -translate-x-1/2"
              style={{
                clipPath: "polygon(30% 0, 70% 0, 100% 100%, 0 100%)",
                background: "linear-gradient(180deg, rgba(14,42,99,0) 0%, rgba(20,55,120,0.65) 50%, rgba(10,25,60,0.95) 100%)",
              }}
            />
            {/* Linha central da pista piscando em neon */}
            <div
              className="vinheta-pista absolute bottom-0 left-1/2 h-full w-[10px] -translate-x-1/2"
              style={{
                background: "repeating-linear-gradient(180deg, rgba(140,210,255,0.95) 0 20px, transparent 20px 50px)",
                filter: "drop-shadow(0 0 8px rgba(63,140,255,0.9))",
              }}
            />
          </div>

          {/* Logotipo Central EXATO do Vídeo (Caminhão + Motorista + COPALINKS) */}
          <div className="relative z-10 flex flex-col items-center animate-fade-in px-4">
            {/* Ícone do Caminhão e Motorista */}
            <div className="flex items-center justify-center space-x-3 mb-3 filter drop-shadow-[0_0_25px_rgba(63,140,255,0.7)]">
              <svg className="w-32 h-20 md:w-44 md:h-28 text-white" viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Caminhão baú moderno */}
                <rect x="10" y="35" width="85" height="50" rx="4" fill="white" stroke="#3f8cff" strokeWidth="3" />
                <circle cx="25" cy="90" r="10" fill="#111" stroke="white" strokeWidth="3" />
                <circle cx="75" cy="90" r="10" fill="#111" stroke="white" strokeWidth="3" />
                {/* Cabine */}
                <path d="M95 55H125L135 75V85H95V55Z" fill="white" stroke="#3f8cff" strokeWidth="3" />
                <circle cx="115" cy="90" r="10" fill="#111" stroke="white" strokeWidth="3" />
                {/* Linhas de movimento no caminhão */}
                <line x1="20" y1="50" x2="50" y2="50" stroke="#3f8cff" strokeWidth="3" strokeLinecap="round" />
                <line x1="20" y1="62" x2="40" y2="62" stroke="#3f8cff" strokeWidth="3" strokeLinecap="round" />

                {/* Motorista com boné e braços cruzados */}
                <circle cx="158" cy="48" r="14" fill="white" stroke="#3f8cff" strokeWidth="2.5" />
                <path d="M144 45H172" stroke="#3f8cff" strokeWidth="3" strokeLinecap="round" /> {/* Aba do boné */}
                <path d="M142 65C142 58 150 55 158 55C166 55 174 58 174 65V88H142V65Z" fill="white" stroke="#3f8cff" strokeWidth="2.5" />
                {/* Braços cruzados */}
                <path d="M145 72L171 78" stroke="#3f8cff" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M145 78L171 72" stroke="#3f8cff" strokeWidth="3.5" strokeLinecap="round" />
              </svg>
            </div>

            {/* Texto COPALINKS */}
            <h1 className="font-display text-4xl md:text-6xl font-black tracking-wider text-white drop-shadow-[0_0_20px_rgba(63,140,255,0.8)] text-center">
              COPA<span className="text-[#3f8cff]">LINKS</span>
            </h1>
            <div className="mt-2 h-1 w-48 bg-gradient-to-r from-transparent via-[#3f8cff] to-transparent shadow-[0_0_12px_#3f8cff]" />
          </div>
        </div>
      )}

      {/* Controles / Progresso e opção de enviar vídeo */}
      <div className="absolute bottom-10 z-20 w-[min(280px,80vw)] text-center">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/20 shadow-inner backdrop-blur-sm">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#2f7fe8] to-[#6fb2ff]"
            style={{ width: `${modoCompleto ? Math.round(quadro.t * 100) : pct}%`, transition: "width 200ms linear" }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-[13px] font-medium text-white/90">
          <span>
            {modoCompleto
              ? "Preparando sua primeira viagem…"
              : pronto
                ? "Pronto!"
                : "Carregando…"}
          </span>
          <label
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer text-[11px] text-blue-300 hover:text-blue-200 underline bg-black/40 px-2 py-1 rounded"
          >
            {videoSrc ? "Alterar vídeo" : "Enviar vídeo MP4"}
            <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
          </label>
        </div>
        {quadro.t > 0.3 && !quadro.saindo && (
          <p className="mt-2 text-[11px] text-white/50">Toque para continuar ›</p>
        )}
      </div>
    </div>
  );
}
