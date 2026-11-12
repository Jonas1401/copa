import type {
  Acervo,
  Canal,
  Episodio,
  Fileira,
  OrigemConteudo,
  Titulo,
  TipoTitulo,
} from "./tipos";

/**
 * Catálogo de DEMONSTRAÇÃO do CopaFlix.
 *
 * Aqui só entram obras que podem ser distribuídas legalmente:
 *   - domínio público (filmes clássicos no Internet Archive);
 *   - Creative Commons (curtas do Blender Open Movies, com crédito);
 *   - canais oficiais com transmissão pública gratuita (podem ter bloqueio
 *     geográfico ou sair do ar — o player avisa quando isso acontece).
 *
 * Nada de lista pirata, link de site protegido ou vídeo extraído à força.
 * Para conteúdo próprio, use as fontes autorizadas (M3U e Jellyfin) descritas
 * em docs/COPAFLIX.md. As categorias sem fonte válida aparecem vazias, com
 * instrução — nunca com conteúdo inventado.
 */

/** Atribuição obrigatória ao usar dados/cartazes do TMDB. */
export const ATRIBUICAO_TMDB =
  "Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.";

/** Gêneros canônicos: a chave é o que vai no dado; o nome é o que a tela mostra. */
export const GENEROS: Record<string, string> = {
  acao: "Ação",
  animacao: "Animação",
  aventura: "Aventura",
  classico: "Clássicos",
  comedia: "Comédia",
  crime: "Crime",
  documentario: "Documentários",
  drama: "Drama",
  educacao: "Educação",
  entretenimento: "Entretenimento",
  esportes: "Esportes",
  fantasia: "Fantasia",
  ficcao: "Ficção científica",
  infantil: "Infantil",
  noticias: "Notícias",
  romance: "Romance",
  terror: "Terror",
  cultura: "Cultura",
  brasileira: "Novelas brasileiras",
  internacional: "Novelas internacionais",
};

export function nomeDoGenero(chave: string) {
  return GENEROS[chave] ?? chave;
}

const ORIGEM: Record<OrigemConteudo, string> = {
  "dominio-publico": "Domínio público",
  "creative-commons": "Creative Commons",
  "catalogo-local": "Catálogo local",
  jellyfin: "Biblioteca Jellyfin",
};

export function nomeDaOrigem(origem: OrigemConteudo) {
  return ORIGEM[origem];
}

/* ---------------------------------------------------------------- vídeos
   Fontes verificadas uma a uma (o balde de amostras do Google, usado antes,
   passou a responder HTTP 403 para todos os arquivos e foi abandonado).
   Cada título tem um espelho em `fontesAlternativas`: se a primeira fonte
   falhar no aparelho, o player tenta a seguinte sozinho.
   As capas vêm do próprio item do Internet Archive (`services/img/<id>`), com
   queda para a arte do app se a imagem não existir. */
const IA = "https://archive.org/download";
const IA_CAPA = "https://archive.org/services/img";
const BLENDER_TOS = "https://download.blender.org/demo/movies/ToS";
const MUX_BBB = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const CREDITO_BLENDER =
  "Blender Foundation · CC BY 3.0 (atribuição obrigatória) · espelho no Internet Archive";
const CREDITO_DOMINIO = "Domínio público · Internet Archive · capa do próprio acervo";

const CAPA_NOSFERATU = `${IA_CAPA}/nosferatu`;
const CAPA_MORTOS = `${IA_CAPA}/night_of_the_living_dead`;
const CAPA_PLANO9 = `${IA_CAPA}/Plan9FromOuterSpace_`;
const CAPA_BBB = `${IA_CAPA}/BigBuckBunny_124`;
const CAPA_SINTEL = `${IA_CAPA}/Sintel`;
const CAPA_ELEFANTES = `${IA_CAPA}/ElephantsDream`;

