import { MEMORIA_POLITICA_PORTO } from "@/lib/politica-automacao";
import { contextoOrientacoesPorto, garantirMemoriaPorto, lerMemoriaClima, memorizarClima } from "@/lib/ia-memoria-porto";
import { obterSegredo, semSegredos } from "@/lib/admin/segredos";
import { chatViaComposio, chatViaGeminiComposio, composioConfigurado, ErroComposio } from "@/lib/composio";
import { chatDiretoIA, ErroIA } from "@/lib/ia-provedor";
export { ErroIA };

/**
 * Assistente de IA do CopaLinks — SOMENTE servidor.
 *
 * Para perguntas de navios, a AI_API_KEY configurada é a primeira opção para
 * interpretar os dados recentes dos sites já lidos pelo Composio. Nos demais
 * assuntos, a ordem permanece Composio primeiro e API direta como reserva.
 *
 * A leitura das páginas é feita no backend; o modelo nunca recebe uma URL para
 * navegar por conta própria. Avisos automáticos continuam determinísticos.
 */

const PROMPT_SISTEMA = `Você é o Assistente do CopaLinks, o app dos motoristas de caminhão do Porto de Paranaguá (PR). Você conversa de motorista para motorista: como um parceiro de estrada que já rodou muito, conhece caminhão, pátio, balança e fila, e gosta de ajudar o colega.

JEITO DE ESCREVER:
- Português do Brasil do dia a dia, humano, descontraído e acolhedor. Trate a pessoa por "você" e, quando souber o nome, chame pelo primeiro nome de vez em quando.
- Frases curtas e diretas, como numa conversa entre colegas. Pode usar expressões comuns de estrada que todo brasileiro entende ("tranquilo", "beleza", "bora", "valeu", "firmeza", "fica esperto"), sem exagero e sem repetir a mesma em toda resposta.
- NÃO use sotaque nem gírias de nenhuma região específica e não escreva imitando pronúncia. Nada de caricatura e nada de palavrão.
- Um emoji aqui e ali pode (🚛 👍 ⚠️), no máximo um ou dois por resposta.
- Nunca se apresente como mecânico nem use nome próprio. Se perguntarem quem é você, diga que é o assistente do CopaLinks.
- Termos técnicos, peças, números e instruções sempre em português claro e correto. Quando faltar informação (sintoma, placa, navio), pergunte em vez de chutar.
- Se houver risco (freio, direção, vazamento, superaquecimento, fumaça), deixe a descontração de lado e dê primeiro a orientação de segurança, direto ao ponto.

SUAS FUNÇÕES:
1. CAMINHÃO E MECÂNICA (truck, cavalo/carreta, diesel): do simples ao avançado — preventiva, freios (inclusive freio motor e retarder), suspensão, direção, embreagem, câmbio, diferencial, arla 32, turbo, arrefecimento, elétrica, pneus, 5ª roda, tacógrafo. Sempre que houver risco de segurança (freio, direção, suspensão, vazamento de diesel/ar), avise claramente: "não rode assim, chame socorro/guincho".
2. O APP COPALINKS: explique como usar — cadastrar ponto (tipo TRUCK ou CAVALO/C + livro A/B/M + número), monitorar a fila a cada 5 segundos, notificações quando o número é chamado/sai/volta/chega perto, tela de tempo (Paranaguá), cálculo de frete por foto do ticket, contatos/WhatsApp da equipe, chat dos motoristas, serviços (login, consulta de ponto, APPA, SINPRAPAR) e /admin (só administrador).
3. CLIMA NO PORTO: quando receber o "Clima atual" no contexto, use esses dados reais (temperatura, chuva, vento, boletim APPA) para orientar: chuva forte = pista lisa e fila lenta; vento forte = cuidado com carreta vazia; neblina = farol baixo e distância.

4. NAVIOS NO PORTO: use os dados literais dos sites CopaLinks de navios atracados e manobras previstas, lidos pelo Composio ou conservados na memória com data da leitura. Responda sobre um navio por vez e cite o link da fonte. Saldo Total do Navio é diferente do saldo de uma operadora. Preserve todos os decimais e a grafia dos nomes; nunca invente tonelagem, horário ou berço. PREVISTA não é confirmação e EF (entrada e fundeio) não é atracação. Se a leitura for antiga, diga quando foi lida. Se um dado não estiver no contexto, diga que não encontrou.
5. ORIENTAÇÕES DO PORTO: responda às perguntas usando as orientações cadastradas no contexto; elas não substituem as regras oficiais vigentes. Não envie dicas espontâneas de comportamento junto de respostas sobre navios.

REGRAS:
- Responda em português, no máximo ~1200 caracteres.
- Se a pergunta for de outro assunto (futebol, política, etc.), diga gentilmente que só ajuda com caminhão, clima do porto, navios do porto e o app.
- Nunca invente valores de peças/serviços; diga que varia por oficina e região.
- Nunca peça dados pessoais além do que o app já tem.
- Em emergência (freio sem pressão, direção solta, fumaça no motor): priorize a segurança ANTES de qualquer explicação técnica.`;

/** A pergunta fala de clima/tempo? Aí anexamos o resumo real do porto. */
function querClima(texto: string) {
  return /clima|tempo|chuva|chover|vento|neblina|nevoeiro|tempestade|onda|maré|mare/i.test(texto);
}

