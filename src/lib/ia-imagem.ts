import sharp from "sharp";
import { ErroIA, provedorPelaChave, nomeProvedorIA } from "@/lib/ia-provedor";

/**
 * Imagens do assistente do CopaLinks — SOMENTE servidor.
 *
 * Duas capacidades, de QUALQUER assunto:
 *  1. Gerar imagem (texto → imagem, ou foto + pedido → nova imagem).
 *     Ordem: Composio (Nano Banana, GEMINI_GENERATE_IMAGE) → OpenRouter
 *     (POST /api/v1/images, com a AI API Key do OpenRouter).
 *  2. Receber imagem (o motorista envia uma foto e a IA analisa/responde).
 *     Usa a AI API Key com visão: OpenAI, Anthropic, Google Gemini ou OpenRouter.
 *
 * Os módulos de banco e de segredos são importados sob demanda, para que as
 * partes puras (detecção de pedido, normalização e chamadas HTTP) sejam testáveis.
 */

export const LADO_MAX_IMAGEM = 1024;
const TAMANHO_MAX_DATA_URL = 4_000_000; // caracteres (~3 MB de foto)
const LIMITE_IMAGENS_HORA = 6;

export class ErroImagem extends Error {
  constructor(
    mensagem: string,
    public status = 400,
  ) {
    super(mensagem);
    this.name = "ErroImagem";
  }
}

/* ---------------------------------------------------------- pedido de imagem */

/** Pedido explícito de criar/gerar/desenhar uma imagem (verbo + substantivo). */
const PEDIDO_IMAGEM =
  /\b(gera|gerar|gere|cria|criar|crie|faz|fazer|fa[çc]a|desenha|desenhar|desenhe|ilustra|ilustrar|ilustre|monta|montar|monte|mostra|mostrar|mostre|manda|mandar|mande|quero|queria|gostaria)\b[^.?!\n]{0,60}\b(imagem|imagens|foto|fotos|desenho|desenhos|ilustra[cç][aã]o|figura|logo|logotipo|pintura)\b/i;
/** Frase que começa direto pelo substantivo: "imagem de um gato…". */
const INICIO_IMAGEM = /^\s*(imagem|foto|desenho|ilustra[cç][aã]o)\s+(de|do|da|dos|das|sobre|com)\b/i;

/** A mensagem pede para criar uma imagem nova (e não só para falar de uma)? */
export function querGerarImagem(texto: string): boolean {
  const t = texto.trim();
  if (!t) return false;
  return PEDIDO_IMAGEM.test(t) || INICIO_IMAGEM.test(t);
}

/* ------------------------------------------------------------- limite / foto */

const janelaImagens = new Map<number, number[]>();

/** Gerar imagem custa mais: até 6 por hora por motorista. */
export function podeGerarImagem(motoristaId: number, agora = Date.now()): boolean {
  const lista = (janelaImagens.get(motoristaId) ?? []).filter((t) => agora - t < 3600_000);
  if (lista.length >= LIMITE_IMAGENS_HORA) {
    janelaImagens.set(motoristaId, lista);
    return false;
  }
  lista.push(agora);
  janelaImagens.set(motoristaId, lista);
  return true;
}

/** Reduz a imagem para JPEG de até 1024 px (corrige a rotação do celular). */
export async function normalizarImagem(bytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: LADO_MAX_IMAGEM, height: LADO_MAX_IMAGEM, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ErroImagem("Não consegui abrir essa imagem. Tente outra foto.");
  }
}

/** Lê a foto enviada pelo app (data URL JPG/PNG/WebP) e devolve JPEG pronto. */
export async function imagemDeDataUrl(dataUrl: string): Promise<Buffer> {
  if (dataUrl.length > TAMANHO_MAX_DATA_URL) {
    throw new ErroImagem("A foto é grande demais. Envie uma foto menor.", 413);
  }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ErroImagem("Formato não aceito. Envie uma foto JPG, PNG ou WebP.", 415);
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) throw new ErroImagem("A foto veio vazia. Tente de novo.");
  return normalizarImagem(bytes);
}

