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
  created_at?: string;
  toolkit?: { slug: string };
};

export type AuthConfigComposio = {
  id: string;
  auth_scheme: string;
  is_composio_managed: boolean;
  status: string;
  toolkit?: { slug: string };
};

/** Lista configurações de autenticação sem expor credenciais da conta. */
export function listarAuthConfigs(toolkit: string) {
  const q = new URLSearchParams({ toolkit_slug: toolkit, limit: "50" });
  return chamar<{ items: AuthConfigComposio[] }>(`/auth_configs?${q}`);
}

/** Cria configuração OAuth gerenciada; NÃO conecta uma conta nem envia mensagens. */
export function criarAuthConfigGerenciado(toolkit: string, ferramentasPermitidas: string[]) {
  return chamar<{ auth_config?: AuthConfigComposio }>("/auth_configs", {
    method: "POST",
    body: JSON.stringify({
      toolkit: { slug: toolkit },
      auth_config: {
        type: "use_composio_managed_auth",
        credentials: {},
        restrict_to_following_tools: ferramentasPermitidas,
      },
    }),
  });
}

/** Link temporário da página hospedada pelo Composio para autorizar a Meta. */
export function criarLinkContaConectada(authConfigId: string, userId: string, callbackUrl: string) {
  return chamar<{ redirect_url?: string; expires_at?: string }>("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({ auth_config_id: authConfigId, user_id: userId, callback_url: callbackUrl }),
  });
}

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

/**
 * Chat completion VIA COMPOSIO (toolkit OpenAI, sem chamar a OpenAI direto).
 * Exige: COMPOSIO_API_KEY configurada + conta OpenAI conectada no Composio
 * (dashboard Composio → Apps → OpenAI → Connect). O user_id do Composio é o
 * servidor; a resposta volta no formato padrão de chat completion.
 */
export async function chatViaComposio(
  mensagens: { role: string; content: string }[],
  opcoes: { modelo?: string; temperatura?: number; maxTokens?: number } = {},
): Promise<string> {
  const slugs = [
    "OPENAI_CREATE_CHAT_COMPLETION",
    "OPENAI_CREATE_CHAT_COMPLETIONS",
    "OPENAI_CHAT_COMPLETION_CREATE",
  ];
  const args = {
    model: opcoes.modelo ?? "gpt-4o-mini",
    messages: mensagens,
    temperature: opcoes.temperatura ?? 0.4,
    max_tokens: opcoes.maxTokens ?? 700,
  };
  let ultimoErro: unknown = null;
  for (const slug of slugs) {
    try {
      const r = await chamar<{
        data?: {
          choices?: { message?: { content?: string }; text?: string }[];
          response?: { choices?: { message?: { content?: string } }[] };
          output?: string;
          content?: string;
        };
        successful?: boolean;
        error?: string | null;
      }>(`/tools/execute/${slug}`, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ user_id: USUARIO_SERVIDOR, arguments: args }),
      });
      if (r.successful === false) throw new ErroComposio(r.error ?? `Falha no ${slug}.`, 502);
      const d = r.data as Record<string, unknown> | undefined;
      const extrai = (o: unknown): string => {
        if (!o || typeof o !== "object") return "";
        const j = o as {
          choices?: { message?: { content?: string }; text?: string }[];
          response?: { choices?: { message?: { content?: string } }[] };
          output?: unknown;
          content?: unknown;
        };
        const c0 = j.choices?.[0];
        if (typeof c0?.message?.content === "string" && c0.message.content.trim()) return c0.message.content;
        if (typeof c0?.text === "string" && c0.text.trim()) return c0.text;
        const r0 = j.response?.choices?.[0]?.message?.content;
        if (typeof r0 === "string" && r0.trim()) return r0;
        if (typeof j.output === "string" && j.output.trim()) return j.output;
        if (typeof j.content === "string" && j.content.trim()) return j.content;
        return "";
      };
      const texto = extrai(d);
      if (texto) return texto.trim();
      throw new ErroComposio(`Resposta inesperada do ${slug}.`, 502);
    } catch (e) {
      ultimoErro = e;
      // 404 = slug não existe nesta conta: tenta o próximo nome.
      if (e instanceof ErroComposio && e.status === 404) continue;
      // 401/403 = sem conta OpenAI conectada: não adianta tentar outros slugs.
      if (e instanceof ErroComposio && (e.status === 401 || e.status === 403)) throw e;
      // Outro erro (timeout, 5xx): tenta o próximo slug antes de desistir.
      continue;
    }
  }
  if (ultimoErro instanceof ErroComposio) throw ultimoErro;
  throw new ErroComposio("Composio não conseguiu gerar a resposta.", 502);
}

/* ------------------------------------------- IA: Gemini sem login */

