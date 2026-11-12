/**
 * Integração com um servidor Jellyfin do próprio usuário.
 *
 * Referência de arquitetura: jellyfin/jellyfin-web (GPL-2.0) e
 * jellyfin/jellyfin (GPL-2.0). NADA de código deles é copiado aqui — usamos
 * apenas a API HTTP pública documentada, que é estável e independente de
 * licença. A chave fica SÓ no servidor do CopaLinks: a tela recebe caminhos
 * internos (`/api/copaflix/jellyfin/...`) e nunca vê a credencial.
 */
import type { Episodio, Titulo } from "./tipos";

export type ConfigJellyfin = {
  base: string;
  chave: string;
  usuarioId?: string;
};

type ItemJellyfin = {
  Id: string;
  Name: string;
  Type?: string;
  Overview?: string;
  ProductionYear?: number;
  Genres?: string[];
  RunTimeTicks?: number;
  OfficialRating?: string;
  ImageTags?: Record<string, string>;
  ChildCount?: number;
  RecursiveItemCount?: number;
};

type RespostaItens = { Items?: ItemJellyfin[]; TotalRecordCount?: number };

const GENEROS_JELLYFIN: Record<string, string> = {
  action: "acao",
  adventure: "aventura",
  animation: "animacao",
  comedy: "comedia",
  crime: "crime",
  documentary: "documentario",
  drama: "drama",
  family: "infantil",
  fantasy: "fantasia",
  horror: "terror",
  romance: "romance",
  "science fiction": "ficcao",
  "sci-fi": "ficcao",
  thriller: "acao",
  war: "drama",
  western: "aventura",
};

function generos(chaves: string[] = []) {
  const saida = new Set<string>();
  for (const bruto of chaves) {
    const chave = GENEROS_JELLYFIN[bruto.trim().toLowerCase()];
    if (chave) saida.add(chave);
  }
  return [...saida];
}

function minutos(ticks?: number) {
  if (!ticks || !Number.isFinite(ticks)) return undefined;
  const m = Math.round(ticks / 600_000_000);
  return m > 0 ? m : undefined;
}

/** Cabeçalho oficial do Jellyfin. Nunca aparece no navegador. */
export function cabecalhoJellyfin(chave: string) {
  return {
    Authorization: `MediaBrowser Client="CopaLinks", Device="Server", DeviceId="copalinks-copaflix", Version="1.0.0", Token="${chave}"`,
    Accept: "application/json",
  };
}

async function pedir<T>(config: ConfigJellyfin, caminho: string, segundos = 6): Promise<T> {
  const url = new URL(caminho.replace(/^\//, ""), config.base.endsWith("/") ? config.base : `${config.base}/`);
  const resposta = await fetch(url, {
    headers: cabecalhoJellyfin(config.chave),
    signal: AbortSignal.timeout(segundos * 1000),
    cache: "no-store",
  });
  if (!resposta.ok) throw new Error(`Jellyfin respondeu ${resposta.status}`);
  return (await resposta.json()) as T;
}

export async function listarJellyfin(config: ConfigJellyfin): Promise<Titulo[]> {
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    Fields: "Overview,Genres,ProductionYear,RunTimeTicks,OfficialRating,ChildCount,ImageTags",
    ImageTypeLimit: "1",
    Limit: "300",
    SortBy: "SortName",
  });
  const dados = await pedir<RespostaItens>(config, `Items?${params.toString()}`);
  const itens = Array.isArray(dados.Items) ? dados.Items : [];

  return itens.map((item): Titulo => {
    const tipo = item.Type === "Series" ? "serie" : "filme";
    const id = `jellyfin-${item.Id}`;
    const imagem = `/api/copaflix/jellyfin/imagem/${encodeURIComponent(item.Id)}`;
    return {
      id,
      tipo,
      titulo: item.Name || "Sem título",
      ano: item.ProductionYear,
      sinopse: item.Overview?.trim() || "Sem descrição cadastrada no servidor Jellyfin.",
      generos: generos(item.Genres),
      duracaoMin: minutos(item.RunTimeTicks),
      classificacao: item.OfficialRating,
      capa: item.ImageTags?.Primary ? imagem : undefined,
      fundo: item.ImageTags?.Backdrop ? `${imagem}?tipo=fundo` : undefined,
      fonte: { tipo: "jellyfin", itemId: item.Id },
      origem: "jellyfin",
      credito: "Servidor Jellyfin autorizado pelo usuário",
      popularidade: 50,
      temporadas: tipo === "serie" ? item.RecursiveItemCount || item.ChildCount || 1 : undefined,
    };
  });
}

/** Episódios de uma série: carregados só quando a ficha é aberta. */
export async function episodiosJellyfin(
  config: ConfigJellyfin,
  serieId: string,
): Promise<Episodio[]> {
  const params = new URLSearchParams({
    Fields: "Overview,RunTimeTicks",
    SortBy: "ParentIndexNumber,IndexNumber",
  });
  const dados = await pedir<RespostaItens>(
    config,
    `Shows/${encodeURIComponent(serieId)}/Episodes?${params.toString()}`,
  );
  const itens = Array.isArray(dados.Items) ? dados.Items : [];

  return itens.map((item): Episodio => {
    const temporada = Number((item as ItemJellyfin & { ParentIndexNumber?: number }).ParentIndexNumber) || 1;
    const numero = Number((item as ItemJellyfin & { IndexNumber?: number }).IndexNumber) || 1;
    return {
      id: `jellyfin-ep-${item.Id}`,
      titulo: item.Name || `Episódio ${numero}`,
      temporada,
      numero,
      duracaoMin: minutos(item.RunTimeTicks),
      sinopse: item.Overview?.trim() || undefined,
      fonte: { tipo: "jellyfin", itemId: item.Id },
      referencia: item.Id,
    };
  });
}
