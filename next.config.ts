import type { NextConfig } from "next";

// Imagens e ícones mudam raramente: o celular guarda por 7 dias e reaproveita
// na próxima abertura, sem baixar de novo.
const CACHE_ESTATICO = "public, max-age=604800, stale-while-revalidate=2592000";

/**
 * O carimbo desta publicação: o commit (12 primeiros caracteres) e o fim do
 * número da publicação na Vercel. Entra no código na hora da compilação — o
 * mesmo valor no celular e no servidor de uma mesma publicação — e é o que a
 * tela aberta compara com `/api/versao` para saber se saiu versão nova.
 * `VERSAO_APP` (opcional) fixa o carimbo à mão. Fora da Vercel e sem
 * `VERSAO_APP` fica vazio, e o vigia de versão não liga.
 */
export function carimboDaPublicacao(ambiente: Record<string, string | undefined>): string {
  const limpo = (texto: string | undefined) => (texto ?? "").trim().replace(/[^A-Za-z0-9._-]/g, "");
  const aMao = limpo(ambiente.VERSAO_APP);
  if (aMao) return aMao.slice(0, 40);
  const commit = limpo(ambiente.VERCEL_GIT_COMMIT_SHA).slice(0, 12);
  const publicacao = limpo(ambiente.VERCEL_DEPLOYMENT_ID).replace(/^dpl_/, "").slice(-8);
  return [commit, publicacao].filter(Boolean).join("-");
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_VERSAO_APP: carimboDaPublicacao(process.env) },
  async headers() {
    return [
      { source: "/images/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
      { source: "/icons/:arquivo*", headers: [{ key: "Cache-Control", value: CACHE_ESTATICO }] },
      // A versão no ar: nunca guardada (a tela pergunta para saber se saiu publicação nova).
      { source: "/api/versao", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;
