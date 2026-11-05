import type { NextConfig } from "next";

// Imagens e ícones mudam raramente: o celular guarda por 7 dias e reaproveita
// na próxima abertura, sem baixar de novo.
const CACHE_ESTATICO = "public, max-age=604800, stale-while-revalidate=2592000";

const nextConfig: NextConfig = {
  // Ambientes de preview (ex.: *.e2b.app) servem o app por um host próprio;
  // sem isto o next dev bloqueia os chunks /_next com "Unauthorized".
  allowedDevOrigins: ["*.e2b.app"],
  async headers() {
    return [
      { source: "/images/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
      { source: "/icons/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
      // Coleção oficial de figurinhas (PNGs transparentes em public/stickers):
      // o celular baixa uma vez e reaproveita no PWA/Android.
      { source: "/stickers/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
    ];
  },
};

export default nextConfig;
