"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  Info,
  ListVideo,
  Play,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  episodiosDaTemporada,
  nomeDaOrigem,
  nomeDoGenero,
  proximoEpisodio,
  temporadasDe,
  duracaoTexto,
} from "@/lib/copaflix/catalogo";
import { armazenamentoDoAparelho, lerProgresso, type Progresso } from "@/lib/copaflix/armazenamento";
import type { Episodio, Titulo } from "@/lib/copaflix/tipos";
import Fileira from "./Fileira";
import { ArteDoApp } from "./Cartaz";
import Player from "./Player";
import { useCopaFlixLocal } from "./useCopaFlixLocal";

/**
 * Progresso lido direto do aparelho.
 *
 * O estado do hook só é hidratado depois da montagem (para o HTML do servidor
 * bater com o cliente), então abrir a ficha por link direto (`?play=1`) ler o
 * estado daria zero e o vídeo começaria do início — apagando o ponto salvo.
 * Aqui a leitura é síncrona e só acontece no navegador.
 */
function progressoDoAparelho(id: string, episodioId?: string | null): Progresso | null {
  const lista = lerProgresso(armazenamentoDoAparelho());
  const doTitulo = lista.find((entrada) => entrada.id === id);
  if (!doTitulo) return null;
  if (episodioId && doTitulo.episodioId && doTitulo.episodioId !== episodioId) return null;
  return doTitulo;
}

const ROTULO_TIPO = { filme: "Filme", serie: "Série", novela: "Novela" } as const;

