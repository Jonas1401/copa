import { obterSegredo, semSegredos } from "@/lib/admin/segredos";

/**
 * Cliente do Composio — SOMENTE servidor.
 * Base: https://backend.composio.dev/api/v3.1 · autenticação: header x-api-key
 * A chave (COMPOSIO_API_KEY) vem do cofre do CopaLinks e nunca sai daqui.
 */
export const COMPOSIO_BASE = "https://backend.composio.dev/api/v3.1";

export class ErroComposio extends Error {
  constructor(
    mensagem: string,
    public status: number,
  ) {
    super(mensagem);
  }
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const chave = await obterSegredo("COMPOSIO_API_KEY");
  if (!chave) throw new ErroComposio("Composio não configurado.", 0);
  const r = await fetch(`${COMPOSIO_BASE}${caminho}`, {
    ...init,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      "x-api-key": chave,
    },
  });
  const texto = await r.text();
  let corpo: unknown = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  if (!r.ok) {
    const e = corpo as { error?: { message?: string } } | null;
    const msg =
      r.status === 401
        ? "API Key inválida ou revogada."
        : e?.error?.message ?? `Composio respondeu ${r.status}.`;
    throw new ErroComposio(semSegredos(msg, [chave]), r.status);
  }
  return corpo as T;
}

export type ContaConectada = {
  id: string;
  status: string;
  user_id?: string;
  toolkit?: { slug: string };
};

/** Contas conectadas do projeto (Gmail, WhatsApp, Slack...). */
export function listarContasConectadas(filtros: { limite?: number; toolkit?: string; userId?: string } = {}) {
  const q = new URLSearchParams();
  q.set("limit", String(filtros.limite ?? 20));
  if (filtros.toolkit) q.set("toolkit_slugs", filtros.toolkit);
  if (filtros.userId) q.set("user_ids", filtros.userId);
  return chamar<{ items: ContaConectada[]; total_items?: number }>(`/connected_accounts?${q}`);
}

/**
 * Executa uma ferramenta do Composio (ex.: "GMAIL_SEND_EMAIL").
 * Passe `arguments` (estruturado) OU `text` (linguagem natural).
 */
export function executarFerramenta(
  toolSlug: string,
  opcoes: {
    arguments?: Record<string, unknown>;
    text?: string;
    userId?: string;
    connectedAccountId?: string;
  },
) {
  return chamar<{ data?: unknown; successful?: boolean; error?: string | null }>(
    `/tools/execute/${encodeURIComponent(toolSlug)}`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(opcoes.arguments ? { arguments: opcoes.arguments } : {}),
        ...(opcoes.text ? { text: opcoes.text } : {}),
        ...(opcoes.userId ? { user_id: opcoes.userId } : {}),
        ...(opcoes.connectedAccountId ? { connected_account_id: opcoes.connectedAccountId } : {}),
      }),
    },
  );
}

/** Teste de conexão usado pelo painel: valida a chave sem alterar nada. */
export async function testarComposio() {
  const r = await listarContasConectadas({ limite: 1 });
  const total = r.total_items ?? r.items?.length ?? 0;
  // Confere também as ferramentas que o CopaLinks usa (clima e leitura).
  const clima = await climaAgoraComposio().catch(() => null);
  return (
    `Conectado · ${total} conta${total === 1 ? "" : "s"} conectada${total === 1 ? "" : "s"}` +
    (clima ? ` · clima OK (${Math.round(clima.temperatura)}°C em Paranaguá).` : " · clima do Composio indisponível.")
  );
}

/* ------------------------------------------------ ferramentas sem login */

export async function composioConfigurado() {
  return Boolean(await obterSegredo("COMPOSIO_API_KEY"));
}

// ID fixo do "usuário" servidor no Composio (as ferramentas sem login não
// dependem de conta conectada, mas a API pede um user_id).
const USUARIO_SERVIDOR = "copalinks-servidor";

/**
 * Lê o texto (markdown) de páginas públicas pelo Composio
 * (COMPOSIO_SEARCH_FETCH_URL_CONTENT). Uso: reserva quando a leitura direta
 * falha.
 */
export async function lerPaginas(urls: string[], maxCaracteres = 20000) {
  const r = await chamar<{
    data?: { results?: { id?: string; url?: string; text?: string }[] };
    successful?: boolean;
    error?: string | null;
  }>("/tools/execute/COMPOSIO_SEARCH_FETCH_URL_CONTENT", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      user_id: USUARIO_SERVIDOR,
      arguments: { urls, text: true, max_characters: maxCaracteres },
    }),
  });
  if (r.successful === false) throw new ErroComposio(r.error ?? "Composio não conseguiu ler a página.", 502);
  const res = r.data?.results ?? [];
  // Devolve na mesma ordem pedida.
  return urls.map((u) => {
    const achado = res.find((x) => (x.id ?? x.url ?? "").replace(/\/$/, "") === u.replace(/\/$/, ""));
    return { url: u, texto: achado?.text ?? "" };
  });
}

export type ClimaComposio = {
  temperatura: number; // °C
  sensacao: number;
  umidade: number;
  ventoKmh: number;
  rajadaKmh: number;
  ventoGraus: number;
  nuvens: number;
  codigo: number; // código OpenWeather (ex.: 804)
  descricao: string;
  medidoEm: number; // segundos
};

/** Tempo atual pelo Composio (WEATHERMAP_WEATHER / OpenWeather). */
export async function climaAgoraComposio(local = "Paranagua,BR"): Promise<ClimaComposio> {
  const r = await chamar<{
    data?: {
      weather_info?: {
        dt?: number;
        main?: { temp?: number; feels_like?: number; humidity?: number };
        wind?: { speed?: number; gust?: number; deg?: number };
        clouds?: { all?: number };
        weather?: { id?: number; description?: string }[];
      };
    };
    successful?: boolean;
    error?: string | null;
  }>("/tools/execute/WEATHERMAP_WEATHER", {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ user_id: USUARIO_SERVIDOR, arguments: { location: local } }),
  });
  const w = r.data?.weather_info;
  if (r.successful === false || !w?.main) throw new ErroComposio(r.error ?? "Clima indisponível no Composio.", 502);
  const K = (k?: number) => Math.round(((k ?? 273.15) - 273.15) * 10) / 10; // Kelvin → °C
  const ms = (v?: number) => Math.round((v ?? 0) * 3.6); // m/s → km/h
  return {
    temperatura: K(w.main.temp),
    sensacao: K(w.main.feels_like),
    umidade: Math.round(w.main.humidity ?? 0),
    ventoKmh: ms(w.wind?.speed),
    rajadaKmh: ms(w.wind?.gust ?? w.wind?.speed),
    ventoGraus: Math.round(w.wind?.deg ?? 0),
    nuvens: Math.round(w.clouds?.all ?? 0),
    codigo: w.weather?.[0]?.id ?? 804,
    descricao: w.weather?.[0]?.description ?? "",
    medidoEm: w.dt ?? Math.floor(Date.now() / 1000),
  };
}
