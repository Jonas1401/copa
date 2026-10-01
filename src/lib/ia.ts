import { obterSegredo, semSegredos } from "@/lib/admin/segredos";
import { chatViaComposio, chatViaGeminiComposio, composioConfigurado, ErroComposio } from "@/lib/composio";

/**
 * Assistente de IA do CopaLinks — SOMENTE servidor.
 *
 * Caminho principal: TUDO VIA COMPOSIO (toolkit OpenAI, com a conta OpenAI
 * conectada no dashboard do Composio). Reserva: AI_API_KEY do cofre (/admin),
 * chamada direta ao provedor. A ordem é sempre: Composio primeiro.
 *
 * O assistente responde sobre:
 *   1. Mecânica pesada (caminhões e carretas): do simples ao avançado.
 *   2. Como funciona o próprio aplicativo CopaLinks.
 *   3. Clima no porto (recebe o resumo atual como contexto quando relevante).
 */

export class ErroIA extends Error {
  constructor(
    mensagem: string,
    public codigo: "nao_configurada" | "falha",
  ) {
    super(mensagem);
  }
}

const PROMPT_SISTEMA = `Você é o Assistente do CopaLinks, o app dos motoristas de caminhão do Porto de Paranaguá (PR). Você conversa de motorista para motorista: como um parceiro de estrada que já rodou muito, conhece caminhão, pátio, balança e fila, e gosta de ajudar o colega.

JEITO DE ESCREVER:
- Português do Brasil do dia a dia, humano, descontraído e acolhedor. Trate a pessoa por "você" e, quando souber o nome, chame pelo primeiro nome de vez em quando.
- Frases curtas e diretas, como numa conversa entre colegas. Pode usar expressões comuns de estrada que todo brasileiro entende ("tranquilo", "beleza", "bora", "valeu", "firmeza", "fica esperto"), sem exagero e sem repetir a mesma em toda resposta.
- NÃO use sotaque nem gírias de nenhuma região específica e não escreva imitando pronúncia. Nada de caricatura e nada de palavrão.
- Um emoji aqui e ali pode (🚛 👍 ⚠️), no máximo um ou dois por resposta.
- Nunca se apresente como mecânico nem use nome próprio. Se perguntarem quem é você, diga que é o assistente do CopaLinks.
- Termos técnicos, peças, números e instruções sempre em português claro e correto. Quando faltar informação (sintoma, placa, navio), pergunte em vez de chutar.
- Se houver risco (freio, direção, vazamento, superaquecimento, fumaça), deixe a descontração de lado e dê primeiro a orientação de segurança, direto ao ponto.

SUAS 4 FUNÇÕES:
1. CAMINHÃO E MECÂNICA (truck, cavalo/carreta, diesel): do simples ao avançado — preventiva, freios (inclusive freio motor e retarder), suspensão, direção, embreagem, câmbio, diferencial, arla 32, turbo, arrefecimento, elétrica, pneus, 5ª roda, tacógrafo. Sempre que houver risco de segurança (freio, direção, suspensão, vazamento de diesel/ar), avise claramente: "não rode assim, chame socorro/guincho".
2. O APP COPALINKS: explique como usar — cadastrar ponto (tipo TRUCK ou CAVALO/C + livro A/B/M + número), monitorar a fila a cada 5 segundos, notificações quando o número é chamado/sai/volta/chega perto, tela de tempo (Paranaguá), cálculo de frete por foto do ticket, contatos/WhatsApp da equipe, chat dos motoristas, serviços (login, consulta de ponto, APPA, SINPRAPAR) e /admin (só administrador).
3. CLIMA NO PORTO: quando receber o "Clima atual" no contexto, use esses dados reais (temperatura, chuva, vento, boletim APPA) para orientar: chuva forte = pista lisa e fila lenta; vento forte = cuidado com carreta vazia; neblina = farol baixo e distância.

4. NAVIOS NO PORTO (foco em FERTILIZANTES): quando receber o line-up da APPA, as manobras do SINPRAPAR e a maré, responda sobre qualquer navio de Paranaguá ou Antonina: berço, carga, toneladas, chegada, ETA/ETB, atracação e saldo. Dê destaque aos fertilizantes (ureia, MAP, DAP, cloreto de potássio, sulfato de amônio, nitratos, NPK…). Analise a maré de forma prática: compare a hora da manobra e o calado com as próximas preamares e baixa-mares, sem inventar regras oficiais. Diga de onde veio a informação (line-up APPA, SINPRAPAR ou pesquisa na web). Se o dado não estiver no contexto, diga que não encontrou. Nunca invente tonelagem, horário ou berço.

REGRAS:
- Responda em português, no máximo ~1200 caracteres.
- Se a pergunta for de outro assunto (futebol, política, etc.), diga gentilmente que só ajuda com caminhão, clima do porto, navios do porto e o app.
- Nunca invente valores de peças/serviços; diga que varia por oficina e região.
- Nunca peça dados pessoais além do que o app já tem.
- Em emergência (freio sem pressão, direção solta, fumaça no motor): priorize a segurança ANTES de qualquer explicação técnica.`;