export default function TituloDetalhe({
  titulo,
  relacionados,
  tmdbAtivo,
}: {
  titulo: Titulo;
  relacionados: Titulo[];
  tmdbAtivo: boolean;
}) {
  const local = useCopaFlixLocal();
  const [rodando, setRodando] = useState(false);
  const [inicioPlayer, setInicioPlayer] = useState(0);
  const [episodios, setEpisodios] = useState<Episodio[]>(titulo.episodios ?? []);
  const [episodioAtual, setEpisodioAtual] = useState<string | null>(null);
  const [temporada, setTemporada] = useState(() => temporadasDe(titulo)[0] ?? 1);
  const [carregandoEpisodios, setCarregandoEpisodios] = useState(false);
  const [erroEpisodios, setErroEpisodios] = useState<string | null>(null);

  const temporadas = temporadasDe({ ...titulo, episodios });
  const listaDaTemporada = episodiosDaTemporada({ ...titulo, episodios }, temporada);
  const episodioObj = episodios.find((ep) => ep.id === episodioAtual) ?? null;
  const fonteAtual = episodioObj?.fonte ?? titulo.fonte ?? null;
  const favorito = local.ehFavorito(titulo.id);
  const salvo = local.progressoDe(titulo.id, episodioObj?.id);
  const podeReproduzir =
    Boolean(fonteAtual) &&
    (titulo.tipo === "filme" || episodios.length > 0 || fonteAtual?.tipo === "externo");

  const generos = useMemo(() => titulo.generos.map(nomeDoGenero), [titulo.generos]);

  /* primeira abertura: retoma o episódio salvo e, com ?play=1, já reproduz */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const epParam = params.get("ep");
    const doAparelho = lerProgresso(armazenamentoDoAparelho()).filter((entrada) => entrada.id === titulo.id);
    const progresso = doAparelho[0] ?? null;
    const primeiro = titulo.episodios?.[0]?.id ?? null;
    const inicial = epParam ?? progresso?.episodioId ?? primeiro;

    if (inicial) {
      setEpisodioAtual(inicial);
      const ep = (titulo.episodios ?? []).find((e) => e.id === inicial);
      if (ep) setTemporada(ep.temporada);
    }
    if (params.get("play") === "1") {
      const doEpisodio =
        doAparelho.find((entrada) => !inicial || !entrada.episodioId || entrada.episodioId === inicial) ??
        progresso;
      setInicioPlayer(doEpisodio?.posicao && doEpisodio.posicao > 5 ? doEpisodio.posicao : 0);
      setRodando(true);
      local.registrarAbertura(titulo);
    }
    // Só na abertura da ficha (trocar de episódio é ação do usuário).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulo.id]);

  /* séries do Jellyfin: episódios só quando a ficha abre */
  useEffect(() => {
    if (titulo.origem !== "jellyfin" || titulo.tipo === "filme") return;
    if ((titulo.episodios ?? []).length > 0) return;
    const itemId = titulo.fonte?.itemId;
    if (!itemId) return;
    let vivo = true;
    setCarregandoEpisodios(true);
    fetch(`/api/copaflix/jellyfin/serie/${encodeURIComponent(itemId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Não foi possível ler os episódios."))))
      .then((dados: { episodios?: Episodio[] }) => {
        if (!vivo) return;
        const lista = Array.isArray(dados.episodios) ? dados.episodios : [];
        setEpisodios(lista);
        if (lista.length) {
          setTemporada((atual) => (temporadasDe({ ...titulo, episodios: lista }).includes(atual) ? atual : lista[0].temporada));
          setEpisodioAtual((atual) => atual ?? lista[0].id);
        }
        setErroEpisodios(lista.length ? null : "Esta série não tem episódios visíveis no servidor.");
      })
      .catch((erro: Error) => {
        if (vivo) setErroEpisodios(erro.message);
      })
      .finally(() => {
        if (vivo) setCarregandoEpisodios(false);
      });
    return () => {
      vivo = false;
    };
  }, [titulo]);

  function iniciar(episodioId?: string | null) {
    const alvo = episodioId ?? episodioAtual;
    // Fonte externa: o vídeo nunca é embutido — abre no site oficial.
    const fonteDoAlvo =
      episodios.find((e) => e.id === alvo)?.fonte ?? titulo.fonte ?? null;
    if (fonteDoAlvo?.tipo === "externo") {
      if (fonteDoAlvo.url && typeof window !== "undefined") {
        window.open(fonteDoAlvo.url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    const entrada =
      local.progressoDe(titulo.id, alvo ?? undefined) ?? progressoDoAparelho(titulo.id, alvo ?? undefined);
    setEpisodioAtual(alvo ?? null);
    const ep = episodios.find((e) => e.id === alvo);
    if (ep) setTemporada(ep.temporada);
    setInicioPlayer(entrada && entrada.posicao > 5 ? entrada.posicao : 0);
    setRodando(true);
    local.registrarAbertura(titulo);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const proximo = episodioObj ? proximoEpisodio({ ...titulo, episodios }, episodioObj.id) : null;

  function aoTerminar() {
    if (!episodioObj) return;
    // Terminou: sai de "Continuar assistindo" (o próximo episódio, se houver,
    // volta a registrar progresso quando começar).
    local.esquecer(titulo.id);
    if (proximo) {
      setEpisodioAtual(proximo.id);
      setTemporada(proximo.temporada);
      setInicioPlayer(0);
    }
  }

  const capa = titulo.fundo ?? titulo.capa;
  const meta = [
    titulo.ano,
    titulo.duracaoMin ? duracaoTexto(titulo.duracaoMin) : null,
    titulo.classificacao,
    titulo.temporadas ? `${titulo.temporadas} temporada(s)` : null,
  ].filter(Boolean);

  return (
    <div className="copaflix">
      <div className="cf-halo" aria-hidden />

      <header className="cf-topo">
        <div className="mx-auto flex w-full max-w-[1180px] items-center gap-2 px-3 py-2.5 sm:px-5">
          <Link
            href="/copaflix"
            aria-label="Voltar ao CopaFlix"
            title="Voltar ao CopaFlix"
            className="cf-botao-icone !h-9 !w-9"
          >
            <ArrowLeft size={17} />
          </Link>
          <div className="min-w-0">
            <p className="micro text-aco">CopaFlix · {ROTULO_TIPO[titulo.tipo]}</p>
            <p className="truncate font-display text-[13.5px] font-bold text-gelo">{titulo.titulo}</p>
          </div>
          <button
            type="button"
            onClick={() => local.alternarFavorito(titulo)}
            aria-pressed={favorito}
            aria-label={favorito ? "Remover da minha lista" : "Adicionar à minha lista"}
            className="cf-botao-icone ml-auto !h-9 !w-9"
            data-ativo={favorito ? "true" : "false"}
          >
            {favorito ? <Check size={16} /> : <Plus size={16} />}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-3 pt-3 pb-24 sm:px-5 md:pb-16">
        {rodando && fonteAtual ? (
          <section className="mb-5">
            <Player
              key={`${titulo.id}-${episodioAtual ?? "unico"}`}
              titulo={titulo.titulo}
              subtitulo={
                episodioObj
                  ? `T${episodioObj.temporada}·E${episodioObj.numero} ${episodioObj.titulo}`
                  : ROTULO_TIPO[titulo.tipo]
              }
              fonte={fonteAtual}
              inicio={inicioPlayer}
              capa={capa}
              aoProgredir={(posicao, duracao) =>
                local.salvarProgresso(titulo, {
                  posicao,
                  duracao,
                  episodioId: episodioObj?.id,
                  episodioTitulo: episodioObj?.titulo,
                  temporada: episodioObj?.temporada,
                  numero: episodioObj?.numero,
                })
              }
              aoTerminar={aoTerminar}
              aoProximo={proximo ? () => iniciar(proximo.id) : undefined}
              rotuloProximo={proximo ? proximo.titulo : undefined}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRodando(false)}
                className="cf-botao-fantasma !min-h-[38px] !px-3.5 !text-[12.5px]"
              >
                <Info size={14} /> Ficha do título
              </button>
              {salvo && salvo.duracao > 0 && salvo.posicao / salvo.duracao < 0.95 && (
                <span className="cf-chip cf-chip-ciano">
                  Retomando de {salvo.posicao < 60 ? `${Math.floor(salvo.posicao)} s` : `${Math.floor(salvo.posicao / 60)} min`}
                </span>
              )}
              {episodioObj && (
                <span className="cf-chip">
                  T{episodioObj.temporada} · E{episodioObj.numero}
                </span>
              )}
            </div>
          </section>
        ) : (
          <section className="cf-destaque mb-5 min-h-[280px] sm:min-h-[340px]">
            {capa ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={capa} alt="" aria-hidden className="cf-destaque-fundo" />
            ) : (
              <ArteDoApp arte={titulo.arte} prioridade />
            )}
            <div className="cf-destaque-veu" aria-hidden />
            <div className="cf-destaque-conteudo p-4 sm:p-6">
              <p className="micro flex items-center gap-2 text-ciano">
                {ROTULO_TIPO[titulo.tipo]}
                {titulo.destaque && <Sparkles size={12} className="text-ouro" />}
              </p>
              <h1 className="mt-1 font-display text-[clamp(25px,6.4vw,44px)] leading-[1.02] font-extrabold tracking-tight text-gelo">
                {titulo.titulo}
              </h1>
              {titulo.tituloOriginal && (
                <p className="mt-0.5 text-[12px] text-aco italic">{titulo.tituloOriginal}</p>
              )}
              {meta.length > 0 && (
                <p className="tabular mt-2 text-[12.5px] font-semibold text-gelo/80">
                  {meta.join(" · ")}
                </p>
              )}
              <p className="mt-2.5 line-clamp-4 max-w-[64ch] text-[13px] leading-relaxed text-gelo/85">
                {titulo.sinopse}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => iniciar()}
                  disabled={!podeReproduzir}
                  className="cf-botao-ouro"
                >
                  <Play size={17} className="fill-current" />
                  {salvo && salvo.posicao > 5 ? "Continuar" : "Assistir"}
                </button>
                <button
                  type="button"
                  onClick={() => local.alternarFavorito(titulo)}
                  aria-pressed={favorito}
                  className="cf-botao-fantasma"
                >
                  <Bookmark size={15} /> {favorito ? "Na minha lista" : "Minha lista"}
                </button>
                {fonteAtual?.tipo === "externo" && fonteAtual.url && (
                  <a
                    href={fonteAtual.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="cf-botao-fantasma"
                  >
                    <Radio size={15} /> Abrir na fonte oficial
                  </a>
                )}
              </div>

              {!podeReproduzir && (
                <p className="mt-3 max-w-[60ch] rounded-[12px] border border-ouro/35 bg-ouro/10 px-3 py-2 text-[12px] leading-relaxed text-ouro">
                  {carregandoEpisodios
                    ? "Lendo os episódios no seu servidor Jellyfin…"
                    : "Este título está na ficha, mas não tem fonte de reprodução autorizada configurada. Adicione o arquivo no Jellyfin ou cadastre uma fonte legal."}
                </p>
              )}
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
          <div className="cf-card p-4">
            <h2 className="font-display text-[15px] font-extrabold text-gelo">Sinopse</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-aco">{titulo.sinopse}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {generos.map((genero) => (
                <span key={genero} className="cf-chip cf-chip-ciano">
                  {genero}
                </span>
              ))}
              <span className="cf-chip cf-chip-ouro">{nomeDaOrigem(titulo.origem)}</span>
            </div>

            {titulo.credito && (
              <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-discreto">
                <ShieldCheck size={13} className="mt-0.5 shrink-0 text-verde" />
                {titulo.credito}
              </p>
            )}
            {tmdbAtivo && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-discreto">
                Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.
              </p>
            )}
          </div>

          <div className="cf-card p-4">
            <h2 className="flex items-center gap-2 font-display text-[15px] font-extrabold text-gelo">
              <ListVideo size={15} className="text-ciano" /> Reprodução
            </h2>
            <dl className="mt-2 space-y-1.5 text-[12.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-aco">Fonte</dt>
                <dd className="text-right font-semibold text-gelo">
                  {fonteAtual?.tipo === "hls"
                    ? "HLS (.m3u8)"
                    : fonteAtual?.tipo === "arquivo"
                      ? "Arquivo direto"
                      : fonteAtual?.tipo === "jellyfin"
                        ? "Jellyfin (proxy)"
                        : fonteAtual?.tipo === "externo"
                          ? fonteAtual.provedor ?? "Site oficial"
                          : "Não configurada"}
                </dd>
              </div>
              {episodios.length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-aco">Episódios</dt>
                  <dd className="font-semibold text-gelo">{episodios.length}</dd>
                </div>
              )}
              {salvo && (
                <div className="flex justify-between gap-3">
                  <dt className="text-aco">Seu progresso</dt>
                  <dd className="tabular font-semibold text-ciano">
                    {Math.floor((salvo.posicao / Math.max(1, salvo.duracao)) * 100)}%
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-2 border-t border-borda/60 pt-2 text-[11px] leading-relaxed text-discreto">
              Favoritos e progresso ficam apenas neste aparelho. Fontes com DRM ou bloqueio
              geográfico não abrem — o player avisa.
            </p>
          </div>
        </section>

        {titulo.tipo !== "filme" && (
          <section className="mt-5">
            <header className="mb-2.5 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-[17px] font-extrabold text-gelo">Episódios</h2>
              {temporadas.length > 0 && (
                <label className="relative inline-flex items-center">
                  <span className="sr-only">Temporada</span>
                  <select
                    value={temporada}
                    onChange={(evento) => setTemporada(Number(evento.target.value))}
                    className="cf-select !pr-8"
                  >
                    {temporadas.map((numero) => (
                      <option key={numero} value={numero}>
                        Temporada {numero}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 text-aco"
                    aria-hidden
                  />
                </label>
              )}
              {carregandoEpisodios && (
                <span className="text-[11.5px] text-aco">Lendo episódios do Jellyfin…</span>
              )}
            </header>

            {erroEpisodios && (
              <p className="mb-2 rounded-[12px] border border-ouro/35 bg-ouro/10 px-3 py-2 text-[12px] text-ouro">
                {erroEpisodios}
              </p>
            )}

            {listaDaTemporada.length === 0 ? (
              <div className="cf-vazio !text-left !text-[12.5px]">
                Nenhum episódio cadastrado para esta temporada. Se a série vem do Jellyfin,
                confirme se os arquivos estão identificados no servidor.
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {listaDaTemporada.map((episodio) => {
                  const ativo = episodio.id === episodioAtual;
                  const progressoEp = local.progressoDe(titulo.id, episodio.id);
                  const pct =
                    progressoEp && progressoEp.duracao
                      ? Math.min(100, (progressoEp.posicao / progressoEp.duracao) * 100)
                      : 0;
                  return (
                    <li key={episodio.id}>
                      <button
                        type="button"
                        onClick={() => iniciar(episodio.id)}
                        disabled={!episodio.fonte && !titulo.fonte}
                        className={`cf-canal !items-start ${ativo ? "!border-ciano/70" : ""}`}
                        aria-label={`Assistir ${episodio.titulo}`}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-ciano/12 font-display text-[12px] font-extrabold text-ciano">
                          {episodio.numero}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-display text-[13px] font-bold text-gelo">
                            {episodio.titulo}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-aco">
                            T{episodio.temporada} · E{episodio.numero}
                            {episodio.duracaoMin ? ` · ${duracaoTexto(episodio.duracaoMin)}` : ""}
                          </span>
                          {pct > 0 && (
                            <span className="progresso-trilho mt-1.5 block h-1 overflow-hidden rounded-full">
                              <span
                                className="progresso-ciano block h-full rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                          )}
                        </span>
                        <Play size={15} className="mt-1 shrink-0 text-ouro" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {relacionados.length > 0 && (
          <div className="mt-6">
            <Fileira id="relacionados" titulo="Você também pode gostar" itens={relacionados} />
          </div>
        )}

        <p className="mt-8 flex flex-wrap items-center gap-2 border-t border-borda/60 pt-3 text-[11px] text-discreto">
          <Link href="/copaflix" className="inline-flex items-center gap-1 font-semibold text-aco hover:text-gelo">
            <ArrowLeft size={12} /> Voltar ao CopaFlix
          </Link>
          <span className="ml-auto">CopaFlix · uma seção do CopaLinks</span>
        </p>
      </main>
    </div>
  );
}