const FONTE_NOSFERATU = {
  tipo: "arquivo" as const,
  url: `${IA}/nosferatu/nosferatu_512kb.mp4`,
  mime: "video/mp4",
  rotulo: "Internet Archive",
};
const FONTE_MORTOS = {
  tipo: "arquivo" as const,
  url: `${IA}/night_of_the_living_dead/night_of_the_living_dead_512kb.mp4`,
  mime: "video/mp4",
  rotulo: "Internet Archive",
};
const FONTE_PLANO9 = {
  tipo: "arquivo" as const,
  url: `${IA}/Plan9FromOuterSpace_/Plan9FromOuterSpace_512kb.mp4`,
  mime: "video/mp4",
  rotulo: "Internet Archive",
};
const FONTE_BBB = {
  tipo: "arquivo" as const,
  url: `${IA}/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4`,
  mime: "video/mp4",
  rotulo: "Internet Archive",
};
const FONTE_SINTEL = {
  tipo: "arquivo" as const,
  url: `${IA}/Sintel/sintel-2048-surround.mp4`,
  mime: "video/mp4",
  rotulo: "Internet Archive",
};
const FONTE_ELEFANTES = {
  tipo: "arquivo" as const,
  url: `${IA}/ElephantsDream/ed_hd.mp4`,
  mime: "video/mp4",
  rotulo: "Internet Archive",
};
const FONTE_TOS = {
  tipo: "arquivo" as const,
  url: `${BLENDER_TOS}/tears_of_steel_720p.mov`,
  mime: "video/quicktime",
  rotulo: "Blender Foundation",
};
const ALTERNATIVA_BBB = { tipo: "hls" as const, url: MUX_BBB, rotulo: "Mux (HLS)" };
const ALTERNATIVA_TOS = {
  tipo: "arquivo" as const,
  url: `${BLENDER_TOS}/tears_of_steel_surround.webm`,
  mime: "video/webm",
  rotulo: "Blender (WebM)",
};