/** A pergunta fala de clima/tempo? Aí anexamos o resumo real do porto. */
function querClima(texto: string) {
  return /clima|tempo|chuva|chover|vento|neblina|nevoeiro|tempestade|porto|onda|maré|mare/i.test(texto);
}

/** A pergunta fala de navio/porto/atracação/fertilizante? Anexa line-up, manobras e maré. */
function querNavios(texto: string) {
  return /navio|embarca|atrac|ber[cç]o|line-?up|fundead|ao largo|fertiliz|adubo|ureia|uréia|pot[aá]ss|kcl|\bmap\b|\bdap\b|npk|nitrato|sulfato|fosfat|tonelad|mar[eé]|calado|pr[aá]tic|antonina|appa|sinprapar|imo\b/i.test(texto);
}

/** Pede posição/rota atual? Aí pesquisa na web (VesselFinder/MarineTraffic/Google) pelo Composio. */
function querPosicao(texto: string) {
  return /onde (est[aá]|fica|anda)|posi[cç][aã]o|localiza|rota|vindo|destino|chega quando|quando chega|vesselfinder|marinetraffic|rastre/i.test(texto);
}

async function contextoNavios(pergunta: string): Promise<string> {
  try {
    const { ehFertilizante, lerLineup, lerManobras, lerMares, linhaNavio, resumoMares } = await import("@/lib/navios");
    const [lineup, manobras, mares] = await Promise.all([
      lerLineup(),
      lerManobras().catch(() => []),
      lerMares().catch(() => []),
    ]);
    const p = pergunta.toUpperCase();
    const citados = lineup.filter((n) => n.nome.length >= 3 && p.includes(n.nome.toUpperCase()));
    const vistos = new Set<string>();
    const unicos = (lista: typeof lineup) => lista.filter((n) => {
      const k = `${n.programacao}:${n.secao}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    const ordem = ["ATRACADOS", "PROGRAMADOS", "AO LARGO PARA REATRACAÇÃO", "AO LARGO", "ESPERADOS"];
    const fert = unicos(citados).concat(unicos(
      lineup.filter((n) => ehFertilizante(n.mercadoria) && ordem.includes(n.secao))
        .sort((a, b) => ordem.indexOf(a.secao) - ordem.indexOf(b.secao)),
    )).slice(0, 30);
    let txt = `\n\nLine-up oficial (APPA, Paranaguá e Antonina) e manobras da praticagem (SINPRAPAR), lidos agora:\n`;
    txt += fert.length ? fert.map((n) => `- ${linhaNavio(n, manobras)}`).join("\n") : "- nenhum navio de fertilizante no line-up agora";
    if (mares.length) txt += `\nMaré na baía de Paranaguá (referência Open-Meteo, não é a tábua oficial): ${resumoMares(mares, 8)}.`;

    if (querPosicao(pergunta)) {
      const alvo = citados[0]?.nome ?? pergunta.slice(0, 120);
      try {
        const { executarFerramenta } = await import("@/lib/composio");
        const r = await executarFerramenta("COMPOSIO_SEARCH_WEB", {
          arguments: { query: `${alvo} navio IMO ${citados[0]?.imo ?? ""} posição atual vesselfinder marinetraffic Paranaguá` },
          userId: "copalinks-servidor",
        });
        const bruto = JSON.stringify(r.data ?? {}).slice(0, 3500);
        if (bruto.length > 20) txt += `\nPesquisa na web (Composio, pode estar desatualizada): ${bruto}`;
      } catch {
        /* sem pesquisa: responde com o line-up */
      }
    }
    return txt;
  } catch {
    return "\n\n(Não consegui ler o line-up da APPA agora.)";
  }
}

/** A pergunta fala da fila/ponto? Aí anexamos o estado atual do monitor. */
function querFila(texto: string) {
  return /fila|ponto|vez|posição|posicao|escalad|quadro|livro|truck|cavalo|monitor/i.test(texto);
}

async function contextoClima(): Promise<string> {
  try {
    const { obterPrevisao, resumoEmTexto } = await import("@/lib/tempo");
    const p = await obterPrevisao();
    return `\n\nClima atual (dados reais do porto, ${new Date(p.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}): ${resumoEmTexto(p)}`;
  } catch {
    return "";
  }
}

async function contextoFila(motoristaId: number | null): Promise<string> {
  try {
    const { montarEstado } = await import("@/lib/estado");
    // Só os pontos de quem perguntou: a IA não vê nem cita números de outros.
    const e = await montarEstado(motoristaId);
    const linhas = e.pontos
      .slice(0, 8)
      .map((p) => `${p.tipo} ${p.codigo}: ${p.status === "NA VEZ" ? "NA VEZ!" : p.status === "SAIU" ? "saiu" : `${p.naFrente} na frente`}`)
      .join(" · ");
    return `\n\nMonitor agora (${e.online ? "online" : "offline"}, ${e.tabelas}/6 tabelas lidas): ${linhas || "nenhum ponto cadastrado"}. Última leitura: ${e.atualizadoEm}.`;
  } catch {
    return "";
  }
}

function provedorPelaChave(chave: string) {
  if (chave.startsWith("sk-ant-")) return "anthropic";
  if (chave.startsWith("sk-or-")) return "openrouter";
  if (chave.startsWith("gsk_")) return "groq";
  if (chave.startsWith("AIza")) return "gemini";
  if (chave.startsWith("sk-")) return "openai";
  return null;
}

/** Chamada direta ao provedor (reserva quando o Composio falha). */
async function chatDireto(
  mensagens: { role: string; content: string }[],
  chave: string,
  provedorEscolhido: string,
): Promise<string> {
  const provedor = provedorEscolhido === "auto" ? provedorPelaChave(chave) : provedorEscolhido;
  const sistema = mensagens.find((m) => m.role === "system")?.content ?? PROMPT_SISTEMA;
  const conversa = mensagens.filter((m) => m.role !== "system");

  if (provedor === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 700,
        system: sistema,
        messages: conversa.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      }),
    });
    if (!r.ok) throw new ErroIA(`Provedor de IA respondeu ${r.status}.`, "falha");
    const j = (await r.json()) as { content?: { text?: string }[] };
    const t = j.content?.map((c) => c.text ?? "").join("").trim();
    if (!t) throw new ErroIA("Resposta vazia do provedor de IA.", "falha");
    return t;
  }

  if (provedor === "gemini") {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(chave)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          systemInstruction: { role: "system", parts: [{ text: sistema }] },
          contents: conversa.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
        }),
      },
    );
    if (!r.ok) throw new ErroIA(`Provedor de IA respondeu ${r.status}.`, "falha");
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const t = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!t) throw new ErroIA("Resposta vazia do provedor de IA.", "falha");
    return t;
  }

  // OpenAI / Groq / OpenRouter: API compatível com OpenAI.
  const alvo =
    provedor === "groq"
      ? { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", nome: "Groq" }
      : provedor === "openrouter"
        ? { url: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-4o-mini", nome: "OpenRouter" }
        : provedor === "openai"
          ? { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", nome: "OpenAI" }
          : null;
  if (!alvo) throw new ErroIA("Provedor de IA não reconhecido. Escolha o provedor no /admin.", "nao_configurada");
  const r = await fetch(alvo.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: alvo.model,
      temperature: 0.4,
      max_tokens: 700,
      messages: [{ role: "system", content: sistema }, ...conversa],
    }),
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new ErroIA(`${alvo.nome} recusou a chave de IA. Confira a AI API Key no /admin.`, "nao_configurada");
    }
    throw new ErroIA(`${alvo.nome} respondeu ${r.status}.`, "falha");
  }
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const t = j.choices?.[0]?.message?.content?.trim();
  if (!t) throw new ErroIA("Resposta vazia do provedor de IA.", "falha");
  return t;
}

export type HistoricoIA = { papel: "user" | "assistant"; texto: string }[];

/**
 * Pergunta ao assistente. Ordem: 1º Composio (toolkit OpenAI), 2º AI_API_KEY
 * direta. Enriquece com clima/fila reais quando a pergunta pede.
 */
export async function perguntarIA(
  pergunta: string,
  historico: HistoricoIA = [],
  /** Quem perguntou: a IA só recebe os pontos DESTE motorista. */
  motoristaId: number | null = null,
): Promise<{ texto: string; via: "composio" | "direta" }> {
  const limpa = pergunta.trim().slice(0, 1000);
  if (!limpa) throw new ErroIA("Escreva sua pergunta.", "falha");

  let contexto = "";
  if (querClima(limpa)) contexto += await contextoClima();
  if (querFila(limpa)) contexto += await contextoFila(motoristaId);
  if (querNavios(limpa)) contexto += await contextoNavios(limpa);

  const mensagens = [
    { role: "system", content: PROMPT_SISTEMA },
    ...historico.slice(-10).map((h) => ({ role: h.papel, content: h.texto.slice(0, 2000) })),
    { role: "user", content: limpa + contexto },
  ];

  // 1º: VIA COMPOSIO (o pedido do dono: tudo pelo Composio).
  if (await composioConfigurado()) {
    // Gemini sem login pelo Composio: funciona só com a COMPOSIO_API_KEY,
    // sem conta conectada e sem chave de IA própria.
    try {
      const texto = await chatViaGeminiComposio(mensagens);
      return { texto: texto.slice(0, 3000), via: "composio" };
    } catch (e) {
      console.error("[ia] Gemini pelo Composio falhou; tentando OpenAI pelo Composio", e);
    }
    try {
      const texto = await chatViaComposio(mensagens);
      return { texto: texto.slice(0, 3000), via: "composio" };
    } catch (e) {
      // Sem conta OpenAI conectada no Composio: cai para a chave direta.
      const semConta =
        e instanceof ErroComposio && (e.status === 401 || e.status === 403 || e.status === 404);
      const chaveDireta = await obterSegredo("AI_API_KEY");
      if (!semConta && !chaveDireta) {
        throw new ErroIA(
          e instanceof Error ? semSegredos(e.message, [chaveDireta]) : "Falha na IA.",
          "falha",
        );
      }
      if (!chaveDireta) {
        throw new ErroIA(
          "IA indisponível: conecte a conta OpenAI no dashboard do Composio (Apps → OpenAI → Connect) ou cadastre a AI API Key no /admin.",
          "nao_configurada",
        );
      }
      // Tem chave direta: tenta como reserva.
      try {
        const provedor = (await obterSegredo("AI_PROVIDER")) ?? "auto";
        const texto = await chatDireto(mensagens, chaveDireta, provedor);
        return { texto: texto.slice(0, 3000), via: "direta" };
      } catch (e2) {
        if (e2 instanceof ErroIA) throw e2;
        throw new ErroIA("A IA não respondeu. Tente de novo em instantes.", "falha");
      }
    }
  }

  // 2º: sem Composio, só a chave direta.
  const chave = await obterSegredo("AI_API_KEY");
  if (!chave) {
    throw new ErroIA(
      "IA ainda não configurada: cadastre a COMPOSIO_API_KEY (com conta OpenAI conectada) ou a AI API Key no /admin.",
      "nao_configurada",
    );
  }
  const provedor = (await obterSegredo("AI_PROVIDER")) ?? "auto";
  const texto = await chatDireto(mensagens, chave, provedor);
  return { texto: texto.slice(0, 3000), via: "direta" };
}
