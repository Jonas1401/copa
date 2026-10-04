import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, configuracao } from "@/db/schema";
import { obterPrevisao, type Previsao } from "@/lib/tempo";
import { notificarMensagemChat } from "@/lib/chat-push";
import { geminiViaComposio } from "@/lib/composio";
import { verificarEPostarBoletimClima } from "@/lib/clima-boletim";

/**
 * Leitura inteligente do clima → mensagem no chat (SOMENTE servidor).
 *
 * O cron (/api/cron, a cada minuto) chama `verificarClima()` depois da
 * varredura da fila. Quando o alerta do porto é relevante (chuva ou vento, ou
 * boletim da APPA com tempo ruim), o servidor posta UMA mensagem no chat dos
 * motoristas como "🌦️ Clima no Porto" (motorista_id = 0 = sistema) e manda
 * Push para todos os aparelhos. Sem alerta, quem fala é o boletim de previsão
 * do turno (`src/lib/clima-boletim.ts`, "🌤️ Previsão do Porto").
 *
 * PLANO ANTI-EXCESSO (v2 — 2026):
 *   - Antes: repetia a cada 3 h enquanto alerta ativo (até 8x/dia).
 *   - Agora: só posta quando o nível MUDA. Se persistir, 1 lembrete após 6 h
 *     (não a cada 3 h) e depois silêncio até mudar de nível. Máx 2-3/dia.
 *   - Níveis calmos ("tempo-bom", "info") não postam — só limpam o estado.
 *   - O estado fica em `configuracao` (chave clima_ultimo_aviso_chat).
 */

export const NOME_CLIMA = "🌦️ Clima no Porto";
export const MOTORISTA_SISTEMA = 0;
const CHAVE = "clima_ultimo_aviso_chat";
/** Lembrete do mesmo nível: só após 6 h (antes 3 h) — anti-spam. */
const LEMBRETE_MS = 6 * 60 * 60 * 1000;

type Ultimo = { nivel: string; titulo: string; em: number };

async function lerUltimo(): Promise<Ultimo | null> {
  const [l] = await db.select().from(configuracao).where(eq(configuracao.chave, CHAVE)).limit(1);
  if (!l) return null;
  try {
    const j = JSON.parse(l.valor) as Ultimo;
    if (typeof j?.nivel === "string" && typeof j?.em === "number") return j;
    return null;
  } catch {
    return null;
  }
}

async function gravarUltimo(nivel: string, titulo: string) {
  const valor = JSON.stringify({ nivel, titulo, em: Date.now() });
  await db
    .insert(configuracao)
    .values({ chave: CHAVE, valor })
    .onConflictDoUpdate({ target: configuracao.chave, set: { valor } });
}

async function limparUltimo() {
  await db.delete(configuracao).where(eq(configuracao.chave, CHAVE));
}

const NIVEL_SEVERO = new Set(["chuva", "vento"]);

function textoDoAviso(p: Previsao): string {
  const a = p.agora;
  const hoje = p.dias[0];
  const partes = [`${p.alerta.titulo}: ${p.alerta.texto}`];
  partes.push(
    `Agora: ${a.temperatura}°C, ${a.descricao.toLowerCase()}, vento ${a.ventoKmh} km/h ${a.ventoDirecao}${a.rajadaKmh > a.ventoKmh ? ` (rajadas ${a.rajadaKmh})` : ""}.`,
  );
  if (hoje) partes.push(`Hoje: máx ${hoje.max}°, mín ${hoje.min}°, ${hoje.chanceChuva}% de chuva.`);
  const ruim = p.boletim.find((b) => b.tempoRuim) ?? p.boletim[0];
  if (ruim) partes.push(`APPA: ${ruim.texto}`);
  partes.push(
    p.alerta.nivel === "vento"
      ? "Atenção na estrada: vento forte balança carreta vazia. Reduza e segure firme."
      : "Atenção na estrada: pista molhada e fila mais lenta. Confira freios e faróis.",
  );
  return partes.join(" ").slice(0, 480);
}

const SISTEMA_ALERTA = `Você escreve avisos de clima curtos para o chat dos caminhoneiros do Porto de Paranaguá (PR), no aplicativo CopaLinks.
Regras:
- Português do Brasil, tom de colega de trabalho, claro e sem alarmismo.
- Use SOMENTE os dados fornecidos; não invente números nem horários.
- De 2 a 4 frases, no máximo 400 caracteres, começando com um emoji do tipo de alerta.
- Diga o que está acontecendo ou vai acontecer e dê uma dica prática para quem está dirigindo ou no pátio (ex.: lona bem amarrada, pista escorregadia e distância maior, faróis acesos, cuidado ao subir na carreta).
- Sem título, sem hashtags, sem aspas.`;

/**
 * Leitura inteligente: a IA (Gemini pelo Composio) lê os dados reais do porto
 * e escreve o aviso. Se a IA falhar, usa o texto montado pelas regras.
 */