export const DEMONSTRACAO: Titulo[] = [
  {
    id: "nosferatu-1922",
    tipo: "filme",
    titulo: "Nosferatu",
    tituloOriginal: "Nosferatu, eine Symphonie des Grauens",
    ano: 1922,
    sinopse:
      "Clássico expressionista do cinema mudo: um corretor de imóveis viaja até um castelo nos Cárpatos e traz, sem saber, uma sombra que se instala na cidade.",
    generos: ["terror", "classico", "fantasia"],
    duracaoMin: 94,
    classificacao: "12",
    arte: 2,
    capa: CAPA_NOSFERATU,
    fonte: FONTE_NOSFERATU,
    origem: "dominio-publico",
    credito: CREDITO_DOMINIO,
    popularidade: 82,
    destaque: true,
  },
  {
    id: "noite-dos-mortos-vivos-1968",
    tipo: "filme",
    titulo: "A Noite dos Mortos-Vivos",
    tituloOriginal: "Night of the Living Dead",
    ano: 1968,
    sinopse:
      "Um grupo se refugia numa casa isolada enquanto mortos caminham pelo interior. O marco moderno do cinema de zumbi, em domínio público nos Estados Unidos.",
    generos: ["terror", "classico", "drama"],
    duracaoMin: 96,
    classificacao: "16",
    arte: 3,
    capa: CAPA_MORTOS,
    fonte: FONTE_MORTOS,
    origem: "dominio-publico",
    credito: CREDITO_DOMINIO,
    popularidade: 71,
    destaque: true,
  },
  {
    id: "plano-9-1959",
    tipo: "filme",
    titulo: "Plano 9 do Espaço Sideral",
    tituloOriginal: "Plan 9 from Outer Space",
    ano: 1959,
    sinopse:
      "Aliens tentam impedir a humanidade de destruir o universo despertando mortos. Um clássico cult da ficção científica de baixo orçamento.",
    generos: ["ficcao", "classico", "terror"],
    duracaoMin: 79,
    classificacao: "12",
    arte: 4,
    capa: CAPA_PLANO9,
    fonte: FONTE_PLANO9,
    origem: "dominio-publico",
    credito: CREDITO_DOMINIO,
    popularidade: 58,
    destaque: false,
  },
  {
    id: "big-buck-bunny-2008",
    tipo: "filme",
    titulo: "Big Buck Bunny",
    ano: 2008,
    sinopse:
      "Curta de animação do Blender: um coelho grande e tranquilo decide reagir aos três roedores que atormentam a floresta. Marco do cinema aberto.",
    generos: ["animacao", "comedia", "infantil"],
    duracaoMin: 10,
    classificacao: "L",
    arte: 0,
    capa: CAPA_BBB,
    fonte: FONTE_BBB,
    fontesAlternativas: [ALTERNATIVA_BBB],
    origem: "creative-commons",
    credito: CREDITO_BLENDER,
    popularidade: 90,
    destaque: true,
  },
  {
    id: "sintel-2010",
    tipo: "filme",
    titulo: "Sintel",
    ano: 2010,
    sinopse:
      "Uma jovem atravessa um mundo hostil à procura do dragão que criou. Curta do Blender Open Movie, referência de animação livre.",
    generos: ["animacao", "fantasia", "aventura"],
    duracaoMin: 15,
    classificacao: "10",
    arte: 1,
    capa: CAPA_SINTEL,
    fonte: FONTE_SINTEL,
    origem: "creative-commons",
    credito: CREDITO_BLENDER,
    popularidade: 88,
    destaque: true,
  },
  {
    id: "elephants-dream-2006",
    tipo: "filme",
    titulo: "Elephants Dream",
    ano: 2006,
    sinopse:
      "Dois personagens percorrem uma máquina surreal. Foi o primeiro filme aberto produzido pelo Blender, com todo o material sob licença livre.",
    generos: ["animacao", "ficcao", "classico"],
    duracaoMin: 11,
    classificacao: "10",
    arte: 5,
    capa: CAPA_ELEFANTES,
    fonte: FONTE_ELEFANTES,
    origem: "creative-commons",
    credito: CREDITO_BLENDER,
    popularidade: 64,
    destaque: false,
  },
  {
    id: "tears-of-steel-2012",
    tipo: "filme",
    titulo: "Tears of Steel",
    ano: 2012,
    sinopse:
      "Num futuro devastado por máquinas, um grupo tenta reconstruir um momento do passado. Ficção científica do Blender com efeitos práticos e digitais.",
    generos: ["ficcao", "acao", "drama"],
    duracaoMin: 12,
    classificacao: "12",
    arte: 4,
    fonte: FONTE_TOS,
    fontesAlternativas: [ALTERNATIVA_TOS],
    origem: "creative-commons",
    credito: CREDITO_BLENDER,
    popularidade: 76,
    destaque: true,
  },
  {
    id: "teste-hls",
    tipo: "filme",
    titulo: "Teste de transmissão HLS",
    ano: 2008,
    sinopse:
      "O mesmo curta aberto do Blender servido em HLS (.m3u8), exatamente no formato usado por canais ao vivo. Serve para conferir o player no seu aparelho.",
    generos: ["animacao", "comedia", "documentario"],
    duracaoMin: 10,
    classificacao: "L",
    arte: 0,
    fonte: { tipo: "hls", url: MUX_BBB, rotulo: "Mux (HLS)" },
    origem: "creative-commons",
    credito: `${CREDITO_BLENDER} · fluxo de teste público (Mux)`,
    popularidade: 40,
    destaque: false,
  },
  {
    id: "blender-open-movies",
    tipo: "serie",
    titulo: "Blender Open Movies",
    ano: 2006,
    sinopse:
      "Coleção de curtas abertos do Blender Institute: animação, ficção científica e fantasia com arquivos e personagens livres. Cada episódio traz seu próprio crédito.",
    generos: ["animacao", "ficcao", "fantasia"],
    classificacao: "L",
    arte: 1,
    origem: "creative-commons",
    credito: CREDITO_BLENDER,
    popularidade: 69,
    destaque: true,
    temporadas: 1,
    capa: CAPA_BBB,
    fonte: FONTE_BBB,
    fontesAlternativas: [ALTERNATIVA_BBB],
    episodios: [
      {
        id: "blender-open-movies-t1e1",
        titulo: "Big Buck Bunny",
        temporada: 1,
        numero: 1,
        duracaoMin: 10,
        sinopse: "Um coelho gentil enfrenta três roedores travessos.",
        fonte: FONTE_BBB,
        fontesAlternativas: [ALTERNATIVA_BBB],
      },
      {
        id: "blender-open-movies-t1e2",
        titulo: "Elephants Dream",
        temporada: 1,
        numero: 2,
        duracaoMin: 11,
        sinopse: "Dois personagens dentro de uma máquina surreal.",
        fonte: FONTE_ELEFANTES,
      },
      {
        id: "blender-open-movies-t1e3",
        titulo: "Sintel",
        temporada: 1,
        numero: 3,
        duracaoMin: 15,
        sinopse: "Uma jovem caça o dragão que mudou a sua vida.",
        fonte: FONTE_SINTEL,
      },
      {
        id: "blender-open-movies-t1e4",
        titulo: "Tears of Steel",
        temporada: 1,
        numero: 4,
        duracaoMin: 12,
        sinopse: "Um grupo tenta salvar o futuro revivendo o passado.",
        fonte: FONTE_TOS,
        fontesAlternativas: [ALTERNATIVA_TOS],
      },
    ],
  },
];

