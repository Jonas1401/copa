import type { Metadata } from "next";
import CopaFlixApp from "@/components/copaflix/CopaFlixApp";
import { abaPorId } from "@/components/copaflix/abas";
import { carregarAcervo } from "@/lib/copaflix/fontes";
import { ACERVO_VAZIO, type Acervo } from "@/lib/copaflix/tipos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CopaFlix · Entretenimento do CopaLinks",
  description:
    "Filmes, séries, novelas e TV ao vivo dentro do CopaLinks, com fontes autorizadas e catálogo próprio.",
};

/**
 * Teto da espera pelas fontes externas (M3U, Jellyfin, TMDB). Bem abaixo do
 * limite da Vercel: se o servidor de mídia estiver lento, a tela abre com o
 * catálogo local e as fontes entram na próxima abertura (o resultado fica em
 * cache por 5 minutos no servidor).
 */
const PRAZO_FONTES_MS = 4000;

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promessa,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      timer.unref?.();
    }),
  ]);
}

export default async function CopaFlixPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba } = await searchParams;

  let acervo: Acervo = ACERVO_VAZIO;
  try {
    acervo = (await comPrazo(carregarAcervo(), PRAZO_FONTES_MS)) ?? ACERVO_VAZIO;
  } catch (erro) {
    console.error("[copaflix] abertura com o catálogo local:", erro);
  }

  return <CopaFlixApp acervo={acervo} abaInicial={abaPorId(aba ?? "inicio")} />;
}
