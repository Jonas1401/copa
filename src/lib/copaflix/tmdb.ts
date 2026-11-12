/**
 * Metadados e cartazes do TMDB (opcional).
 *
 * A chave fica só no servidor. Quando configurada, o CopaFlix busca cartaz e
 * fundo dos títulos que ainda não têm imagem — sempre com a atribuição exigida
 * pelas condições de uso do TMDB ("Este produto usa a API do TMDB, mas não é
 * endossado nem certificado pelo TMDB"). Sem chave, o app usa a arte própria e
 * nada é enviado para fora.
 */
import type { Titulo } from "./tipos";
import { ATRIBUICAO_TMDB } from "./catalogo";

export { ATRIBUICAO_TMDB };

const IMAGEM = "https://image.tmdb.org/t/p";

const cache = new Map<string, { capa?: string; fundo?: string } | null>();

type ResultadoBusca = {
  poster_path?: string | null;
  backdrop_path?: string | null;
};

export async function buscarImagensTmdb(
  chave: string,
  titulo: string,
  ano: number | undefined,
  idioma = "pt-BR",
  segundos = 4,
): Promise<{ capa?: string; fundo?: string } | null> {
  const cacheKey = `${titulo}|${ano ?? ""}|${idioma}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  const params = new URLSearchParams({ query: titulo, language: idioma, include_adult: "false" });
  if (ano) params.set("year", String(ano));

  try {
    const resposta = await fetch(`https://api.themoviedb.org/3/search/movie?${params.toString()}`, {
      headers: { Authorization: `Bearer ${chave}`, Accept: "application/json" },
      signal: AbortSignal.timeout(segundos * 1000),
      cache: "no-store",
    });
    if (!resposta.ok) throw new Error(`TMDB ${resposta.status}`);
    const dados = (await resposta.json()) as { results?: ResultadoBusca[] };
    const achado = dados.results?.find((r) => r.poster_path || r.backdrop_path);
    if (!achado) {
      cache.set(cacheKey, null);
      return null;
    }
    const saida = {
      capa: achado.poster_path ? `${IMAGEM}/w500${achado.poster_path}` : undefined,
      fundo: achado.backdrop_path ? `${IMAGEM}/w1280${achado.backdrop_path}` : undefined,
    };
    cache.set(cacheKey, saida);
    return saida;
  } catch {
    // Sem TMDB o módulo continua funcionando com a arte do app.
    cache.set(cacheKey, null);
    return null;
  }
}

/**
 * Completa capa/fundo dos títulos que ainda não têm imagem. Roda no máximo
 * `limite` buscas e respeita o prazo total — a página nunca fica presa.
 */
export async function enriquecerComTmdb(
  titulos: Titulo[],
  chave: string,
  opcoes: { limite?: number; prazoMs?: number } = {},
): Promise<Titulo[]> {
  const limite = opcoes.limite ?? 8;
  const prazo = opcoes.prazoMs ?? 3500;
  const inicio = Date.now();
  const alvos = titulos.filter((t) => !t.capa).slice(0, limite);

  const saida = titulos.map((t) => ({ ...t }));
  const porId = new Map(saida.map((t) => [t.id, t]));

  await Promise.all(
    alvos.map(async (titulo) => {
      if (Date.now() - inicio > prazo) return;
      const imagens = await buscarImagensTmdb(chave, titulo.titulo, titulo.ano);
      if (!imagens) return;
      const alvo = porId.get(titulo.id);
      if (!alvo) return;
      alvo.capa = alvo.capa ?? imagens.capa;
      alvo.fundo = alvo.fundo ?? imagens.fundo;
    }),
  );

  return saida;
}