/**
 * Canais oficiais com transmissão pública gratuita. São exemplos de
 * DEMONSTRAÇÃO: a disponibilidade depende da emissora (bloqueio por país e
 * mudança de endereço são normais). Para os canais da operação, configure
 * uma lista M3U autorizada (ver docs/COPAFLIX.md).
 */
export const CANAIS_DEMONSTRACAO: Canal[] = [
  {
    id: "nasa-tv",
    nome: "NASA TV",
    categoria: "Canais públicos",
    tvgId: "nasa.tv",
    fonte: {
      tipo: "hls",
      url: "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
    },
    origem: "catalogo-local",
    credito: "NASA · conteúdo em domínio público",
  },
  {
    id: "dw-english",
    nome: "DW English",
    categoria: "Notícias",
    tvgId: "dw.en",
    fonte: {
      tipo: "hls",
      url: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8",
    },
    origem: "catalogo-local",
    credito: "Deutsche Welle · transmissão pública oficial",
  },
  {
    id: "al-jazeera-english",
    nome: "Al Jazeera English",
    categoria: "Notícias",
    tvgId: "aje.en",
    fonte: {
      tipo: "hls",
      url: "https://live-hls-web-aje.getaj.net/AJE/index.m3u8",
    },
    origem: "catalogo-local",
    credito: "Al Jazeera · transmissão pública oficial",
  },
  {
    id: "france-24-english",
    nome: "France 24 English",
    categoria: "Notícias",
    tvgId: "france24.en",
    fonte: {
      tipo: "hls",
      url: "https://static.france24.com/live/F24_EN_LO_HLS/live_web.m3u8",
    },
    origem: "catalogo-local",
    credito: "France 24 · transmissão pública oficial",
  },
];

export type OpcoesMontagem = {
  /** Inclui o catálogo de demonstração (domínio público / Creative Commons). */
  demo?: boolean;
};

/**
 * Junta o catálogo de demonstração com o que veio das fontes autorizadas,
 * sem repetir id (a fonte configurada ganha do exemplo).
 */
export function montarCatalogo(extras: Titulo[] = [], opcoes: OpcoesMontagem = {}): Titulo[] {
  const demo = opcoes.demo === false ? [] : DEMONSTRACAO;
  const porId = new Map<string, Titulo>();
  for (const titulo of demo) porId.set(titulo.id, titulo);
  for (const titulo of extras) porId.set(titulo.id, titulo);
  return [...porId.values()];
}

export function montarCanais(extras: Canal[] = [], opcoes: OpcoesMontagem = {}): Canal[] {
  const demo = opcoes.demo === false ? [] : CANAIS_DEMONSTRACAO;
  const porId = new Map<string, Canal>();
  for (const canal of demo) porId.set(canal.id, canal);
  for (const canal of extras) porId.set(canal.id, canal);
  return [...porId.values()];
}

