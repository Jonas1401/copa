/**
 * Catálogo de figurinhas COM IMAGEM do chat dos motoristas (CopaLinks).
 *
 * Regras puras de domínio — nada de banco, HTTP ou React aqui:
 *   - Categorias em pacotes (Caminhões, Motoristas, Porto, CopaLinks) que o
 *     servidor devolve prontas; pacotes futuros entram pelo painel admin sem
 *     mexer no código do chat.
 *   - Validação de upload (PNG, WebP e GIF) por bytes reais (assinatura do
 *     arquivo), não só pelo nome/MIME que o navegador informa.
 *
 * As figurinhas antigas de texto/emoji continuam em `./figurinhas.ts` — este
 * módulo é um recurso ADICIONAL e não substitui nada do chat.
 */

/* ------------------------------------------------------------- categorias */

export type CategoriaFigurinha = {
  chave: string;
  nome: string;
  ordem: number;
  pacote: string;
};

/** Categorias do pacote inicial CopaLinks (mesma ordem do seletor). */
export const CATEGORIAS_PADRAO: CategoriaFigurinha[] = [
  { chave: "caminhoes", nome: "Caminhões", ordem: 0, pacote: "copalinks" },
  { chave: "motoristas", nome: "Motoristas", ordem: 1, pacote: "copalinks" },
  { chave: "porto", nome: "Porto", ordem: 2, pacote: "copalinks" },
  { chave: "copalinks", nome: "CopaLinks", ordem: 3, pacote: "copalinks" },
];

/** Chave de categoria: minúsculas, números e hífen (ex.: "caminhoes"). */
export const CHAVE_CATEGORIA = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** "Caminhões" → "caminhoes"; devolve null quando não sobra chave usável. */
export function chaveCategoria(entrada: string): string | null {
  const base = entrada
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return CHAVE_CATEGORIA.test(base) ? base : null;
}

export function nomeCategoria(entrada: string): string | null {
  const nome = entrada.replace(/\s+/g, " ").trim().slice(0, 40);
  return nome.length >= 2 ? nome : null;
}

/* --------------------------------------------------------------- arquivos */

/** PNG, WebP e GIF com fundo transparente (quando houver). */
export const MIME_FIGURINHA: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Upload de figurinha: até 512 KB (folga para GIF animado curto). */
export const TAMANHO_MAX_FIGURINHA = 512 * 1024;

export type FormatoFigurinha = { mime: string; extensao: string };

function assinatura(dados: Uint8Array, texto: string, deslocamento = 0) {
  if (dados.length < deslocamento + texto.length) return false;
  for (let i = 0; i < texto.length; i += 1) {
    if (dados[deslocamento + i] !== texto.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Confere o formato pelos bytes do arquivo (PNG, WebP ou GIF). O MIME que o
 * navegador informa serve só de pista: o que vale é a assinatura do arquivo.
 */
export function formatoFigurinha(bruto: Uint8Array, mimeInformado = ""): FormatoFigurinha | null {
  if (!bruto.length || bruto.length > TAMANHO_MAX_FIGURINHA) return null;
  let achado: FormatoFigurinha | null = null;
  if (assinatura(bruto, "\x89PNG\r\n\x1a\n")) achado = { mime: "image/png", extensao: "png" };
  else if (assinatura(bruto, "GIF87a") || assinatura(bruto, "GIF89a")) achado = { mime: "image/gif", extensao: "gif" };
  else if (assinatura(bruto, "RIFF") && assinatura(bruto, "WEBP", 8)) achado = { mime: "image/webp", extensao: "webp" };
  if (!achado) return null;
  // O tipo declarado, quando existir e for de imagem, precisa bater com o arquivo.
  const declarado = mimeInformado.toLowerCase().split(";")[0].trim();
  if (declarado && declarado !== "application/octet-stream" && MIME_FIGURINHA[declarado] !== achado.extensao) return null;
  return achado;
}

/** Nome de exibição da figurinha: 2 a 60 caracteres, sem quebras de linha. */
export function nomeFigurinha(entrada: string): string | null {
  const nome = entrada.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return nome.length >= 2 && nome.length <= 60 ? nome : null;
}

/** Ordem de exibição: inteiro 0..9999 (padrão 0 para valores inválidos). */
export function ordemFigurinha(entrada: unknown): number {
  const n = Number(entrada);
  return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : 0;
}

/** Mensagem gravada no chat quando alguém envia uma figurinha (vai no Push). */
export const textoFigurinhaEnviada = (nome: string) => `🎨 ${nome}`.slice(0, 500);

/** Corpo curto do Web Push da figurinha. */
export const pushFigurinhaEnviada = (nome: string) => `🖼️ Enviou a figurinha "${nome}"`.slice(0, 220);
