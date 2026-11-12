"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  SignalHigh,
  Tv,
  X,
} from "lucide-react";
import { buscarCanais, categoriasDeCanais } from "@/lib/copaflix/catalogo";
import { horaCurta } from "@/lib/copaflix/epg";
import type { Canal, ProgramaAgora } from "@/lib/copaflix/tipos";
import Player from "./Player";

type EpgComHora = ProgramaAgora & { inicioHora?: string; fimHora?: string };

/** Logo do canal com queda para as iniciais (a lista pode ter logo quebrada). */
function LogoDoCanal({ canal }: { canal: Canal }) {
  const [quebrou, setQuebrou] = useState(false);
  const iniciais = canal.nome
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <span className="cf-canal-logo" aria-hidden>
      {canal.logo && !quebrou ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={canal.logo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setQuebrou(true)}
        />
      ) : (
        iniciais || <Tv size={18} />
      )}
    </span>
  );
}

/**
 * TV AO VIVO do CopaFlix.
 *
 * Organização por categoria (a mesma `group-title` da lista M3U), busca,
 * favoritos não se aplicam a canal ao vivo, guia com o programa que está no ar
 * (quando há EPG) e player com HLS. Sem lista autorizada configurada, a tela
 * explica como cadastrar — não existe canal pirata embutido.
 */