async function textoInteligente(p: Previsao, nivel: string): Promise<string> {
  const base = textoDoAviso(p);
  const agoraMs = Date.now();
  const proximas = p.horas
    .filter((h) => h.ts * 1000 >= agoraMs - 30 * 60_000)
    .slice(0, 6)
    .map((h) => `${h.hora}: ${h.descricao}, ${h.temperatura}°C, chuva ${h.chanceChuva}% (${h.chuvaMm} mm), rajadas ${h.rajadaKmh} km/h`)
    .join("\n");
  try {
    const { texto } = await geminiViaComposio(
      SISTEMA_ALERTA,
      `Nível do alerta: ${nivel}.\n\nDados reais do tempo no porto:\n${base}\n\nPróximas horas:\n${proximas}\n\nEscreva o aviso.`,
      { rapido: true, reserva: false, maxTokens: 400, temperatura: 0.5, timeoutMs: 12000 },
    );
    const limpo = texto.replace(/^["“”']+|["“”']+$/g, "").trim();
    return limpo.length >= 20 ? limpo.slice(0, 480) : base;
  } catch {
    return base;
  }
}

/**
 * Verifica o clima e posta no chat se houver alerta relevante novo.
 * Nunca joga erro para cima: o cron não pode quebrar por causa do clima.
 */
export async function verificarEPostarAlertaClima(
  opcoes: { forcar?: boolean; previsao?: Previsao } = {},
): Promise<{
  postou: boolean;
  nivel: string;
  motivo: string;
}> {
  try {
    const p = opcoes.previsao ?? (await obterPrevisao());
    const nivel = p.alerta.nivel;
    const temBoletimRuim = p.boletim.some((b) => b.tempoRuim);
    const relevante = NIVEL_SEVERO.has(nivel) || temBoletimRuim;

    if (!relevante) {
      const ultimo = await lerUltimo().catch(() => null);
      if (ultimo) await limparUltimo().catch(() => {});
      return { postou: false, nivel, motivo: ultimo ? "alerta encerrado" : "sem alerta" };
    }

    const ultimo = await lerUltimo().catch(() => null);
    const mudou = !ultimo || ultimo.nivel !== nivel;
    const passouTempo = !ultimo || Date.now() - ultimo.em > LEMBRETE_MS;
    if (!mudou && !passouTempo && !opcoes.forcar) {
      return { postou: false, nivel, motivo: "já avisado" };
    }

    const texto = await textoInteligente(p, nivel);
    const [mensagem] = await db
      .insert(chatMensagens)
      .values({ motoristaId: MOTORISTA_SISTEMA, nome: NOME_CLIMA, texto })
      .returning();
    await gravarUltimo(nivel, p.alerta.titulo);

    // Web Push da mensagem do chat (nome do agente + texto) para todos os
    // aparelhos, mesmo com o app fechado. A tag CHAT_<id> evita repetição.
    // Nos casos sérios a notificação fica na tela até o motorista tocar.
    let push = "não";
    const r = mensagem
      ? await notificarMensagemChat(
          { id: mensagem.id, motoristaId: MOTORISTA_SISTEMA, nome: NOME_CLIMA, texto },
          { requireInteraction: NIVEL_SEVERO.has(nivel) },
        ).catch(() => null)
      : null;
    if (r && "enviadas" in r && r.enviadas > 0) push = `${r.enviadas} aparelho(s)`;

    return { postou: true, nivel, motivo: `avisado no chat (push: ${push})` };
  } catch {
    return { postou: false, nivel: "?", motivo: "falha ao ler o clima" };
  }
}

/**
 * Um único ponto de entrada do clima para o cron: tenta primeiro o ALERTA
 * (chuva/vento) e, quando o tempo está tranquilo, publica o BOLETIM de
 * previsão do turno (00h, 06h, 12h e 18h — 24 h por dia). Nunca joga erro
 * para cima.
 */
export async function verificarClima(
  opcoes: { forcar?: boolean } = {},
): Promise<{ postou: boolean; nivel: string; motivo: string; tipo: "alerta" | "boletim" | "nenhum"; previsao?: Previsao }> {
  // Uma leitura só (com cache de 10 min) para os dois agentes.
  let previsao: Previsao | undefined;
  try {
    previsao = await obterPrevisao();
  } catch {
    /* os agentes tentam ler de novo se precisarem */
  }

  const alerta = await verificarEPostarAlertaClima({ previsao, forcar: opcoes.forcar });
  if (alerta.postou) return { ...alerta, tipo: "alerta", previsao };
  // Tempo ruim: o alerta já leva a previsão do dia, sem boletim junto.
  if (alerta.motivo === "já avisado") {
    return { postou: false, nivel: alerta.nivel, motivo: "alerta ativo", tipo: "nenhum", previsao };
  }

  const boletim = await verificarEPostarBoletimClima({ previsao, forcar: opcoes.forcar });
  if (boletim.postou) return { postou: true, nivel: alerta.nivel, motivo: boletim.motivo, tipo: "boletim", previsao };
  return { postou: false, nivel: alerta.nivel, motivo: boletim.motivo || alerta.motivo, tipo: "nenhum", previsao };
}
