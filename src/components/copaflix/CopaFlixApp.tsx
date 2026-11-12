"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  Clock,
  Film,
  Heart,
  Info,
  Play,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Tv,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { LOGO } from "@/lib/logo";
import {
  ATRIBUICAO_TMDB,
  buscar,
  buscarCanais,
  categoriasSemConteudo,
  CATEGORIAS_ESPERADAS,
  duracaoTexto,
  fileirasDeFilmes,
  fileirasDeNovelas,
  fileirasDeSeries,
  nomeDaOrigem,
  nomeDoGenero,
  populares,
  resumoDoAcervo,
  tempoTexto,
} from "@/lib/copaflix/catalogo";
import type { Acervo, Canal, Fileira as FileiraDeTitulos, StatusFonte, Titulo } from "@/lib/copaflix/tipos";
import type { Progresso } from "@/lib/copaflix/armazenamento";
import Cabecalho from "./CabecalhoCopaFlix";
import Carrossel3D from "./Carrossel3D";
import Cartaz, { ArteDoApp } from "./Cartaz";
import Fileira from "./Fileira";
import TvAoVivo from "./TvAoVivo";
import { useCopaFlixLocal } from "./useCopaFlixLocal";
import { ABAS, ABAS_RODAPE, type AbaCopaFlix } from "./abas";

function porId(id: AbaCopaFlix) {
  return ABAS.find((a) => a.id === id) ?? ABAS[0];
}

const NOME_TIPO = { filme: "Filme", serie: "Série", novela: "Novela" } as const;

