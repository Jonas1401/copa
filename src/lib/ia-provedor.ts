/** Chamadas server-side aos provedores configurados em AI_API_KEY. */
export type MensagemProvedorIA = { role: string; content: string };
export type ProvedorIA = "openai" | "anthropic" | "gemini" | "groq" | "openrouter";
export type CodigoErroIA = "nao_configurada" | "falha";

export class ErroIA extends Error {
  constructor(mensagem: string, public codigo: CodigoErroIA) {
    super(mensagem);
    this.name = "ErroIA";
  }
}

type OpcoesChat = { temperatura?: number; maxTokens?: number; timeoutMs?: number };

const NOMES: Record<ProvedorIA, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
};

export function provedorPelaChave(chave: string): ProvedorIA | null {
  if (chave.startsWith("sk-ant-")) return "anthropic";
  if (chave.startsWith("sk-or-")) return "openrouter";
  if (chave.startsWith("gsk_")) return "groq";
  if (chave.startsWith("AIza")) return "gemini";
  if (chave.startsWith("sk-")) return "openai";
  return null;
}

export function nomeProvedorIA(provedorEscolhido: string, chave = ""): string | null {
  const provedor = provedorEscolhido === "auto" ? provedorPelaChave(chave) : provedorEscolhido;
  return typeof provedor === "string" && Object.prototype.hasOwnProperty.call(NOMES, provedor)
    ? NOMES[provedor as ProvedorIA]
    : null;
}

function mensagemErroHTTP(provedor: ProvedorIA, status: number): ErroIA {
  const nome = NOMES[provedor];
  if (status === 401 || status === 403) {
    return new ErroIA(`${nome} recusou a chave de IA. Confira a AI API Key no /admin.`, "nao_configurada");
  }
  return new ErroIA(`${nome} respondeu ${status}.`, "falha");
}

async function jsonSeguro(resposta: Response, provedor: ProvedorIA): Promise<Record<string, unknown>> {
  try {
    return (await resposta.json()) as Record<string, unknown>;
  } catch {
    throw new ErroIA(`${NOMES[provedor]} devolveu uma resposta inválida.`, "falha");
  }
}

/** Envia conversa para o provedor direto. Não faz leitura de URLs por conta própria. */
export async function chatDiretoIA(
  mensagens: MensagemProvedorIA[],
  chave: string,
  provedorEscolhido: string,
  opcoes: OpcoesChat = {},
): Promise<string> {
  const provedor = (provedorEscolhido === "auto" ? provedorPelaChave(chave) : provedorEscolhido) as ProvedorIA | null;
  if (!provedor || !Object.prototype.hasOwnProperty.call(NOMES, provedor)) {
    throw new ErroIA("Provedor de IA não reconhecido. Escolha o provedor no /admin.", "nao_configurada");
  }

  const sistema = mensagens.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversa = mensagens.filter((m) => m.role !== "system");
  const temperatura = opcoes.temperatura ?? 0.4;
  const maxTokens = opcoes.maxTokens ?? 700;
  const timeout = AbortSignal.timeout(opcoes.timeoutMs ?? 30000);

  try {
    let resposta: Response;

    if (provedor === "anthropic") {
      resposta = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": chave,
          "anthropic-version": "2023-06-01",
        },
        signal: timeout,
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: maxTokens,
          temperature: temperatura,
          ...(sistema ? { system: sistema } : {}),
          messages: conversa.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
        }),
      });
      if (!resposta.ok) throw mensagemErroHTTP(provedor, resposta.status);
      const json = await jsonSeguro(resposta, provedor) as { content?: { text?: string }[] };
      const texto = json.content?.map((c) => c.text ?? "").join("").trim();
      if (texto) return texto;
    } else if (provedor === "gemini") {
      resposta = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        signal: timeout,
        body: JSON.stringify({
          ...(sistema ? { systemInstruction: { role: "system", parts: [{ text: sistema }] } } : {}),
          contents: conversa.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { temperature: temperatura, maxOutputTokens: maxTokens },
        }),
      });
      if (!resposta.ok) throw mensagemErroHTTP(provedor, resposta.status);
      const json = await jsonSeguro(resposta, provedor) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const texto = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (texto) return texto;
    } else {
      const alvo = provedor === "groq"
        ? { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" }
        : provedor === "openrouter"
          ? { url: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-4o-mini" }
          : { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" };
      resposta = await fetch(alvo.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
        signal: timeout,
        body: JSON.stringify({
          model: alvo.model,
          temperature: temperatura,
          max_tokens: maxTokens,
          messages: [{ role: "system", content: sistema }, ...conversa],
        }),
      });
      if (!resposta.ok) throw mensagemErroHTTP(provedor, resposta.status);
      const json = await jsonSeguro(resposta, provedor) as {
        choices?: { message?: { content?: string | null } }[];
      };
      const texto = json.choices?.[0]?.message?.content?.trim();
      if (texto) return texto;
    }

    throw new ErroIA("Resposta vazia do provedor de IA.", "falha");
  } catch (erro) {
    if (erro instanceof ErroIA) throw erro;
    throw new ErroIA(`Falha ao conectar ao ${NOMES[provedor]}. Tente novamente.`, "falha");
  }
}
