import type { NextConfig } from "next";

// Imagens e ícones mudam raramente: o celular guarda por 7 dias e reaproveita
// na próxima abertura, sem baixar de novo.
const CACHE_ESTATICO = "public, max-age=604800, stale-while-revalidate=2592000";

const nextConfig: NextConfig = {
  /**
   * O app também é aberto por um endereço de prévia (sandbox da Arena), que é
   * um domínio diferente do dev server. Sem isto, o Next 16 bloqueia os
   * arquivos de desenvolvimento (`/_next/hmr` e os chunks) por segurança — a
   * página aparece, mas o JavaScript não carrega: a tela de carregamento fica
   * presa em "Ligando o motor…" e o cartão do número fica invisível.
   * Vale SÓ em desenvolvimento (o build de produção não expõe isso).
   */
  allowedDevOrigins: ["*.e2b.app", "*.vercel.app", "127.0.0.1", "localhost"],
  async headers() {
    return [
      { source: "/images/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
      { source: "/icons/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
    ];
  },
};

export default nextConfig;
