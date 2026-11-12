"use client";

import Link from "next/link";
import { ArrowLeft, Bookmark, Search, ShieldCheck, X } from "lucide-react";
import type { AbaCopaFlix, ItemAba } from "./abas";

/**
 * Topo do CopaFlix.
 *
 * A logo e a palavra COPAFLIX mantêm a identidade do CopaLinks (mesmo
 * arquivo de logo, mesmas cores). O botão de voltar leva para a tela inicial
 * do app, exatamente como qualquer outra página interna (tempo, frete...).
 */
export default function CabecalhoCopaFlix({
  logo,
  buscaAberta,
  termo,
  aoMudarTermo,
  aoAbrirBusca,
  aoFecharBusca,
  favoritos,
  aoAbrirFontes,
  abas,
  aba,
  aoTrocarAba,
}: {
  logo: { src: string; largura: number; altura: number };
  buscaAberta: boolean;
  termo: string;
  aoMudarTermo: (valor: string) => void;
  aoAbrirBusca: () => void;
  aoFecharBusca: () => void;
  favoritos: number;
  aoAbrirFontes: () => void;
  abas: ItemAba[];
  aba: AbaCopaFlix;
  aoTrocarAba: (aba: AbaCopaFlix) => void;
}) {
  return (
    <header className="cf-topo">
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-2 px-3 py-2.5 sm:px-5">
        <Link
          href="/"
          aria-label="Voltar ao CopaLinks"
          title="Voltar ao CopaLinks"
          className="cf-botao-icone !h-9 !w-9"
        >
          <ArrowLeft size={17} strokeWidth={2.2} />
        </Link>

        <Link href="/copaflix" className="flex min-w-0 items-center gap-2" aria-label="CopaFlix — início">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo.src}
            width={logo.largura}
            height={logo.altura}
            alt="CopaLinks"
            className="cf-marca-copaLinks h-8 w-auto shrink-0 sm:h-9"
          />
          <span aria-hidden className="hidden h-5 w-px shrink-0 bg-borda sm:block" />
          <span className="cf-marca-copaflix truncate text-[13.5px] sm:text-[16px]">
            COPA<b>FLIX</b>
          </span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={buscaAberta ? aoFecharBusca : aoAbrirBusca}
            aria-label={buscaAberta ? "Fechar a busca" : "Buscar no CopaFlix"}
            aria-expanded={buscaAberta}
            className="cf-botao-icone !h-9 !w-9"
            data-ativo={buscaAberta ? "true" : "false"}
          >
            {buscaAberta ? <X size={16} /> : <Search size={16} strokeWidth={2.1} />}
          </button>

          <button
            type="button"
            onClick={() => aoTrocarAba("favoritos")}
            aria-label={`Minha lista${favoritos ? ` · ${favoritos} título(s)` : ""}`}
            title="Minha lista"
            className="cf-botao-icone relative !h-9 !w-9"
            data-ativo={aba === "favoritos" ? "true" : "false"}
          >
            <Bookmark size={16} strokeWidth={2.1} />
            {favoritos > 0 && (
              <span
                aria-hidden
                className="tabular absolute -top-1 -right-1 grid h-[17px] min-w-[17px] place-items-center rounded-full border-[1.5px] border-fundo bg-ciano px-1 font-display text-[9px] leading-none font-extrabold text-fundo"
              >
                {favoritos > 99 ? "99+" : favoritos}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={aoAbrirFontes}
            aria-label="Fontes autorizadas e licenças"
            title="Fontes e licenças"
            className="cf-botao-icone hidden !h-9 !w-9 sm:grid"
          >
            <ShieldCheck size={16} strokeWidth={2.1} />
          </button>
        </div>
      </div>

      {buscaAberta && (
        <div className="mx-auto w-full max-w-[1180px] px-3 pb-2.5 sm:px-5">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-aco"
              aria-hidden
            />
            <input
              type="search"
              autoFocus
              value={termo}
              onChange={(evento) => aoMudarTermo(evento.target.value)}
              placeholder="Buscar filme, série, novela ou canal"
              aria-label="Buscar no CopaFlix"
              className="campo !py-2.5 !pr-10 !pl-10 !text-[14px]"
            />
            {termo && (
              <button
                type="button"
                onClick={() => aoMudarTermo("")}
                aria-label="Limpar a busca"
                className="absolute top-1/2 right-2.5 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-aco hover:text-gelo"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <nav className="hidden md:block" aria-label="Seções do CopaFlix">
        <div className="cf-abas-rolagem mx-auto flex w-full max-w-[1180px] gap-1.5 overflow-x-auto px-5 pb-2">
          {abas.map((item) => {
            const Icone = item.icone;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => aoTrocarAba(item.id)}
                className="cf-aba"
                data-ativa={aba === item.id ? "true" : "false"}
                aria-current={aba === item.id ? "page" : undefined}
              >
                <Icone size={14} strokeWidth={2.2} />
                {item.rotulo}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
