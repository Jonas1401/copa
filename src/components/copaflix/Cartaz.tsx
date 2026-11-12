"use client";

import Link from "next/link";
import { useState } from "react";
import { Film, Heart, Tv } from "lucide-react";
import type { Titulo } from "@/lib/copaflix/tipos";
import { duracaoTexto } from "@/lib/copaflix/catalogo";

const ICONE = { filme: Film, serie: Tv, novela: Heart } as const;
const ROTULO = { filme: "Filme", serie: "Série", novela: "Novela" } as const;

/**
 * Arte do app para quem não tem cartaz autorizado: uma das seis imagens
 * cinematográficas em public/images/copaflix (paleta do CopaLinks), com a
 * arte em CSS por baixo — se a imagem não carregar, a capa continua bonita.
 */
export function ArteDoApp({
  arte = 0,
  prioridade = false,
}: {
  arte?: number;
  prioridade?: boolean;
}) {
  const numero = Math.abs(Math.trunc(arte)) % 6;
  return (
    <div aria-hidden className={`cf-arte cf-arte-${numero}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/images/copaflix/arte-${numero}.webp`}
        alt=""
        loading={prioridade ? "eager" : "lazy"}
        decoding="async"
        className="cf-arte-foto"
      />
    </div>
  );
}

/** Fundo da capa: cartaz autorizado quando existe; arte do app quando não. */
export function FundoDaCapa({
  titulo,
  larga = false,
  prioridade = false,
}: {
  titulo: Titulo;
  larga?: boolean;
  prioridade?: boolean;
}) {
  const endereco = larga ? titulo.fundo ?? titulo.capa : titulo.capa;
  // Cartaz de terceiro pode sair do ar: se a imagem falhar, cai para a arte
  // do app em vez de deixar um quadrado quebrado na fileira.
  const [falhou, setFalhou] = useState(false);
  if (endereco && !falhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={endereco}
        alt=""
        aria-hidden
        loading={prioridade ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFalhou(true)}
        className="cf-capa-foto"
      />
    );
  }
  return <ArteDoApp arte={titulo.arte} prioridade={prioridade} />;
}

export function SeloTipo({ tipo }: { tipo: Titulo["tipo"] }) {
  const Icone = ICONE[tipo];
  return (
    <span className={`cf-selo-tipo ${tipo === "novela" ? "cf-selo-ouro" : ""}`}>
      <Icone size={10} strokeWidth={2.6} aria-hidden />
      {ROTULO[tipo]}
    </span>
  );
}

export function ConteudoDaCapa({
  titulo,
  prioridade = false,
}: {
  titulo: Titulo;
  prioridade?: boolean;
}) {
  const meta = [titulo.ano ? String(titulo.ano) : null, duracaoTexto(titulo.duracaoMin)]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <FundoDaCapa titulo={titulo} prioridade={prioridade} />
      <div className="cf-capa-veu" aria-hidden />
      <SeloTipo tipo={titulo.tipo} />
      <div className="cf-capa-texto">
        <p className="cf-capa-titulo">{titulo.titulo}</p>
        {meta && <p className="cf-capa-meta">{meta}</p>}
      </div>
    </>
  );
}

/**
 * Capa clicável de um título (fileiras, busca, favoritos).
 * A roda 3D usa `ConteudoDaCapa` diretamente, porque ali o arrasto manda.
 */
export default function Cartaz({
  titulo,
  largura = "w-[138px] sm:w-[152px] md:w-[166px]",
  prioridade = false,
  className = "",
}: {
  titulo: Titulo;
  largura?: string;
  prioridade?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/copaflix/titulo/${encodeURIComponent(titulo.id)}`}
      aria-label={`${titulo.titulo} — ${ROTULO[titulo.tipo]}`}
      className={`group relative block shrink-0 ${largura} ${className}`}
    >
      <div className="cf-capa-moldura aspect-[2/3] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:border-ciano/60">
        <ConteudoDaCapa titulo={titulo} prioridade={prioridade} />
      </div>
    </Link>
  );
}
