/**
 * Leitor de listas M3U/M3U8 (o formato usado por IPTVnator e por qualquer
 * player de TV: uma linha `#EXTINF` com os dados do canal e, na linha
 * seguinte, o endereço do fluxo).
 *
 * Só interpretamos texto: nada é executado, nenhum protocolo além de http(s)
 * é aceito e o tamanho da lista é limitado. A lista precisa ter sido obtida
 * legalmente pelo administrador do CopaLinks.
 */
import { urlExternaSegura } from "./url-segura";
import type { Canal } from "./tipos";

/** Limite de canais por lista — evita payload gigante na tela. */
export const MAXIMO_CANAIS = 5000;

export type ItemM3U = {
  nome: string;
  url: string;
  grupo?: string;
  logo?: string;
  tvgId?: string;
};

/** O texto parece uma lista de canais (e não um único fluxo HLS)? */
export function pareceListaM3U(texto: string) {
  const inicio = texto.slice(0, 8192);
  if (inicio.includes("#EXTM3U")) return true;
  return /(^|\n)\s*#EXTINF:/i.test(inicio);
}

/** Playlist de mídia do HLS (um único fluxo, não uma lista de canais). */
export function ehPlaylistDeMidia(texto: string) {
  const inicio = texto.slice(0, 4096);
  return /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|PLAYLIST-TYPE)/i.test(inicio);
}

/**
 * Separa os atributos da linha `#EXTINF` (`tvg-id="x" group-title="Notícias"`)
 * do nome do canal (o texto depois da primeira vírgula fora das aspas).
 */
export function lerLinhaExtinf(linha: string): {
  atributos: Record<string, string>;
  nome: string;
} {
  const corpo = linha.replace(/^#EXTINF:/i, "").trim();
  const atributos: Record<string, string> = {};
  let dentroDeAspas = false;
  let primeiraVirgula = -1;

  // A primeira vírgula FORA das aspas separa os atributos do nome. Tudo o que
  // vem depois é nome — inclusive outras vírgulas ("Canal Um, HD").
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i];
    if (c === '"') dentroDeAspas = !dentroDeAspas;
    else if (c === "," && !dentroDeAspas) {
      primeiraVirgula = i;
      break;
    }
  }

  const cabecalho = primeiraVirgula >= 0 ? corpo.slice(0, primeiraVirgula) : corpo;
  const nome = primeiraVirgula >= 0 ? corpo.slice(primeiraVirgula + 1) : "";

  const regex = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(cabecalho))) atributos[m[1].toLowerCase()] = m[2];

  return { atributos, nome: nome.trim() };
}

/** Lê o texto de uma lista e devolve os canais válidos (http/https apenas). */
export function lerListaM3U(
  texto: string,
  opcoes: { permitirRedeInterna?: boolean; maximo?: number } = {},
): ItemM3U[] {
  if (!texto || typeof texto !== "string") return [];
  if (ehPlaylistDeMidia(texto) && !texto.includes("#EXTINF:")) return [];

  const limite = Math.min(opcoes.maximo ?? MAXIMO_CANAIS, MAXIMO_CANAIS);
  const linhas = texto.split(/\r?\n/);
  const itens: ItemM3U[] = [];
  let pendente: ReturnType<typeof lerLinhaExtinf> | null = null;

  for (const bruta of linhas) {
    const linha = bruta.trim();
    if (!linha) continue;

    if (/^#EXTINF:/i.test(linha)) {
      pendente = lerLinhaExtinf(linha);
      continue;
    }
    if (linha.startsWith("#")) continue; // #EXTM3U, #EXTGRP, #EXTVLCOPT...

    if (!pendente) continue;
    if (!/^https?:\/\//i.test(linha)) {
      pendente = null;
      continue;
    }
    if (!urlExternaSegura(linha, Boolean(opcoes.permitirRedeInterna))) {
      pendente = null;
      continue;
    }

    const nome = pendente.nome || pendente.atributos["tvg-name"] || "Canal sem nome";
    itens.push({
      nome,
      url: linha,
      grupo: pendente.atributos["group-title"] || undefined,
      logo: urlExternaSegura(pendente.atributos["tvg-logo"], true)
        ? pendente.atributos["tvg-logo"]
        : undefined,
      tvgId: pendente.atributos["tvg-id"] || undefined,
    });
    pendente = null;
    if (itens.length >= limite) break;
  }

  return itens;
}

/** Id estável e seguro para usar em rota/URL a partir do nome do canal. */
export function idDoCanal(item: ItemM3U, indice: number) {
  const base = item.nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `m3u-${base || "canal"}-${indice + 1}`;
}

/** Converte os itens da lista em canais do CopaFlix. */
export function canaisDaLista(
  itens: ItemM3U[],
  opcoes: { origemNome?: string } = {},
): Canal[] {
  return itens.map((item, indice) => ({
    id: idDoCanal(item, indice),
    nome: item.nome,
    categoria: item.grupo?.trim() || "Geral",
    logo: item.logo,
    tvgId: item.tvgId,
    fonte: { tipo: "hls", url: item.url },
    origem: "m3u" as const,
    credito: opcoes.origemNome,
  }));
}