/* ------------------------------------------------------------ HTTP utilitários */

const SEGURANCA_IMAGEM =
  "Gere uma imagem segura para todos os públicos: sem nudez, sexo, violência gráfica, ódio ou conteúdo ilegal, e sem imitar pessoas reais de forma enganosa.";

function erroHTTP(nome: string, status: number): ErroIA {
  if (status === 401 || status === 403) {
    return new ErroIA(`${nome} recusou a chave de IA. Confira a AI API Key no /admin.`, "nao_configurada");
  }
  if (status === 429) return new ErroIA(`${nome} está sem cota agora. Tente de novo mais tarde.`, "falha");
  return new ErroIA(`${nome} respondeu ${status}.`, "falha");
}

async function jsonDe(resposta: Response, nome: string): Promise<Record<string, unknown>> {
  try {
    return (await resposta.json()) as Record<string, unknown>;
  } catch {
    throw new ErroIA(`${nome} devolveu uma resposta inválida.`, "falha");
  }
}

async function postJson(url: string, headers: Record<string, string>, corpo: unknown, nome: string, timeoutMs: number) {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ErroIA(`Falha ao conectar ao ${nome}. Tente novamente.`, "falha");
  }
  if (!resposta.ok) throw erroHTTP(nome, resposta.status);
  return jsonDe(resposta, nome);
}

/** Provedor efetivo da AI API Key (ou null se a chave não for reconhecida). */
function provedorDaChave(chave: string, escolhido: string): string | null {
  return escolhido === "auto" ? provedorPelaChave(chave) : escolhido;
}

/* ------------------------------------------------- geração: OpenRouter (API) */

/** Modelo de criação de imagem (texto → imagem) no OpenRouter. */
export const MODELO_OPENROUTER_CRIAR = "bytedance-seed/seedream-4.5";
/** Modelo que aceita foto de referência (edição / variação) no OpenRouter. */
export const MODELO_OPENROUTER_EDITAR = "openai/gpt-image-1";

/**
 * OpenRouter: POST /api/v1/images. Com `referencia`, envia a foto em
 * `input_references` (data URL) para criar uma variação dela.
 */
