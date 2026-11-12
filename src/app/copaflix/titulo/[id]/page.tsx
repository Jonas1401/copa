import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TituloDetalhe from "@/components/copaflix/TituloDetalhe";
import { carregarAcervo } from "@/lib/copaflix/fontes";
import type { Titulo } from "@/lib/copaflix/tipos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function acharTitulo(idBruto: string): Promise<{ titulo: Titulo | null; titulos: Titulo[]; tmdbAtivo: boolean }> {
  const acervo = await carregarAcervo().catch(() => null);
  if (!acervo) return { titulo: null, titulos: [], tmdbAtivo: false };
  let id = idBruto;
  try {
    id = decodeURIComponent(idBruto);
  } catch {
    /* id já decodificado */
  }
  return {
    titulo: acervo.titulos.find((t) => t.id === id) ?? null,
    titulos: acervo.titulos,
    tmdbAtivo: acervo.tmdbAtivo,
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const { titulo } = await acharTitulo(id);
  if (!titulo) return { title: "Título não encontrado · CopaFlix" };
  return {
    title: `${titulo.titulo} · CopaFlix`,
    description: titulo.sinopse.slice(0, 180),
    openGraph: {
      title: `${titulo.titulo} · CopaFlix`,
      description: titulo.sinopse.slice(0, 180),
      images: titulo.fundo || titulo.capa ? [titulo.fundo ?? titulo.capa ?? ""] : undefined,
    },
  };
}

export default async function TituloCopaFlixPage({ params }: Params) {
  const { id } = await params;
  const { titulo, titulos, tmdbAtivo } = await acharTitulo(id);
  if (!titulo) notFound();

  // Relacionados: mesmo tipo e ao menos um gênero em comum, dos mais populares
  // aos menos. Nunca busca fora do acervo autorizado.
  const relacionados = titulos
    .filter(
      (outro) =>
        outro.id !== titulo.id &&
        outro.tipo === titulo.tipo &&
        outro.generos.some((genero) => titulo.generos.includes(genero)),
    )
    .sort((a, b) => (b.popularidade ?? 0) - (a.popularidade ?? 0))
    .slice(0, 14);

  return <TituloDetalhe titulo={titulo} relacionados={relacionados} tmdbAtivo={tmdbAtivo} />;
}