export default function TvAoVivo({
  canaisIniciais,
  canalInicial = null,
}: {
  canaisIniciais: Canal[];
  /** Canal escolhido fora da aba (busca ou atalho da tela inicial). */
  canalInicial?: Canal | null;
}) {
  const [canais, setCanais] = useState<Canal[]>(canaisIniciais);
  const [categoria, setCategoria] = useState("Todas");
  const [termo, setTermo] = useState("");
  const [selecionado, setSelecionado] = useState<Canal | null>(canalInicial);
  const [epg, setEpg] = useState<EpgComHora[]>([]);
  const [atualizando, setAtualizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregarEpg = useCallback(async () => {
    try {
      const resposta = await fetch("/api/copaflix/epg", { cache: "no-store" });
      if (!resposta.ok) return;
      const dados = (await resposta.json()) as { programas?: EpgComHora[] };
      setEpg(Array.isArray(dados.programas) ? dados.programas : []);
    } catch {
      /* sem guia, a tela segue com a lista */
    }
  }, []);

  useEffect(() => {
    void carregarEpg();
    const timer = setInterval(() => void carregarEpg(), 5 * 60_000);
    return () => clearInterval(timer);
  }, [carregarEpg]);

  async function atualizar() {
    setAtualizando(true);
    setAviso(null);
    try {
      const resposta = await fetch("/api/copaflix/canais?atualizar=1", { cache: "no-store" });
      const dados = (await resposta.json()) as { canais?: Canal[] };
      if (Array.isArray(dados.canais)) setCanais(dados.canais);
      await carregarEpg();
      setAviso("Lista atualizada agora.");
    } catch {
      setAviso("Não foi possível atualizar a lista. A anterior continua valendo.");
    } finally {
      setAtualizando(false);
      setTimeout(() => setAviso(null), 5000);
    }
  }

  const categorias = useMemo(() => ["Todas", ...categoriasDeCanais(canais).map((c) => c.categoria)], [canais]);

  const filtrados = useMemo(() => {
    const daCategoria = categoria === "Todas" ? canais : canais.filter((c) => c.categoria === categoria);
    return buscarCanais(daCategoria, termo);
  }, [canais, categoria, termo]);

  const grupos = useMemo(() => categoriasDeCanais(filtrados), [filtrados]);
  const programaDe = useCallback(
    (canal: Canal) => epg.find((p) => p.canalId === canal.tvgId || p.canalId === canal.id),
    [epg],
  );

  return (
    <div className="space-y-4">
      {selecionado && (
        <section className="cf-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-borda/70 px-3 py-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ciano/15 text-ciano">
              <Radio size={15} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[14px] font-extrabold text-gelo">
                {selecionado.nome}
              </p>
              <p className="truncate text-[11.5px] text-aco">
                {selecionado.categoria}
                {programaDe(selecionado) ? ` · Agora: ${programaDe(selecionado)?.titulo}` : " · ao vivo"}
              </p>
            </div>
            <button
              type="button"
              className="cf-botao-icone ml-auto !h-9 !w-9"
              onClick={() => setSelecionado(null)}
              aria-label="Fechar o canal"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-2 sm:p-3">
            <Player
              key={selecionado.id}
              titulo={selecionado.nome}
              subtitulo={selecionado.categoria}
              fonte={selecionado.fonte}
              autoIniciar
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-[11.5px] text-discreto">
            <span className="cf-chip cf-chip-ciano">
              <SignalHigh size={12} /> Transmissão ao vivo
            </span>
            {programaDe(selecionado)?.inicioHora && (
              <span className="cf-chip">
                {programaDe(selecionado)?.inicioHora} – {programaDe(selecionado)?.fimHora}
              </span>
            )}
            {selecionado.credito && <span className="truncate">{selecionado.credito}</span>}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-aco"
            aria-hidden
          />
          <input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar canal"
            aria-label="Buscar canal"
            className="campo !py-2.5 !pl-10 !text-[14px]"
          />
        </div>
        <button
          type="button"
          onClick={() => void atualizar()}
          className="cf-botao-fantasma !min-h-[42px] !px-3.5 sm:!px-4"
          disabled={atualizando}
          aria-label="Atualizar a lista de canais"
        >
          {atualizando ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          <span className="hidden sm:inline">Atualizar</span>
        </button>
      </div>

      {aviso && <p className="text-[12px] text-ciano">{aviso}</p>}

      <div className="cf-abas-rolagem flex gap-1.5 overflow-x-auto pb-1">
        {categorias.map((nome) => (
          <button
            key={nome}
            type="button"
            onClick={() => setCategoria(nome)}
            className="cf-aba"
            data-ativa={categoria === nome ? "true" : "false"}
          >
            {nome}
          </button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div className="cf-vazio">
          <Radio size={22} className="mx-auto mb-2 text-aco" />
          <p className="font-display text-[14px] font-bold text-gelo">Nenhum canal para mostrar</p>
          <p className="mt-1 text-[12.5px] leading-relaxed">
            {canais.length === 0
              ? "Cadastre uma lista M3U autorizada em COPAFLIX_M3U_URLS (veja docs/COPAFLIX.md)."
              : "Tente outra categoria ou outro nome."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map((grupo) => (
            <section key={grupo.categoria}>
              <h3 className="mb-2 flex items-center gap-2 font-display text-[13px] font-extrabold tracking-[0.08em] text-aco uppercase">
                {grupo.categoria}
                <span className="h-px flex-1 bg-borda/70" aria-hidden />
                <span className="text-[11px] font-semibold text-discreto">{grupo.canais.length}</span>
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {grupo.canais.map((canal) => {
                  const programa = programaDe(canal);
                  return (
                    <button
                      key={canal.id}
                      type="button"
                      onClick={() => {
                        setSelecionado(canal);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="cf-canal"
                      data-ativo={selecionado?.id === canal.id ? "true" : "false"}
                      aria-label={`Assistir ${canal.nome}`}
                    >
                      <LogoDoCanal canal={canal} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[13.5px] font-bold text-gelo">
                          {canal.nome}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-aco">
                          {programa
                            ? `${horaCurta(programa.inicio)} · ${programa.titulo}`
                            : canal.categoria}
                        </span>
                      </span>
                      <SignalHigh size={15} className="shrink-0 text-ciano" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="cf-vazio !text-left !text-[12px] !leading-relaxed">
        Só entram aqui canais cuja transmissão pública é autorizada (emissoras oficiais, canais
        públicos e a lista M3U obtida legalmente pela operação). Bloqueio por país e mudança de
        endereço pelas emissoras são normais; o player avisa quando o fluxo não abre.{" "}
        {selecionado?.fonte.url && (
          <a
            href={selecionado.fonte.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-semibold text-ciano hover:underline"
          >
            Abrir o fluxo no navegador <ExternalLink size={12} />
          </a>
        )}
      </p>
    </div>
  );
}
