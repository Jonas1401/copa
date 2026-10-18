import { MEMORIA_POLITICA_PORTO } from "@/lib/politica-automacao";
import { contextoOrientacoesPorto, garantirMemoriaPorto, lerMemoriaClima, memorizarClima } from "@/lib/ia-memoria-porto";
import { obterSegredo, semSegredos } from "@/lib/admin/segredos";
import { chatViaComposio, chatViaGeminiComposio, composioConfigurado, ErroComposio } from "@/lib/composio";
import { chatDiretoIA, ErroIA } from "@/lib/ia-provedor";
export { ErroIA };

/**
 * Assistente de IA do CopaLinks — SOMENTE servidor.
 *
 * Para cada pergunta sobre navios, o backend tenta uma leitura HTTP atual das
 * fontes; se a página não puder ser lida diretamente, usa o Composio como
 * reserva e identifica quando só há uma leitura salva. A AI_API_KEY configurada
 * interpreta esse contexto. Nos demais assuntos, a ordem permanece Composio
 * primeiro e API direta como reserva.
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

4. NAVIOS NO PORTO: em cada pergunta sobre navios, use os dados atuais que o servidor acabou de tentar ler dos sites CopaLinks; o HTTP direto é tentado primeiro e o Composio é a reserva. Para manobras, ações, situação, data, hora e berço, priorize e cite https://berth-bloom-tracker.lovable.app/; preserve o texto e os valores exatamente como aparecem nessa página. Para navios atracados e saldos, cite https://berth-bloom-buddy.lovable.app/. Responda sobre um navio por vez. Saldo Total do Navio é diferente do saldo de uma operadora. Nunca invente tonelagem, horário ou berço, nem complete dados ausentes usando outro navio. PREVISTA não é confirmação e EF (entrada e fundeio) não é atracação. Se o contexto disser que a fonte falhou e só há uma leitura salva, diga quando foi lida e que pode estar desatualizada. Se o navio não estiver nos registros dessa fonte, diga que não encontrou; não use dados de uma embarcação parecida.
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

/** A pergunta fala de navio/porto/atracação/fertilizante? Anexa os dados atuais. */
const PADRAO_NAVIOS = /navio|barco|embarca|atrac|ber[cç]o|line-?up|fundead|ao largo|fertiliz|adubo|ureia|uréia|pot[aá]ss|kcl|\bmap\b|\bdap\b|npk|nitrato|sulfato|fosfat|tonelad|mar[eé]|calado|pr[aá]tic|antonina|appa|sinprapar|imo\b|manobra|desatrac|descarga|cheg|\bet[ab]\b|programad|praticagem/i;
function querNavios(texto: string, historico: HistoricoIA = []) {
  if (PADRAO_NAVIOS.test(texto)) return true;
  const ultimaPergunta = [...historico].reverse().find((m) => m.papel === "user")?.texto ?? "";
  const continuidade = /^(?:e\b|mas\b|ele\b|ela\b|esse\b|essa\b|isso\b|qual\b|como\b|quando\b|onde\b|tem\b|me\s+(?:fala|diz|conta))/i;
  return PADRAO_NAVIOS.test(ultimaPergunta) && continuidade.test(texto.trim());
}

/** A consulta não altera a fila de avisos nem publica no chat coletivo. */
async function contextoNavios(pergunta: string): Promise<string> {
  try {
    const { contextoNaviosAtual } = await import("@/lib/navios-monitor");
    return await contextoNaviosAtual(pergunta);
  } catch {
    return "\n\nNão consegui ler as fontes de navios nesta pergunta. Não invente dados atuais.";
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
  const perguntaSobreNavios = querNavios(limpa, historico);
  if (perguntaSobreNavios) {
    const consultaNavios = [...historico.filter((h) => h.papel === "user").slice(-2).map((h) => h.texto), limpa].join("\n");
    contexto += await contextoNavios(consultaNavios);
  }

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
