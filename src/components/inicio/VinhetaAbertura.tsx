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
      return localStorage.getItem("copalinks_vinheta_video") || "/vinheta.mp4";
    } catch {
      return "/vinheta.mp4";
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
      className="fixed inset-0 z-[85] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#030816] px-6"
      style={{
        opacity: quadro.saindo ? 0 : 1,
        transition: "opacity 320ms ease",
      }}
    >
      {/* Vídeo da Vinheta em tela cheia (substituindo a logo e a pista) */}
      <div className="absolute inset-0 overflow-hidden flex items-center justify-center bg-black">
        <video
          autoPlay
          muted
          playsInline
          loop
          className="absolute h-full w-full object-cover opacity-95"
          src={videoSrc}
          onError={() => {
            setVideoSrc("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4");
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#030816] via-transparent to-black/30 pointer-events-none" />
      </div>

      {/* Controles discretos / Barra de carregamento */}
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
            Trocar vídeo
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
