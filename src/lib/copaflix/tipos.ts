/**
 * COPAFLIX — tipos do módulo de entretenimento do CopaLinks.
 *
 * Tudo aqui é serializável: o servidor monta o acervo (catálogo local +
 * fontes autorizadas) e entrega pronto para a tela, que funciona no celular,
 * no tablet, no computador e no app instalado (PWA).
 */

/** O que a capa representa. */
export type TipoTitulo = "filme" | "serie" | "novela";

/** Como o vídeo chega ao player. */
export type TipoMidia = "hls" | "arquivo" | "jellyfin" | "externo";

/**
 * Uma fonte de mídia autorizada.
 *   hls      → playlist .m3u8 (reproduzida com hls.js, ou nativa no Safari)
 *   arquivo  → MP4/WebM servido por quem tem o direito de distribuir
 *   jellyfin → item de um servidor Jellyfin do próprio usuário (proxy no app)
 *   externo  → só um link para o site oficial (nunca embutimos o vídeo)
 */
export type FonteMidia = {
  tipo: TipoMidia;
  /** Endereço público da mídia (hls/arquivo). Não é usado em jellyfin/externo. */
  url?: string;
  /** Id do item no servidor Jellyfin configurado. */
  itemId?: string;
  /** Dica de MIME para o elemento <video> (opcional). */
  mime?: string;
  /** Nome do serviço quando a reprodução é externa. */
  provedor?: string;
};

/** De onde o título veio — mostrado na ficha, sem prometer o que não temos. */
export type OrigemConteudo =
  | "dominio-publico"
  | "creative-commons"
  | "catalogo-local"
  | "jellyfin";

/** Um episódio de série/novela. */
export type Episodio = {
  id: string;
  titulo: string;
  temporada: number;
  numero: number;
  duracaoMin?: number;
  sinopse?: string;
  fonte?: FonteMidia;
  /** Item do Jellyfin de onde o episódio veio (informativo). */
  referencia?: string;
};

/** Filme, série ou novela. */
export type Titulo = {
  id: string;
  tipo: TipoTitulo;
  titulo: string;
  tituloOriginal?: string;
  ano?: number;
  sinopse: string;
  /** Chaves canônicas de gênero (ver GENEROS em catalogo.ts). */
  generos: string[];
  duracaoMin?: number;
  classificacao?: string;
  /** Cartaz autorizado (ex.: TMDB ou Jellyfin). Sem ele, usamos a arte do app. */
  capa?: string;
  /** Imagem larga para o banner de destaque. */
  fundo?: string;
  /** Semente da arte procedural (0 a 5) quando não há cartaz. */
  arte?: number;
  /** Fonte principal (filme, ou episódio 1 da série). */
  fonte?: FonteMidia;
  episodios?: Episodio[];
  origem: OrigemConteudo;
  /** Texto de crédito/licença mostrado na ficha (ex.: "CC BY 3.0 — Blender"). */
  credito?: string;
  /** Peso na fileira "Mais populares" (0 a 100). */
  popularidade?: number;
  destaque?: boolean;
  /** Série/novela: quantas temporadas existem. */
  temporadas?: number;
};

/** Canal de TV ao vivo (playlist M3U/M3U8 autorizada). */
export type Canal = {
  id: string;
  nome: string;
  /** Categoria declarada na lista (group-title) ou "Geral". */
  categoria: string;
  logo?: string;
  fonte: FonteMidia;
  /** tvg-id: usado para casar com o guia de programação (EPG). */
  tvgId?: string;
  origem: "m3u" | "catalogo-local";
  credito?: string;
};

/** Uma faixa horizontal de capas ("Em destaque", "Terror", ...). */
export type Fileira = {
  id: string;
  titulo: string;
  itens: Titulo[];
};

/** Situação de cada fonte autorizada — sem nunca expor chaves ou tokens. */
export type StatusFonte = {
  id: "catalogo-local" | "m3u" | "jellyfin" | "tmdb";
  nome: string;
  configurada: boolean;
  itens: number;
  /** Explicação curta (ex.: "2 listas configuradas"). */
  detalhe?: string;
  erro?: string;
};

/** Payload completo enviado do servidor para a tela. */
export type Acervo = {
  titulos: Titulo[];
  canais: Canal[];
  destaques: Titulo[];
  fontes: StatusFonte[];
  /** O catálogo de demonstração (domínio público/CC) está ligado. */
  demoAtivo: boolean;
  /** O servidor tem chave do TMDB configurada (só para atribuição na tela). */
  tmdbAtivo: boolean;
  atualizadoEm: string;
};

/** Programa do guia eletrônico (EPG) que está no ar. */
export type ProgramaAgora = {
  canalId: string;
  titulo: string;
  descricao?: string;
  inicio?: string;
  fim?: string;
};

export const ACERVO_VAZIO: Acervo = {
  titulos: [],
  canais: [],
  destaques: [],
  fontes: [],
  demoAtivo: false,
  tmdbAtivo: false,
  atualizadoEm: "",
};