/* ------------------------------------------------------------- consultas */

export function porTipo(titulos: Titulo[], tipo: TipoTitulo) {
  return titulos.filter((t) => t.tipo === tipo);
}

export function porGenero(titulos: Titulo[], genero: string) {
  return titulos.filter((t) => t.generos.includes(genero));
}

export function populares(titulos: Titulo[], limite = 12) {
  return [...titulos]
    .sort((a, b) => (b.popularidade ?? 0) - (a.popularidade ?? 0))
    .slice(0, limite);
}

export function destaquesDe(titulos: Titulo[], limite = 8) {
  const marcados = titulos.filter((t) => t.destaque);
  const base = marcados.length ? marcados : populares(titulos, limite);
  return base.slice(0, limite);
}

/** Busca por nome, sinopse e gênero — sem diferenciar maiúsculas ou acentos. */
export function buscar(titulos: Titulo[], termo: string) {
  const alvo = normalizar(termo);
  if (!alvo) return titulos;
  return titulos.filter((t) => {
    const texto = normalizar(
      [
        t.titulo,
        t.tituloOriginal ?? "",
        t.sinopse,
        t.generos.map(nomeDoGenero).join(" "),
        String(t.ano ?? ""),
      ].join(" "),
    );
    return alvo.split(/\s+/).every((parte) => texto.includes(parte));
  });
}

export function buscarCanais(canais: Canal[], termo: string) {
  const alvo = normalizar(termo);
  if (!alvo) return canais;
  return canais.filter((c) => normalizar(`${c.nome} ${c.categoria}`).includes(alvo));
}

export function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ---------------------------------------------------------------- fileiras */

function fileira(id: string, titulo: string, itens: Titulo[]): Fileira | null {
  if (!itens.length) return null;
  return { id, titulo, itens };
}

const soLista = (f: (Fileira | null)[]) => f.filter((x): x is Fileira => x !== null);

export function fileirasDeFilmes(titulos: Titulo[]): Fileira[] {
  const filmes = porTipo(titulos, "filme");
  return soLista([
    fileira("filmes-destaque", "Em destaque", destaquesDe(filmes)),
    fileira("filmes-populares", "Mais populares", populares(filmes)),
    fileira("filmes-acao", "Ação", porGenero(filmes, "acao")),
    fileira("filmes-comedia", "Comédia", porGenero(filmes, "comedia")),
    fileira("filmes-terror", "Terror", porGenero(filmes, "terror")),
    fileira("filmes-romance", "Romance", porGenero(filmes, "romance")),
    fileira("filmes-ficcao", "Ficção científica", porGenero(filmes, "ficcao")),
    fileira("filmes-documentario", "Documentários", porGenero(filmes, "documentario")),
    fileira("filmes-classicos", "Filmes clássicos", porGenero(filmes, "classico")),
    fileira("filmes-animacao", "Animação", porGenero(filmes, "animacao")),
  ]);
}

export function fileirasDeSeries(titulos: Titulo[]): Fileira[] {
  const series = porTipo(titulos, "serie");
  return soLista([
    fileira("series-destaque", "Séries em destaque", destaquesDe(series)),
    fileira("series-populares", "Mais populares", populares(series)),
    fileira("series-drama", "Drama", porGenero(series, "drama")),
    fileira("series-comedia", "Comédia", porGenero(series, "comedia")),
    fileira("series-ficcao", "Ficção científica", porGenero(series, "ficcao")),
    fileira("series-terror", "Terror", porGenero(series, "terror")),
    fileira("series-animacao", "Animação", porGenero(series, "animacao")),
  ]);
}

export function fileirasDeNovelas(titulos: Titulo[]): Fileira[] {
  const novelas = porTipo(titulos, "novela");
  return soLista([
    fileira("novelas-destaque", "Novelas em destaque", destaquesDe(novelas)),
    fileira("novelas-populares", "Mais populares", populares(novelas)),
    fileira("novelas-brasileiras", "Novelas brasileiras", porGenero(novelas, "brasileira")),
    fileira("novelas-internacionais", "Novelas internacionais", porGenero(novelas, "internacional")),
    fileira("novelas-classicas", "Novelas clássicas", porGenero(novelas, "classico")),
  ]);
}