export async function gerarImagemOpenRouter(prompt: string, referencia: Buffer | null, chave: string): Promise<Buffer> {
  const corpo: Record<string, unknown> = {
    model: referencia ? MODELO_OPENROUTER_EDITAR : MODELO_OPENROUTER_CRIAR,
    prompt: `${prompt}\n\n${SEGURANCA_IMAGEM}`,
  };
  if (referencia) {
    corpo.input_references = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${referencia.toString("base64")}` } },
    ];
  }
  let resposta: Response;
  try {
    resposta = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(70000),
    });
  } catch {
    throw new ErroIA("Falha ao conectar ao OpenRouter para gerar a imagem. Tente novamente.", "falha");
  }
  if (resposta.status === 402) {
    throw new ErroIA("O OpenRouter está sem saldo para gerar imagens. Recarregue a conta e tente de novo.", "falha");
  }
  if (!resposta.ok) throw erroHTTP("OpenRouter", resposta.status);
  const json = (await jsonDe(resposta, "OpenRouter")) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new ErroIA("O OpenRouter não devolveu imagem.", "falha");
  return Buffer.from(b64, "base64");
}

/** Geração pela AI API Key: só funciona se a chave for do OpenRouter. */
export async function gerarImagemDireta(
  prompt: string,
  referencia: Buffer | null,
  chave: string,
  escolhido = "auto",
): Promise<Buffer> {
  const provedor = provedorDaChave(chave, escolhido);
  if (provedor === "openrouter") return gerarImagemOpenRouter(prompt, referencia, chave);
  throw new ErroIA(
    "Criar imagens precisa do Composio ou de uma AI API Key do OpenRouter. Troque a chave no /admin.",
    "nao_configurada",
  );
}

/* ---------------------------------------------------- geração: via Composio */

type EsquemaComposio = {
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
};

/** Procura a imagem gerada em qualquer formato que o Composio devolver. */
async function extrairImagemComposio(dado: unknown): Promise<Buffer | null> {
  const { extrairImagem } = await import("@/lib/banner");
  return extrairImagem(dado);
}

/** Nano Banana pelo Composio (mesmo caminho de ferramenta usado pelo banner da tela inicial). */
async function gerarComComposio(prompt: string, referencia: Buffer | null): Promise<Buffer | null> {
  const { chamarComposio, USUARIO_COMPOSIO } = await import("@/lib/composio");
  let esquema: EsquemaComposio | null = null;
  try {
    const t = await chamarComposio<{ input_parameters?: EsquemaComposio; inputParameters?: EsquemaComposio }>(
      "/tools/GEMINI_GENERATE_IMAGE",
    );
    esquema = t.input_parameters ?? t.inputParameters ?? null;
  } catch {
    esquema = null;
  }
  const props = esquema?.properties ?? {};
  const nomes = Object.keys(props);
  const args: Record<string, unknown> = {};
  const campoPrompt = nomes.find((n) => /^(prompt|text|instruction)s?$/i.test(n)) ?? "prompt";
  args[campoPrompt] = `${prompt}\n\n${SEGURANCA_IMAGEM}`;
  if (nomes.includes("aspect_ratio")) args.aspect_ratio = "1:1";
  if (referencia) {
    const campoImg = nomes.find(
      (n) => /image|imagem|reference|input_file|source/i.test(n) && !/aspect|size|count|number|format|output/i.test(n),
    );
    if (!campoImg) return null; // a ferramenta não aceita foto de entrada: não inventa a imagem
    const querLista = props[campoImg]?.type === "array";
    const valor = `data:image/jpeg;base64,${referencia.toString("base64")}`;
    args[campoImg] = querLista ? [valor] : valor;
  }
  const r = await chamarComposio<{ data?: unknown; successful?: boolean; error?: string | null }>(
    "/tools/execute/GEMINI_GENERATE_IMAGE",
    {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ user_id: USUARIO_COMPOSIO, arguments: args }),
    },
  );
  if (r.successful === false) return null;
  return extrairImagemComposio(r.data);
}

/* -------------------------------------------------------- visão: receber foto */

const PROMPT_VISAO = `Você é o Assistente do CopaLinks, que conversa de motorista para motorista em português do Brasil: simples, direto e amigável, sem sotaque nem gírias de região.

O motorista enviou uma imagem. Ela pode ser de QUALQUER assunto (objetos, lugares, documentos, plantas, animais, comida, peças de caminhão, paisagens, etc.). Responda à pergunta dele sobre a imagem; se não houver pergunta, descreva o que está vendo e o que pode ser útil.
- Diga quando a imagem estiver escura, cortada ou pequena demais para afirmar algo. Não invente dados que não aparecem na imagem.
- Não identifique pessoas pelo rosto.
- Se houver risco (freio, direção, vazamento, fumaça, fogo ou alguém ferido), dê primeiro a orientação de segurança.
- Responda em até ~1200 caracteres.`;

function textoDaVisao(pergunta: string, historico: { papel: string; texto: string }[]): string {
  const contexto = historico.length
    ? `Conversa até agora:\n${historico.map((h) => `${h.papel === "assistant" ? "Assistente" : "Motorista"}: ${h.texto}`).join("\n")}\n\n---\n`
    : "";
  return `${contexto}Pergunta do motorista sobre a imagem: ${pergunta || "O que você vê nesta imagem? Explique de forma útil."}`;
}

/** Analisa a foto com a AI API Key (visão). Groq não tem visão e fica de fora. */
export async function analisarImagemDireta(
  pergunta: string,
  imagem: Buffer,
  chave: string,
  escolhido = "auto",
  historico: { papel: string; texto: string }[] = [],
): Promise<string> {
  const provedor = provedorDaChave(chave, escolhido);
  const b64 = imagem.toString("base64");
  const texto = textoDaVisao(pergunta, historico);
  const timeoutMs = 45000;
  let resposta: string | undefined;

  if (provedor === "openai" || provedor === "openrouter") {
    const openrouter = provedor === "openrouter";
    const json = (await postJson(
      openrouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
      { Authorization: `Bearer ${chave}` },
      {
        model: openrouter ? "openai/gpt-4o-mini" : "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 800,
        messages: [
          { role: "system", content: PROMPT_VISAO },
          {
            role: "user",
            content: [
              { type: "text", text: texto },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
            ],
          },
        ],
      },
      nomeProvedorIA(provedor, chave) ?? "OpenAI",
      timeoutMs,
    )) as { choices?: { message?: { content?: string | null } }[] };
    resposta = json.choices?.[0]?.message?.content?.trim();
  } else if (provedor === "anthropic") {
    const json = (await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": chave, "anthropic-version": "2023-06-01" },
      {
        model: "claude-3-haiku-20240307",
        max_tokens: 800,
        temperature: 0.4,
        system: PROMPT_VISAO,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
              { type: "text", text: texto },
            ],
          },
        ],
      },
      "Anthropic",
      timeoutMs,
    )) as { content?: { text?: string }[] };
    resposta = json.content?.map((c) => c.text ?? "").join("").trim();
  } else if (provedor === "gemini") {
    const json = (await postJson(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      { "x-goog-api-key": chave },
      {
        systemInstruction: { role: "system", parts: [{ text: PROMPT_VISAO }] },
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: "image/jpeg", data: b64 } }, { text: texto }],
          },
        ],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2500 },
      },
      "Google Gemini",
      timeoutMs,
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    resposta = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  } else {
    throw new ErroIA(
      "Para analisar fotos, cadastre no /admin uma AI API Key da OpenAI, Anthropic, Google Gemini ou OpenRouter (o Groq não analisa imagens).",
      "nao_configurada",
    );
  }

  if (!resposta) throw new ErroIA("A IA não conseguiu analisar a imagem. Tente outra foto.", "falha");
  return resposta.slice(0, 3000);
}

/* -------------------------------------------------- orquestração com segredos */

async function credencialDireta() {
  const { obterSegredo } = await import("@/lib/admin/segredos");
  const chave = await obterSegredo("AI_API_KEY");
  const escolhido = (await obterSegredo("AI_PROVIDER")) ?? "auto";
  return { chave, escolhido };
}

/**
 * Cria uma imagem de qualquer assunto. Com `referencia`, usa a foto como base
 * (ex.: "transforma essa foto em desenho"). Sempre devolve JPEG reduzido.
 */
export async function gerarImagemIA(
  prompt: string,
  referencia: Buffer | null = null,
): Promise<{ imagem: Buffer; via: "composio" | "direta" }> {
  const { composioConfigurado } = await import("@/lib/composio");
  let erroComposio: unknown = null;
  if (await composioConfigurado()) {
    try {
      const img = await gerarComComposio(prompt, referencia);
      if (img) return { imagem: await normalizarImagem(img), via: "composio" };
    } catch (e) {
      erroComposio = e;
      console.error("[ia-imagem] Composio falhou ao gerar imagem; tentando a API direta", e);
    }
  }
  const { chave, escolhido } = await credencialDireta();
  if (chave) {
    const img = await gerarImagemDireta(prompt, referencia, chave, escolhido);
    return { imagem: await normalizarImagem(img), via: "direta" };
  }
  if (erroComposio) throw new ErroIA("A geração de imagem não respondeu. Tente de novo em instantes.", "falha");
  throw new ErroIA(
    "Geração de imagem não configurada: cadastre a COMPOSIO_API_KEY ou uma AI API Key do OpenRouter no /admin.",
    "nao_configurada",
  );
}

/** Analisa uma foto enviada pelo motorista com a AI API Key de visão. */
export async function analisarImagemIA(
  pergunta: string,
  imagem: Buffer,
  historico: { papel: string; texto: string }[] = [],
): Promise<string> {
  const { chave, escolhido } = await credencialDireta();
  if (!chave) {
    throw new ErroIA(
      "Para analisar fotos, cadastre no /admin uma AI API Key da OpenAI, Anthropic, Google Gemini ou OpenRouter.",
      "nao_configurada",
    );
  }
  return analisarImagemDireta(pergunta, imagem, chave, escolhido, historico);
}