/** A pergunta fala de navio/porto/atracação/fertilizante? Anexa line-up, manobras e maré. */
function querNavios(texto: string) {
  return /navio|embarca|atrac|ber[cç]o|line-?up|fundead|ao largo|fertiliz|adubo|ureia|uréia|pot[aá]ss|kcl|\bmap\b|\bdap\b|npk|nitrato|sulfato|fosfat|tonelad|mar[eé]|calado|pr[aá]tic|antonina|appa|sinprapar|imo\b/i.test(texto);
}

/** A consulta não altera a fila de avisos nem publica no chat coletivo. */
async function contextoNavios(pergunta: string): Promise<string> {
  try {
    const { contextoNaviosComposio } = await import("@/lib/navios-monitor");
    return await contextoNaviosComposio(pergunta);
  } catch {
    return "\n\nNão consegui ler as fontes de navios pelo Composio agora. Não invente dados atuais.";
  }
}

/** A pergunta fala da fila/ponto? Aí anexamos o estado atual do monitor. */
function querFila(texto: string) {
  return /fila|ponto|vez|posição|posicao|escalad|quadro|livro|truck|cavalo|monitor/i.test(texto);
}

async function contextoClima(): Promise<string> {
  const { obterPrevisao, resumoEmTexto } = await import("@/lib/tempo");
  try {
    const p = await obterPrevisao();
    if (!Object.values(p.fontes).some(Boolean)) throw new Error("Fontes de clima indisponíveis.");
    await memorizarClima(p).catch(() => null);
    return `\n\nClima atual (dados reais do porto, ${new Date(p.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}): ${resumoEmTexto(p)}`;
  } catch {
    const p = await lerMemoriaClima().catch(() => null);
    return p ? `\n\nClima da última leitura SALVA em ${p.atualizadoEm}; pode estar desatualizado. Não apresentar como tempo atual: ${resumoEmTexto(p)}` : "\n\nClima atual indisponível; não invente previsão.";
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

export type HistoricoIA = { papel: "user" | "assistant"; texto: string }[];

/**
 * Pergunta ao assistente. Navios: API direta configurada → Composio de reserva.
 * Outros assuntos: Composio → AI_API_KEY de reserva. O contexto dos navios é
 * sempre montado antes da geração a partir das fontes fixadas do CopaLinks.
 */
export async function perguntarIA(
  pergunta: string,
  historico: HistoricoIA = [],
  /** Quem perguntou: a IA só recebe os pontos DESTE motorista. */
  motoristaId: number | null = null,
): Promise<{ texto: string; via: "composio" | "direta" }> {
  const limpa = pergunta.trim().slice(0, 1000);
  if (!limpa) throw new ErroIA("Escreva sua pergunta.", "falha");

  await garantirMemoriaPorto().catch(() => null);
  let contexto = "";
  if (/porto|regra|seguran[cç]a|comport|orienta|far[oó]l|lona|costado|guindaste|funil/i.test(limpa)) contexto += await contextoOrientacoesPorto().catch(() => "");
  if (querClima(limpa)) contexto += await contextoClima();
  if (querFila(limpa)) contexto += await contextoFila(motoristaId);
  const perguntaSobreNavios = querNavios(limpa);
  if (perguntaSobreNavios) contexto += await contextoNavios(limpa);

  const mensagens = [
    { role: "system", content: PROMPT_SISTEMA + "\n\n" + MEMORIA_POLITICA_PORTO },
    ...historico.slice(-10).map((h) => ({ role: h.papel, content: h.texto.slice(0, 2000) })),
    { role: "user", content: limpa + contexto },
  ];

  const chaveDireta = await obterSegredo("AI_API_KEY");
  const provedorDireto = (await obterSegredo("AI_PROVIDER")) ?? "auto";
  let erroDiretoNavios: unknown = null;

  // A nova API responde primeiro às consultas de navios usando o contexto
  // validado dos sites existentes. Se falhar, Composio continua como reserva.
  if (perguntaSobreNavios && chaveDireta) {
    try {
      const texto = await chatDiretoIA(mensagens, chaveDireta, provedorDireto);
      return { texto: texto.slice(0, 3000), via: "direta" };
    } catch (e) {
      erroDiretoNavios = e;
      console.error("[ia] API direta falhou em consulta de navios; tentando Composio", e);
    }
  }

  if (await composioConfigurado()) {
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
      const semConta = e instanceof ErroComposio && (e.status === 401 || e.status === 403 || e.status === 404);
      if (erroDiretoNavios) throw erroDiretoNavios;
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
      try {
        const texto = await chatDiretoIA(mensagens, chaveDireta, provedorDireto);
        return { texto: texto.slice(0, 3000), via: "direta" };
      } catch (e2) {
        if (e2 instanceof ErroIA) throw e2;
        throw new ErroIA("A IA não respondeu. Tente de novo em instantes.", "falha");
      }
    }
  }

  if (erroDiretoNavios) throw erroDiretoNavios;
  if (!chaveDireta) {
    throw new ErroIA(
      "IA ainda não configurada: cadastre a COMPOSIO_API_KEY (com conta OpenAI conectada) ou a AI API Key no /admin.",
      "nao_configurada",
    );
  }
  const texto = await chatDiretoIA(mensagens, chaveDireta, provedorDireto);
  return { texto: texto.slice(0, 3000), via: "direta" };
}
