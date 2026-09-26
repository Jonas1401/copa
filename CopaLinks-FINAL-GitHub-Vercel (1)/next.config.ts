import type { NextConfig } from "next";

// Imagens e ícones mudam raramente: o celular guarda por 7 dias e reaproveita
// na próxima abertura, sem baixar de novo.
const CACHE_ESTATICO = "public, max-age=604800, stale-while-revalidate=2592000";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/images/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
      { source: "/icons/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
    ];
  },
};

export default nextConfig;
