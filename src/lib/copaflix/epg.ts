/**
 * Guia eletrônico de programação (EPG) no formato XMLTV.
 *
 * O CopaFlix não inventa programação: se o administrador configurar um guia
 * (COPAFLIX_EPG_URL), mostramos só o programa que está no ar em cada canal,
 * casando pelo `tvg-id` da lista M3U. Sem guia, a tela mostra a hora local.
 */
import type { ProgramaAgora } from "./tipos";

/** Limite do XML aceito (um guia completo costuma ter poucos MB). */
export const MAXIMO_XML_EPG = 8 * 1024 * 1024;

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodificarXml(texto: string) {
  return texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (total, codigo: string) => {
      if (codigo.startsWith("#x") || codigo.startsWith("#X")) {
        const n = parseInt(codigo.slice(2), 16);
        return Number.isFinite(n) ? String.fromCodePoint(n) : total;
      }
      if (codigo.startsWith("#")) {
        const n = parseInt(codigo.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : total;
      }
      return ENTIDADES[codigo] ?? total;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** "20261112120000 +0000" → Date (UTC). Simples e sem dependência. */
export function parseDataXmltv(valor?: string | null): Date | null {
  if (!valor) return null;
  const m = valor.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/);
  if (!m) return null;
  const [, ano, mes, dia, hora, minuto, segundo = "00", fuso] = m;
  const utc = Date.UTC(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  );
  let deslocamento = 0;
  if (fuso) {
    const sinal = fuso.startsWith("-") ? -1 : 1;
    const horas = Number(fuso.slice(1, 3));
    const minutos = Number(fuso.slice(3, 5));
    deslocamento = sinal * (horas * 60 + minutos) * 60_000;
  }
  const data = new Date(utc - deslocamento);
  return Number.isNaN(data.getTime()) ? null : data;
}

function atributo(tag: string, nome: string) {
  const m = tag.match(new RegExp(`${nome}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? decodificarXml(m[1]) : undefined;
}

function textoDaTag(bloco: string, tag: string) {
  const m = bloco.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodificarXml(m[1]) : undefined;
}

/**
 * Lê o XMLTV e devolve o programa que está no ar em cada canal no instante
 * `agora`. Um canal pode aparecer mais de uma vez no guia — fica o programa
 * cuja janela contém o horário.
 */
export function lerEpg(xml: string, agora: Date = new Date()): ProgramaAgora[] {
  if (!xml || typeof xml !== "string") return [];
  const recorte = xml.slice(0, MAXIMO_XML_EPG);
  if (!recorte.includes("<programme")) return [];

  const porCanal = new Map<string, ProgramaAgora>();
  const blocos = recorte.match(/<programme\b[^>]*>[\s\S]*?<\/programme>/gi) ?? [];

  for (const bloco of blocos) {
    const abertura = bloco.slice(0, bloco.indexOf(">") + 1);
    const canalId = atributo(abertura, "channel");
    if (!canalId) continue;
    const inicio = parseDataXmltv(atributo(abertura, "start"));
    const fim = parseDataXmltv(atributo(abertura, "stop"));
    if (!inicio) continue;
    const termino = fim ?? new Date(inicio.getTime() + 60 * 60_000);
    if (agora < inicio || agora >= termino) continue;

    const titulo = textoDaTag(bloco, "title");
    if (!titulo) continue;
    porCanal.set(canalId, {
      canalId,
      titulo,
      descricao: textoDaTag(bloco, "desc"),
      inicio: inicio.toISOString(),
      fim: termino.toISOString(),
    });
  }

  return [...porCanal.values()];
}

/** Hora local "14:30" — usada ao lado do programa no ar. */
export function horaCurta(iso?: string) {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