/**
 * Texto do Google Gemini pelo Composio (GEMINI_GENERATE_CONTENT, modo sem
 * login — NO_AUTH): funciona só com a COMPOSIO_API_KEY, sem conta conectada
 * e sem chave de IA própria. O gemini-2.5-flash raciocina antes de responder
 * e esse raciocínio consome parte do limite de tokens (por isso a folga); a
 * reserva gemini-2.5-flash-lite responde em ~2 s.
 */
export async function geminiViaComposio(
  sistema: string,
  prompt: string,
  opcoes: { rapido?: boolean; reserva?: boolean; maxTokens?: number; temperatura?: number; timeoutMs?: number } = {},
): Promise<{ texto: string; modelo: string }> {
  const ordem = opcoes.rapido ? ["gemini-2.5-flash-lite", "gemini-2.5-flash"] : ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const modelos = opcoes.reserva === false ? ordem.slice(0, 1) : ordem;
  const base = opcoes.maxTokens ?? 1200;
  let erro: unknown = null;
  for (const [i, modelo] of modelos.entries()) {
    try {
      const r = await chamar<{
        data?: { text?: string | null; candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[] };
        successful?: boolean;
        error?: string | null;
      }>("/tools/execute/GEMINI_GENERATE_CONTENT", {
        method: "POST",
        signal: AbortSignal.timeout(i === 0 ? (opcoes.timeoutMs ?? 30000) : 15000),
        body: JSON.stringify({
          user_id: USUARIO_SERVIDOR,
          arguments: {
            model: modelo,
            system_instruction: sistema,
            prompt,
            temperature: opcoes.temperatura ?? 0.4,
            max_output_tokens: modelo === "gemini-2.5-flash" ? base + 3000 : base,
          },
        }),
      });
      if (r.successful === false) throw new ErroComposio(String(r.error ?? "Gemini não respondeu.").slice(0, 200), 502);
      const c = r.data?.candidates?.[0];
      const texto = (r.data?.text ?? c?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").trim();
      if (!texto) throw new ErroComposio(`Gemini não devolveu texto (${c?.finishReason ?? "sem motivo"}).`, 502);
      return { texto, modelo };
    } catch (e) {
      erro = e;
      // Sem chave ou chave recusada: outro modelo não resolve.
      if (e instanceof ErroComposio && (e.status === 0 || e.status === 401)) break;
    }
  }
  throw erro instanceof Error ? erro : new ErroComposio("Gemini não respondeu.", 502);
}

/** Conversa no formato chat (system/user/assistant) → Gemini pelo Composio. */
export async function chatViaGeminiComposio(mensagens: { role: string; content: string }[]): Promise<string> {
  const sistema = mensagens.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversa = mensagens.filter((m) => m.role !== "system");
  const ultima = conversa.at(-1)?.content ?? "";
  const anteriores = conversa
    .slice(0, -1)
    .map((m) => `${m.role === "assistant" ? "Assistente" : "Motorista"}: ${m.content}`)
    .join("\n\n");
  const prompt =
    (anteriores ? `Conversa até agora (da mais antiga para a mais recente):\n\n${anteriores}\n\n---\n\n` : "") +
    `Nova mensagem do motorista:\n${ultima}\n\nResponda somente a esta nova mensagem, levando em conta a conversa acima.`;
  return (await geminiViaComposio(sistema, prompt, { maxTokens: 1400, temperatura: 0.35 })).texto;
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

/* ------------------------------------- painel SIMPORT® lido pelo Composio */

/**
 * Endereço público do SIMPORT® — Dashboard Meteoceanográfico da APPA, o mesmo
 * que o motorista abre no navegador (https://weather-appa.app.simport.com.br/).
 * Pode ser trocado por variável de ambiente (ex.: /forecast).
 */
export const SIMPORT_PAINEL_URL =
  process.env.SIMPORT_PAINEL_URL?.trim() || "https://weather-appa.app.simport.com.br/";

/**
 * Lê o painel da Simport PELO COMPOSIO (COMPOSIO_SEARCH_FETCH_URL_CONTENT) e
 * devolve o texto da página (markdown). É por aqui que o radar da previsão
 * (`src/lib/clima-monitor.ts`) acompanha constantemente o boletim da APPA, as
 * tabelas de chuva e vento das próximas 24 h e as marés — e compara com a
 * leitura anterior para avisar qualquer mudança no chat.
 *
 * Sem COMPOSIO_API_KEY (ou com o Composio fora do ar) a função joga erro: o
 * radar segue trabalhando com a API estruturada da Simport/Open-Meteo.
 */
export async function painelSimportComposio(maxCaracteres = 14000): Promise<string> {
  const [pagina] = await lerPaginas([SIMPORT_PAINEL_URL], maxCaracteres);
  const texto = (pagina?.texto ?? "").trim();
  if (!texto) throw new ErroComposio("Composio não devolveu o painel da Simport.", 502);
  return texto;
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

/** Mesma chamada autenticada usada acima (para ferramentas sem helper próprio). */
export const chamarComposio = chamar;
export const USUARIO_COMPOSIO = USUARIO_SERVIDOR;
