import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSun,
  Moon,
  Sun,
} from "lucide-react";
import type { Icone } from "@/lib/tempo";

const LINHA: Record<Icone, typeof Cloud> = {
  sol: Sun,
  lua: Moon,
  "sol-nuvem": CloudSun,
  "lua-nuvem": CloudMoon,
  nuvem: Cloud,
  neblina: CloudFog,
  garoa: CloudDrizzle,
  chuva: CloudRain,
  "chuva-forte": CloudRainWind,
  tempestade: CloudLightning,
};

const COR: Record<Icone, string> = {
  sol: "text-[#FFB82E]",
  lua: "text-[#8FA8AC]",
  "sol-nuvem": "text-[#8FA8AC]",
  "lua-nuvem": "text-[#8FA8AC]",
  nuvem: "text-white",
  neblina: "text-[#8FA8AC]",
  garoa: "text-[#129DFF]",
  chuva: "text-[#129DFF]",
  "chuva-forte": "text-[#129DFF]",
  tempestade: "text-[#FFB82E]",
};

/** Ícone de linha (cards de hora e de dia). */
export function IconeLinha({
  icone,
  className = "",
  tamanho = 30,
}: {
  icone: Icone;
  className?: string;
  tamanho?: number;
}) {
  const I = LINHA[icone] ?? Cloud;
  return <I size={tamanho} strokeWidth={1.8} className={`${COR[icone]} ${className}`} aria-hidden />;
}

/** Ícone grande e volumoso do "agora" (nuvem com brilho, gotas, sol...). */
export function IconeGrande({ icone, className = "" }: { icone: Icone; className?: string }) {
  const temSol = icone === "sol" || icone === "sol-nuvem";
  const temLua = icone === "lua" || icone === "lua-nuvem";
  const soAstro = icone === "sol" || icone === "lua";
  const gotas = icone === "garoa" ? 3 : icone === "chuva" ? 4 : icone === "chuva-forte" || icone === "tempestade" ? 5 : 0;
  const nevoa = icone === "neblina";

  return (
    <svg viewBox="0 0 140 130" className={className} role="img" aria-label={icone}>
      <defs>
        <radialGradient id="ig-nuvem" cx="40%" cy="30%" r="75%">
          <stop offset="0" stopColor="#EAF4F7" />
          <stop offset="0.45" stopColor="#8FA8AC" />
          <stop offset="1" stopColor="#506A75" />
        </radialGradient>
        <radialGradient id="ig-sol" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#FFB82E" />
          <stop offset="1" stopColor="#FFB82E" />
        </radialGradient>
        <linearGradient id="ig-gota" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#129DFF" />
          <stop offset="1" stopColor="#129DFF" />
        </linearGradient>
        <filter id="ig-brilho" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {temSol && (
        <g transform={soAstro ? "translate(70 62)" : "translate(92 38)"}>
          <circle r={soAstro ? 34 : 22} fill="#FFB82E" opacity="0.35" filter="url(#ig-brilho)" />
          <circle r={soAstro ? 28 : 19} fill="url(#ig-sol)" />
        </g>
      )}
      {temLua && (
        <g transform={soAstro ? "translate(70 62)" : "translate(94 38)"}>
          <path
            d={soAstro ? "M10 -30 A30 30 0 1 0 30 12 A24 24 0 1 1 10 -30 Z" : "M6 -20 A20 20 0 1 0 20 8 A16 16 0 1 1 6 -20 Z"}
            fill="#8FA8AC"
          />
        </g>
      )}

      {!soAstro && (
        <g>
          <ellipse cx="66" cy="66" rx="52" ry="30" fill="#8FA8AC" opacity="0.35" filter="url(#ig-brilho)" />
          <path
            d="M34 82 C18 82 12 70 16 60 C20 50 32 47 40 50 C42 34 56 24 71 26 C86 28 96 40 96 52 C108 50 120 58 120 70 C120 80 112 86 102 86 L40 86 C38 86 36 84 34 82 Z"
            fill="url(#ig-nuvem)"
          />
        </g>
      )}

      {Array.from({ length: gotas }).map((_, i) => {
        const x = 34 + i * (gotas > 4 ? 17 : 20);
        return (
          <path
            key={i}
            d={`M${x + 6} 96 L${x} 118`}
            stroke="url(#ig-gota)"
            strokeWidth={icone === "garoa" ? 5 : 7}
            strokeLinecap="round"
          />
        );
      })}

      {icone === "tempestade" && <path d="M72 88 L60 110 L72 108 L64 128 L86 100 L74 102 L82 88 Z" fill="#FFB82E" />}

      {nevoa &&
        [98, 108, 118].map((y, i) => (
          <path key={y} d={`M${24 + i * 6} ${y} H${118 - i * 8}`} stroke="#8FA8AC" strokeWidth="6" strokeLinecap="round" opacity={0.9 - i * 0.2} />
        ))}
    </svg>
  );
}