/** "agora", "há 12min", "há 3h" ou a data — só no cliente (histórico local). */
function quando(em: number) {
  const segundos = Math.max(0, Math.round((Date.now() - em) / 1000));
  if (segundos < 60) return "agora";
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)}min`;
  if (segundos < 86_400) return `há ${Math.floor(segundos / 3600)}h`;
  return new Date(em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/* ------------------------------------------------------------- pedaços */

function EtiquetasDoTitulo({ titulo }: { titulo: Titulo }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {titulo.ano && <span className="cf-chip">{titulo.ano}</span>}
      {titulo.duracaoMin ? <span className="cf-chip">{duracaoTexto(titulo.duracaoMin)}</span> : null}
      {titulo.classificacao && <span className="cf-chip">{titulo.classificacao}</span>}
      {titulo.generos.slice(0, 3).map((genero) => (
        <span key={genero} className="cf-chip cf-chip-ciano">
          {nomeDoGenero(genero)}
        </span>
      ))}
      <span className="cf-chip cf-chip-ouro">{nomeDaOrigem(titulo.origem)}</span>
    </div>
  );
}

function AvisoDeCategorias({
  esperadas,
  fileiras,
  configurada,
}: {
  esperadas: string[];
  fileiras: FileiraDeTitulos[];
  configurada: boolean;
}) {
  const vazias = categoriasSemConteudo(esperadas, fileiras);
  if (!vazias.length) return null;
  return (
    <div className="cf-vazio !text-left">
      <p className="flex items-center gap-2 font-display text-[13px] font-bold text-gelo">
        <Info size={15} className="text-ouro" />
        Ainda sem fonte autorizada
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed">
        {vazias.join(" · ")}. O CopaFlix só mostra conteúdo quando existe uma fonte legal
        configurada — nada é preenchido com link pirata. {configurada
          ? "Cadastre mais títulos no servidor Jellyfin ou no catálogo local para estas categorias aparecerem."
          : "Configure o Jellyfin ou uma lista autorizada para estas categorias aparecerem."}
      </p>
    </div>
  );
}

function CartaoContinuar({
  entrada,
  aoRemover,
}: {
  entrada: Progresso;
  aoRemover: (id: string) => void;
}) {
  const percentual = entrada.duracao
    ? Math.min(100, Math.max(0, (entrada.posicao / entrada.duracao) * 100))
    : 0;
  const consulta = new URLSearchParams({ play: "1" });
  if (entrada.episodioId) consulta.set("ep", entrada.episodioId);

  return (
    <div className="group relative w-[212px] shrink-0 sm:w-[238px]">
      <Link
        href={`/copaflix/titulo/${encodeURIComponent(entrada.id)}?${consulta.toString()}`}
        className="cf-capa-moldura block aspect-video"
        aria-label={`Continuar ${entrada.titulo}`}
      >
        {entrada.capa ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entrada.capa} alt="" aria-hidden loading="lazy" className="cf-capa-foto" />
        ) : (
          <ArteDoApp arte={entrada.arte} />
        )}
        <div className="cf-capa-veu" aria-hidden />
        <span className="absolute top-2 left-2 grid h-8 w-8 place-items-center rounded-full bg-ouro text-fundo shadow-lg">
          <Play size={14} className="ml-0.5 fill-current" />
        </span>
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="line-clamp-1 font-display text-[12.5px] font-bold text-gelo drop-shadow">
            {entrada.titulo}
          </p>
          {entrada.episodioTitulo && (
            <p className="mt-0.5 line-clamp-1 text-[10.5px] text-gelo/75">
              T{entrada.temporada ?? 1}·E{entrada.numero ?? 1} · {entrada.episodioTitulo}
            </p>
          )}
          <div className="progresso-trilho mt-1.5 h-1 overflow-hidden rounded-full">
            <span
              className="progresso-ciano block h-full rounded-full"
              style={{ width: `${percentual}%` }}
            />
          </div>
          <p className="tabular mt-1 text-[10px] font-semibold text-gelo/70">
            {tempoTexto(entrada.posicao)} de {tempoTexto(entrada.duracao)}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => aoRemover(entrada.id)}
        aria-label={`Remover ${entrada.titulo} de continuar assistindo`}
        className="absolute -top-1.5 -right-1.5 hidden h-7 w-7 place-items-center rounded-full border border-borda bg-cartao text-aco group-hover:grid hover:text-gelo"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function PainelFontes({
  acervo,
  aoFechar,
}: {
  acervo: Acervo;
  aoFechar: () => void;
}) {
  const resumo = resumoDoAcervo(acervo);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#000D16]/80 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="copaflix-fontes"
        className="cf-card max-h-[90dvh] w-full max-w-[560px] overflow-y-auto cf-rolagem rounded-b-none p-4 sm:rounded-[22px] sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ciano/15 text-ciano">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0">
            <h2 id="copaflix-fontes" className="font-display text-[16px] font-extrabold text-gelo">
              Fontes autorizadas
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-aco">
              {resumo.filmes} {resumo.filmes === 1 ? "filme" : "filmes"} · {resumo.series}{" "}
              {resumo.series === 1 ? "série" : "séries"} · {resumo.novelas}{" "}
              {resumo.novelas === 1 ? "novela" : "novelas"} · {resumo.canais}{" "}
              {resumo.canais === 1 ? "canal" : "canais"}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="cf-botao-icone ml-auto !h-9 !w-9"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {acervo.fontes.map((fonte: StatusFonte) => (
            <li
              key={fonte.id}
              className="rounded-[14px] border border-borda/80 bg-fundo/50 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    fonte.erro ? "bg-ouro" : fonte.configurada ? "bg-verde" : "bg-discreto"
                  }`}
                  aria-hidden
                />
                <p className="font-display text-[13px] font-bold text-gelo">{fonte.nome}</p>
                <span className="ml-auto text-[11px] font-semibold text-aco">
                  {fonte.erro ? "indisponível" : fonte.configurada ? `${fonte.itens} itens` : "não configurada"}
                </span>
              </div>
              <p className="mt-0.5 pl-4 text-[11.5px] leading-relaxed text-aco">
                {fonte.erro ?? fonte.detalhe ?? ""}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-2 rounded-[14px] border border-borda/70 bg-painel/40 p-3 text-[11.5px] leading-relaxed text-aco">
          <p>
            <b className="text-gelo">Só conteúdo legal.</b> O CopaFlix reproduz domínio público,
            Creative Commons, canais oficiais gratuitos, listas M3U fornecidas pela operação e o
            servidor Jellyfin autorizado. Não há link pirata nem contorno de proteção.
          </p>
          <p>
            <b className="text-gelo">Chaves protegidas.</b> Credenciais de Jellyfin e TMDB ficam
            apenas no servidor. A tela nunca recebe a chave.
          </p>
          <p>
            <b className="text-gelo">Privacidade.</b> Favoritos, histórico e “continuar assistindo”
            ficam somente neste aparelho.
          </p>
        </div>

        {acervo.tmdbAtivo && (
          <p className="mt-3 text-[11px] leading-relaxed text-discreto">{ATRIBUICAO_TMDB}</p>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-discreto">
          Como configurar cada fonte está em <b className="text-aco">docs/COPAFLIX.md</b>. Depois de
          alterar as variáveis, publique de novo — a próxima abertura já usa as fontes novas.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ app */

export default function CopaFlixApp({
  acervo,
  abaInicial = "inicio",
}: {
  acervo: Acervo;
  abaInicial?: AbaCopaFlix;
}) {
  const router = useRouter();
  const local = useCopaFlixLocal();
  const [aba, setAba] = useState<AbaCopaFlix>(abaInicial);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [termo, setTermo] = useState("");
  const [fontesAbertas, setFontesAbertas] = useState(false);
  const [indiceDestaque, setIndiceDestaque] = useState(0);
  const [avisoFonte, setAvisoFonte] = useState<string | null>(null);
  const [canalParaAbrir, setCanalParaAbrir] = useState<Canal | null>(null);

  const destaques = useMemo(() => {
    if (acervo.destaques.length) return acervo.destaques;
    return populares(acervo.titulos, 8);
  }, [acervo]);

  const destaque = destaques[Math.min(indiceDestaque, Math.max(0, destaques.length - 1))];
  const totalFavoritos = local.favoritos.length;

  useEffect(() => {
    // Mantém a aba na URL (link compartilhável) sem recarregar a página.
    const alvo = aba === "inicio" ? "/copaflix" : `/copaflix?aba=${aba}`;
    try {
      window.history.replaceState(null, "", alvo);
    } catch {
      /* alguns WebViews bloqueiam; a navegação continua */
    }
  }, [aba]);

  useEffect(() => {
    if (!buscaAberta) return;
    const esc = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        setBuscaAberta(false);
        setTermo("");
      }
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [buscaAberta]);

  useEffect(() => {
    if (!avisoFonte) return;
    const timer = setTimeout(() => setAvisoFonte(null), 4200);
    return () => clearTimeout(timer);
  }, [avisoFonte]);

  function abrirCanal(canal: Canal) {
    setCanalParaAbrir(canal);
    trocarAba("tv");
  }

  function trocarAba(nova: AbaCopaFlix) {
    setAba(nova);
    setBuscaAberta(false);
    setTermo("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const resultados = useMemo(() => {
    if (!termo.trim()) return { titulos: [] as Titulo[], canais: [] as Canal[] };
    return {
      titulos: buscar(acervo.titulos, termo).slice(0, 60),
      canais: buscarCanais(acervo.canais, termo).slice(0, 30),
    };
  }, [acervo, termo]);

  const buscando = Boolean(termo.trim());

  return (
    <div className="copaflix">
      <div className="cf-halo" aria-hidden />

      <Cabecalho
        logo={LOGO}
        buscaAberta={buscaAberta}
        termo={termo}
        aoMudarTermo={setTermo}
        aoAbrirBusca={() => setBuscaAberta(true)}
        aoFecharBusca={() => {
          setBuscaAberta(false);
          setTermo("");
        }}
        favoritos={totalFavoritos}
        aoAbrirFontes={() => setFontesAbertas(true)}
        abas={ABAS}
        aba={aba}
        aoTrocarAba={trocarAba}
      />

      {avisoFonte && (
        <div className="fixed inset-x-0 top-2 z-[75] mx-auto w-[min(420px,calc(100vw-24px))] rounded-full border border-ouro/45 bg-cartao px-4 py-2 text-center text-[12px] font-semibold text-ouro shadow-xl">
          {avisoFonte}
        </div>
      )}

      <main className="mx-auto w-full max-w-[1180px] px-3 pt-3 pb-28 sm:px-5 sm:pt-4 md:pb-16">
        {buscando ? (
          <section aria-label="Resultados da busca" className="space-y-6">
            <header className="flex items-end justify-between gap-3">
              <div>
                <p className="micro text-aco">Busca</p>
                <h1 className="font-display text-[22px] font-extrabold text-gelo">
                  {resultados.titulos.length + resultados.canais.length}{" "}
                  {resultados.titulos.length + resultados.canais.length === 1
                    ? "resultado"
                    : "resultados"}
                </h1>
              </div>
              <button
                type="button"
                onClick={() => setTermo("")}
                className="cf-botao-fantasma !min-h-[38px] !px-3.5 !text-[12.5px]"
              >
                Limpar
              </button>
            </header>

            {resultados.titulos.length > 0 && (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                {resultados.titulos.map((titulo) => (
                  <Cartaz key={titulo.id} titulo={titulo} largura="w-full" />
                ))}
              </div>
            )}

            {resultados.canais.length > 0 && (
              <div>
                <h2 className="mb-2 font-display text-[17px] font-extrabold text-gelo">Canais ao vivo</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {resultados.canais.map((canal) => (
                    <button
                      key={canal.id}
                      type="button"
                      onClick={() => abrirCanal(canal)}
                      className="cf-canal"
                    >
                      <span className="cf-canal-logo">
                        <Radio size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[13px] font-bold text-gelo">
                          {canal.nome}
                        </span>
                        <span className="block truncate text-[11.5px] text-aco">{canal.categoria}</span>
                      </span>
                      <ChevronRight size={15} className="text-aco" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {resultados.titulos.length + resultados.canais.length === 0 && (
              <div className="cf-vazio">
                <Search size={22} className="mx-auto mb-2 text-aco" />
                <p className="font-display text-[14px] font-bold text-gelo">
                  Nada encontrado para “{termo}”
                </p>
                <p className="mt-1 text-[12.5px]">
                  Tente o nome em português, o ano ou o gênero (terror, comédia, notícias...).
                </p>
              </div>
            )}
          </section>
        ) : (
          <>
            {aba === "inicio" && (
              <div className="space-y-7">
                {destaques.length > 0 && destaque && (
                  <section aria-label="Destaques" className="space-y-4">
                    <Carrossel3D
                      itens={destaques}
                      indice={indiceDestaque}
                      onIndice={setIndiceDestaque}
                      onAbrir={() => {
                        router.push(`/copaflix/titulo/${encodeURIComponent(destaque.id)}?play=1`);
                      }}
                    />

                    <div className="grid gap-4 md:grid-cols-[1.4fr_1fr] md:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="micro text-ciano">Em destaque</span>
                          {destaque.destaque && <Sparkles size={13} className="text-ouro" aria-hidden />}
                        </div>
                        <h1 className="mt-1 font-display text-[clamp(24px,6vw,40px)] leading-[1.03] font-extrabold tracking-tight text-gelo">
                          {destaque.titulo}
                        </h1>
                        <div className="mt-2.5">
                          <EtiquetasDoTitulo titulo={destaque} />
                        </div>
                        <p className="mt-3 line-clamp-3 max-w-[62ch] text-[13.5px] leading-relaxed text-aco">
                          {destaque.sinopse}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <Link
                          href={`/copaflix/titulo/${encodeURIComponent(destaque.id)}?play=1`}
                          className="cf-botao-ouro flex-1 sm:flex-none"
                        >
                          <Play size={17} className="fill-current" /> Assistir
                        </Link>
                        <Link
                          href={`/copaflix/titulo/${encodeURIComponent(destaque.id)}`}
                          className="cf-botao-fantasma flex-1 sm:flex-none"
                        >
                          <Info size={16} /> Detalhes
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            local.alternarFavorito(destaque);
                            setAvisoFonte(
                              local.ehFavorito(destaque.id)
                                ? "Removido da sua lista."
                                : "Adicionado à sua lista.",
                            );
                          }}
                          aria-pressed={local.ehFavorito(destaque.id)}
                          className="cf-botao-icone !h-[46px] !w-[46px]"
                          data-ativo={local.ehFavorito(destaque.id) ? "true" : "false"}
                          aria-label={local.ehFavorito(destaque.id) ? "Remover da minha lista" : "Adicionar à minha lista"}
                        >
                          {local.ehFavorito(destaque.id) ? <Check size={17} /> : <Plus size={17} />}
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {local.continuar.length > 0 && (
                  <section aria-labelledby="continuar-titulo" className="cf-ancora">
                    <header className="mb-2.5 flex items-center justify-between gap-3">
                      <h2
                        id="continuar-titulo"
                        className="font-display text-[clamp(15px,3.6vw,19px)] font-extrabold text-gelo"
                      >
                        Continuar assistindo
                      </h2>
                      <button
                        type="button"
                        onClick={() => trocarAba("continuar")}
                        className="text-[12px] font-semibold text-ciano hover:underline"
                      >
                        Ver tudo
                      </button>
                    </header>
                    <div className="cf-fileira">
                      {local.continuar.slice(0, 8).map((entrada) => (
                        <CartaoContinuar
                          key={entrada.id}
                          entrada={entrada}
                          aoRemover={(id) => {
                            local.esquecer(id);
                            setAvisoFonte("Removido de continuar assistindo.");
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )}

                <Fileira id="inicio-destaque" titulo="Em destaque" itens={destaques} />
                <Fileira id="inicio-filmes" titulo="Filmes" itens={populares(acervo.titulos.filter((t) => t.tipo === "filme"), 14)} />
                <Fileira id="inicio-series" titulo="Séries" itens={populares(acervo.titulos.filter((t) => t.tipo === "serie"), 14)} />
                <Fileira id="inicio-novelas" titulo="Novelas" itens={populares(acervo.titulos.filter((t) => t.tipo === "novela"), 14)} />

                {acervo.canais.length > 0 && (
                  <section className="cf-ancora">
                    <header className="mb-2.5 flex items-center justify-between gap-3">
                      <h2 className="font-display text-[clamp(15px,3.6vw,19px)] font-extrabold text-gelo">
                        TV ao vivo
                      </h2>
                      <button
                        type="button"
                        onClick={() => trocarAba("tv")}
                        className="flex items-center gap-1 text-[12px] font-semibold text-ciano hover:underline"
                      >
                        Ver todos <ArrowRight size={13} />
                      </button>
                    </header>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {acervo.canais.slice(0, 6).map((canal) => (
                        <button
                          key={canal.id}
                          type="button"
                          onClick={() => abrirCanal(canal)}
                          className="cf-canal"
                        >
                          <span className="cf-canal-logo">
                            <Radio size={17} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-display text-[13px] font-bold text-gelo">
                              {canal.nome}
                            </span>
                            <span className="block truncate text-[11.5px] text-aco">
                              {canal.categoria}
                            </span>
                          </span>
                          <span className="h-2 w-2 rounded-full bg-verde" aria-hidden />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {acervo.titulos.length === 0 && (
                  <div className="cf-vazio">
                    <Film size={22} className="mx-auto mb-2 text-aco" />
                    <p className="font-display text-[14px] font-bold text-gelo">
                      Nenhuma fonte configurada ainda
                    </p>
                    <p className="mt-1 text-[12.5px] leading-relaxed">
                      Configure o Jellyfin, a lista M3U autorizada ou ligue o catálogo de
                      demonstração. O passo a passo está em <b className="text-gelo">docs/COPAFLIX.md</b>.
                    </p>
                  </div>
                )}
              </div>
            )}

            {aba === "filmes" && (
              <div className="space-y-6">
                <CabecalhoDeAba
                  titulo="Filmes"
                  descricao="Em destaque, mais populares e por gênero."
                  icone={<Film size={16} />}
                />
                {fileirasDeFilmes(acervo.titulos).map((fileira) => (
                  <Fileira key={fileira.id} id={fileira.id} titulo={fileira.titulo} itens={fileira.itens} />
                ))}
                <AvisoDeCategorias
                  esperadas={CATEGORIAS_ESPERADAS.filmes}
                  fileiras={fileirasDeFilmes(acervo.titulos)}
                  configurada={acervo.fontes.some((f) => f.configurada && f.id !== "tmdb")}
                />
              </div>
            )}

            {aba === "series" && (
              <div className="space-y-6">
                <CabecalhoDeAba
                  titulo="Séries"
                  descricao="Temporadas e episódios na ficha de cada série."
                  icone={<Tv size={16} />}
                />
                {fileirasDeSeries(acervo.titulos).map((fileira) => (
                  <Fileira key={fileira.id} id={fileira.id} titulo={fileira.titulo} itens={fileira.itens} />
                ))}
                <AvisoDeCategorias
                  esperadas={CATEGORIAS_ESPERADAS.series}
                  fileiras={fileirasDeSeries(acervo.titulos)}
                  configurada={acervo.fontes.some((f) => f.configurada && f.id !== "tmdb")}
                />
              </div>
            )}

            {aba === "novelas" && (
              <div className="space-y-6">
                <CabecalhoDeAba
                  titulo="Novelas"
                  descricao="Brasileiras, internacionais e clássicas — só com fonte autorizada."
                  icone={<Heart size={16} />}
                />
                {fileirasDeNovelas(acervo.titulos).map((fileira) => (
                  <Fileira key={fileira.id} id={fileira.id} titulo={fileira.titulo} itens={fileira.itens} />
                ))}
                {acervo.titulos.filter((t) => t.tipo === "novela").length === 0 && (
                  <div className="cf-vazio !text-left">
                    <p className="font-display text-[14px] font-bold text-gelo">
                      Nenhuma novela com fonte autorizada
                    </p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed">
                      Novelas completas raramente são liberadas para distribuição gratuita. O
                      caminho legal é usar a biblioteca Jellyfin com arquivos que a operação possui
                      ou uma lista M3U de um serviço autorizado. Assim que houver fonte, a novela
                      aparece aqui automaticamente, com temporadas e episódios.
                    </p>
                    <p className="mt-2 text-[11.5px] text-discreto">
                      Categorias: novelas brasileiras · novelas internacionais · novelas clássicas.
                    </p>
                  </div>
                )}
              </div>
            )}

            {aba === "tv" && (
              <div className="space-y-4">
                <CabecalhoDeAba
                  titulo="TV ao vivo"
                  descricao="Canais organizados por categoria, busca e guia de programação."
                  icone={<Radio size={16} />}
                />
                <TvAoVivo canaisIniciais={acervo.canais} canalInicial={canalParaAbrir} />
              </div>
            )}

            {aba === "favoritos" && (
              <div className="space-y-4">
                <CabecalhoDeAba
                  titulo="Favoritos"
                  descricao="Sua lista, guardada somente neste aparelho."
                  icone={<Bookmark size={16} />}
                />
                {local.favoritos.length === 0 ? (
                  <div className="cf-vazio">
                    <Bookmark size={22} className="mx-auto mb-2 text-aco" />
                    <p className="font-display text-[14px] font-bold text-gelo">
                      Sua lista está vazia
                    </p>
                    <p className="mt-1 text-[12.5px]">
                      Toque no <b className="text-gelo">+</b> na ficha de um título para guardá-lo aqui.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                    {local.favoritos.map((favorito) => {
                      const titulo = acervo.titulos.find((t) => t.id === favorito.id);
                      return titulo ? (
                        <Cartaz key={favorito.id} titulo={titulo} largura="w-full" />
                      ) : (
                        <div key={favorito.id} className="cf-vazio !px-2 !py-4 !text-[11px]">
                          {favorito.titulo}
                          <span className="mt-1 block text-[10px] text-discreto">
                            fonte removida
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {aba === "continuar" && (
              <div className="space-y-4">
                <CabecalhoDeAba
                  titulo="Continuar assistindo"
                  descricao="De onde você parou, neste aparelho."
                  icone={<Clock size={16} />}
                />
                {local.continuar.length === 0 ? (
                  <div className="cf-vazio">
                    <Clock size={22} className="mx-auto mb-2 text-aco" />
                    <p className="font-display text-[14px] font-bold text-gelo">
                      Nada em andamento
                    </p>
                    <p className="mt-1 text-[12.5px]">
                      Comece um filme ou episódio: o CopaFlix guarda a posição e retoma de onde parou.
                    </p>
                  </div>
                ) : (
                  <div className="cf-fileira !flex-wrap">
                    {local.continuar.map((entrada) => (
                      <CartaoContinuar key={entrada.id} entrada={entrada} aoRemover={(id) => local.esquecer(id)} />
                    ))}
                  </div>
                )}

                {local.historico.length > 0 && (
                  <section className="mt-7">
                    <header className="mb-2.5 flex items-center justify-between gap-3">
                      <h2 className="font-display text-[17px] font-extrabold text-gelo">Histórico</h2>
                      <button
                        type="button"
                        onClick={() => {
                          local.limparHistorico();
                          setAvisoFonte("Histórico apagado deste aparelho.");
                        }}
                        className="text-[12px] font-semibold text-aco hover:text-gelo"
                      >
                        Limpar histórico
                      </button>
                    </header>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {local.historico.slice(0, 12).map((item) => {
                        const Icone =
                          item.tipo === "serie" ? Tv : item.tipo === "novela" ? Heart : Film;
                        return (
                          <li key={item.id}>
                            <Link
                              href={`/copaflix/titulo/${encodeURIComponent(item.id)}`}
                              className="cf-canal"
                            >
                              <span className="cf-canal-logo">
                                <Icone size={17} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-display text-[13px] font-bold text-gelo">
                                  {item.titulo}
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-aco">
                                  {NOME_TIPO[item.tipo]} · {quando(item.em)}
                                </span>
                              </span>
                              <ChevronRight size={15} className="text-aco" aria-hidden />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-[11px] leading-relaxed text-discreto">
                      O histórico fica somente neste aparelho e pode ser apagado a qualquer momento.
                    </p>
                  </section>
                )}
              </div>
            )}
          </>
        )}

        <footer className="mt-8 space-y-2 border-t border-borda/60 pt-4">
          <p className="text-[11px] leading-relaxed text-discreto">
            CopaFlix é uma seção do CopaLinks. Catálogo de demonstração com obras em domínio público
            (Internet Archive) e Creative Commons (Blender Foundation, com atribuição). Canais
            oficiais podem ter bloqueio por país.{" "}
            {acervo.tmdbAtivo && ATRIBUICAO_TMDB}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <button
              type="button"
              onClick={() => setFontesAbertas(true)}
              className="flex items-center gap-1 font-semibold text-aco hover:text-gelo"
            >
              <ShieldCheck size={12} /> Fontes e licenças
            </button>
            <Link href="/" className="flex items-center gap-1 font-semibold text-aco hover:text-gelo">
              <ArrowLeft size={12} /> Voltar ao CopaLinks
            </Link>
            <span className="ml-auto text-discreto">
              Atualizado em{" "}
              {acervo.atualizadoEm
                ? new Date(acervo.atualizadoEm).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Sao_Paulo",
                  })
                : "—"}
            </span>
          </div>
        </footer>
      </main>

      <nav className="cf-rodape md:hidden" aria-label="Navegação do CopaFlix">
        <div className="mx-auto grid w-full max-w-[1180px] grid-cols-6 px-2">
          {ABAS_RODAPE.map((id) => {
            const item = porId(id);
            const Icone = item.icone;
            return (
              <button
                key={id}
                type="button"
                onClick={() => trocarAba(id)}
                className="cf-rodape-item"
                data-ativa={aba === id ? "true" : "false"}
                aria-current={aba === id ? "page" : undefined}
              >
                <Icone size={20} strokeWidth={2} />
                <span>{item.rotuloCurto}</span>
                <span className="cf-rodape-ponto" aria-hidden />
              </button>
            );
          })}
        </div>
      </nav>

      {fontesAbertas && <PainelFontes acervo={acervo} aoFechar={() => setFontesAbertas(false)} />}
    </div>
  );
}

function CabecalhoDeAba({
  titulo,
  descricao,
  icone,
}: {
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ciano/12 text-ciano">
        {icone}
      </span>
      <div className="min-w-0">
        <h1 className="font-display text-[clamp(20px,5vw,26px)] leading-tight font-extrabold text-gelo">
          {titulo}
        </h1>
        <p className="text-[12px] text-aco">{descricao}</p>
      </div>
      <span className="cf-linha-brilho ml-auto hidden w-24 self-end sm:block" aria-hidden />
    </header>
  );
}