/**
 * Categorias pedidas para cada aba. A tela usa esta lista para avisar, com
 * honestidade, quais ainda não têm nenhum título de fonte autorizada.
 */
export const CATEGORIAS_ESPERADAS: Record<"filmes" | "series" | "novelas", string[]> = {
  filmes: [
    "Em destaque",
    "Mais populares",
    "Ação",
    "Comédia",
    "Terror",
    "Romance",
    "Ficção científica",
    "Documentários",
    "Filmes clássicos",
  ],
  series: [
    "Séries em destaque",
    "Mais populares",
    "Drama",
    "Comédia",
    "Terror",
    "Ficção científica",
    "Animação",
  ],
  novelas: ["Novelas brasileiras", "Novelas internacionais", "Novelas clássicas"],
};

/** Fileiras esperadas que ficaram vazias (sem fonte autorizada ainda). */
export function categoriasSemConteudo(
  esperadas: string[],
  fileiras: Fileira[],
): string[] {
  const presentes = new Set(fileiras.map((f) => normalizar(f.titulo)));
  return esperadas.filter((nome) => !presentes.has(normalizar(nome)));
}

/* -------------------------------------------------------------- episódios */

export function temporadasDe(titulo: Titulo): number[] {
  const temporadas = new Set<number>();
  for (const ep of titulo.episodios ?? []) temporadas.add(ep.temporada);
  return [...temporadas].sort((a, b) => a - b);
}

export function episodiosDaTemporada(titulo: Titulo, temporada: number): Episodio[] {
  return (titulo.episodios ?? [])
    .filter((ep) => ep.temporada === temporada)
    .sort((a, b) => a.numero - b.numero);
}

/** Próximo episódio depois de `episodioId` (na mesma temporada ou na seguinte). */
export function proximoEpisodio(titulo: Titulo, episodioId?: string | null): Episodio | null {
  const lista = [...(titulo.episodios ?? [])].sort(
    (a, b) => a.temporada - b.temporada || a.numero - b.numero,
  );
  if (!lista.length) return null;
  if (!episodioId) return lista[0];
  const i = lista.findIndex((ep) => ep.id === episodioId);
  if (i < 0) return lista[0];
  return lista[i + 1] ?? null;
}

/** "1h 32min" / "12min" — usado nas fichas e nas capas. */
export function duracaoTexto(minutos?: number) {
  if (!minutos || minutos <= 0) return "";
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

/** "1h 04min 12s" a partir dos segundos do player (para "Continuar assistindo"). */
export function tempoTexto(segundos: number) {
  const total = Math.max(0, Math.round(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m) return `${m}min ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Agrupa os canais na ordem em que aparecem, mantendo a categoria declarada. */
export function categoriasDeCanais(canais: Canal[]): { categoria: string; canais: Canal[] }[] {
  const mapa = new Map<string, Canal[]>();
  for (const canal of canais) {
    const chave = canal.categoria?.trim() || "Geral";
    const lista = mapa.get(chave);
    if (lista) lista.push(canal);
    else mapa.set(chave, [canal]);
  }
  return [...mapa.entries()]
    .map(([categoria, lista]) => ({ categoria, canais: lista }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR"));
}

/** Resumo para a tela de fontes (nunca inclui chaves ou endereços privados). */
export function resumoDoAcervo(acervo: Acervo) {
  const porTipoContagem = acervo.titulos.reduce<Record<string, number>>((acc, t) => {
    acc[t.tipo] = (acc[t.tipo] ?? 0) + 1;
    return acc;
  }, {});
  return {
    filmes: porTipoContagem.filme ?? 0,
    series: porTipoContagem.serie ?? 0,
    novelas: porTipoContagem.novela ?? 0,
    canais: acervo.canais.length,
  };
}
