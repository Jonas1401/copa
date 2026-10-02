import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMensagens, configuracao } from "@/db/schema";
import { obterPrevisao, type Previsao } from "@/lib/tempo";
import { notificarMensagemChat } from "@/lib/chat-push";
import { geminiViaComposio } from "@/lib/composio";

/**
 * Boletim de PREVISÃO DO TEMPO no chat, 24 horas por dia (SOMENTE servidor).
 *
 * O cron (/api/cron) chama `verificarEPostarBoletimClima()` quando não há
 * alerta de tempo ruim pendente. O servidor publica UM boletim por turno no
 * chat dos motoristas como "🌤️ Previsão do Porto" (motorista_id = 0 =
 * sistema) e dispara Web Push para todos os aparelhos: quem estiver com o
 * aplicativo fechado recebe o aviso pelo Service Worker e, ao tocar, cai
 * direto no chat.
 *
 * Turnos (horário de Brasília), um boletim em cada:
 *   00h madrugada · 06h manhã · 12h tarde · 18h noite.
 * Ou seja, a previsão é renovada 4 vezes por dia, a qualquer hora — quem
 * pega serviço de madrugada também recebe.
 *
 * Antispam:
 *   - a chave do turno (`2026-10-02:manhã`) fica em `configuracao`
 *     (chave clima_boletim_chat) e impede dois boletins no mesmo turno;
 *   - nunca saem dois boletins com menos de 5 h de diferença;
 *   - em tempo ruim o alerta (src/lib/clima-alerta.ts) assume o lugar do
 *     boletim, então o chat não recebe as duas mensagens juntas.
 */

export const NOME_BOLETIM = "🌤️ Previsão do Porto";
/** 0 = mensagem do sistema/agente (igual aos avisos de clima e navios). */
const MOTORISTA_SISTEMA = 0;
const CHAVE = "clima_boletim_chat";
const FUSO = "America/Sao_Paulo";
/** Segurança: dois boletins nunca saem com menos deste intervalo. */
const INTERVALO_MIN_MS = 5 * 60 * 60 * 1000;

export type Turno = {
  /** Hora de início no horário de Brasília. */
  inicio: number;
  nome: "madrugada" | "manhã" | "tarde" | "noite";
  saudacao: string;
};

/** Um boletim por turno: 00h, 06h, 12h e 18h (horário de Brasília). */
export const TURNOS: Turno[] = [
  { inicio: 0, nome: "madrugada", saudacao: "Boa madrugada" },
  { inicio: 6, nome: "manhã", saudacao: "Bom dia" },
  { inicio: 12, nome: "tarde", saudacao: "Boa tarde" },
  { inicio: 18, nome: "noite", saudacao: "Boa noite" },
];

type Ultimo = { bloco: string; em: number };

async function lerUltimo(): Promise<Ultimo | null> {
  const [l] = await db.select().from(configuracao).where(eq(configuracao.chave, CHAVE)).limit(1);
  if (!l) return null;
  try {
    const j = JSON.parse(l.valor) as Ultimo;
    if (typeof j?.bloco === "string" && typeof j?.em === "number") return j;
    return null;
  } catch {
    return null;
  }
}

async function gravarUltimo(bloco: string) {
  const valor = JSON.stringify({ bloco, em: Date.now() });
  await db
    .insert(configuracao)
    .values({ chave: CHAVE, valor })
    .onConflictDoUpdate({ target: configuracao.chave, set: { valor } });
}

/** Data e hora local de Paranaguá (o servidor da Vercel roda em UTC). */
function local(agora: Date) {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return {
    data: `${p.year}-${p.month}-${p.day}`,
    hora: (Number(p.hour) || 0) % 24,
  };
}

/** Turno atual: chave única do boletim (ex.: "2026-10-02:manhã"). */
export function turnoDoDia(agora: Date = new Date()) {
  const { data, hora } = local(agora);
  const turno = [...TURNOS].reverse().find((t) => hora >= t.inicio) ?? TURNOS[0];
  return { chave: `${data}:${turno.nome}`, turno, hora };
}

function dicaDoTurno(p: Previsao): string {
  const a = p.agora;
  const hoje = p.dias[0];
  if ((hoje?.chanceChuva ?? 0) >= 60 || p.alerta.nivel === "chuva") {
    return "Chuva no caminho: reduza, aumente a distância e confira a lona antes de sair.";
  }
  if (a.rajadaKmh >= 45 || p.alerta.nivel === "vento") {
    return "Vento forte: cuidado com carreta vazia e com a lona solta no pátio.";
  }
  if ((hoje?.min ?? 99) <= 14) return "Frio de verdade: leve agasalho, a madrugada no pátio engana.";
  if ((hoje?.max ?? 0) >= 30) return "Dia quente: água por perto e nada de deixar ninguém na cabine.";
  return "Estrada e pátio tranquilos: bom trabalho e atenção na balança.";
}

/** Texto pronto, usado quando a IA não responde. Só com dados reais. */
export function textoBoletimPadrao(p: Previsao, turno: Turno): string {
  const a = p.agora;
  const hoje = p.dias[0];
  const amanha = p.dias[1];
  const agoraMs = Date.now();
  const partes = [
    `${turno.saudacao}! Em ${p.cidade}: ${a.temperatura}°C, ${a.descricao.toLowerCase()}, vento ${a.ventoKmh} km/h ${a.ventoDirecao}${a.rajadaKmh > a.ventoKmh ? ` (rajadas de ${a.rajadaKmh})` : ""}.`,
  ];
  if (hoje) {
    const mm = hoje.chuvaMm > 0 ? ` (${hoje.chuvaMm.toString().replace(".", ",")} mm)` : "";
    partes.push(`Hoje: máx ${hoje.max}°, mín ${hoje.min}°, ${hoje.chanceChuva}% de chuva${mm}.`);
  }
  const chuva = p.horas.find((h) => h.ts * 1000 >= agoraMs && h.chanceChuva >= 60);
  if (chuva) partes.push(`Atenção: ${chuva.chanceChuva}% de chuva por volta das ${chuva.hora}.`);
  if (p.boletim[0]) partes.push(`APPA: ${p.boletim[0].texto}`);
  if (amanha) partes.push(`Amanhã: ${amanha.descricao.toLowerCase()}, ${amanha.min}° a ${amanha.max}°.`);
  if (p.nascerSol && p.porSol) partes.push(`Sol: nasce ${p.nascerSol} e se põe ${p.porSol}.`);
  partes.push(dicaDoTurno(p));
  return partes.join(" ").slice(0, 480);
}

const SISTEMA_BOLETIM = `Você escreve o boletim de previsão do tempo para o chat dos caminhoneiros do Porto de Paranaguá (PR), no aplicativo CopaLinks.
Regras:
- Português do Brasil, tom humano de colega de trabalho; 3 a 5 frases; no máximo 460 caracteres; comece com o emoji do tempo.
- Use SOMENTE os dados fornecidos. Nunca invente temperatura, horário, volume de chuva ou velocidade do vento.
- Diga como está agora, o que muda nas próximas horas (chuva, vento, frio ou calor) e a máxima e a mínima do dia.
- Quando houver boletim da APPA, aproveite uma frase curta dele sem copiar texto técnico.
- Termine com uma dica prática e curta para quem está na fila, no pátio ou na estrada (lona, pista molhada, água, agasalho, cuidado com o vento na carreta vazia).
- Sem título, sem hashtags, sem aspas e sem lista com travessão.`;

/**
 * Boletim escrito pela IA (Gemini pelo Composio) com os dados reais do porto.
 * Se a IA falhar, usa o texto montado pelas regras.
 */
async function escreverBoletim(p: Previsao, turno: Turno): Promise<string> {
  const base = textoBoletimPadrao(p, turno);
  const agoraMs = Date.now();
  const proximas = p.horas
    .filter((h) => h.ts * 1000 >= agoraMs - 30 * 60_000)
    .slice(0, 6)
    .map((h) => `${h.hora}: ${h.descricao}, ${h.temperatura}°C, chuva ${h.chanceChuva}% (${h.chuvaMm} mm), rajadas ${h.rajadaKmh} km/h`)
    .join("\n");
  try {
    const { texto } = await geminiViaComposio(
      SISTEMA_BOLETIM,
      `Turno: ${turno.nome} (a partir das ${String(turno.inicio).padStart(2, "0")}h, horário de Brasília).\n\nDados reais do tempo no porto:\n${base}\n\nPróximas horas:\n${proximas}\n\nEscreva o boletim.`,
      { rapido: true, reserva: false, maxTokens: 500, temperatura: 0.6, timeoutMs: 12000 },
    );
    const limpo = texto.replace(/^["“”']+|["“”']+$/g, "").trim();
    return limpo.length >= 20 ? limpo.slice(0, 480) : base;
  } catch {
    return base;
  }
}

/**
 * Publica o boletim do turno quando ele ainda não saiu.
 * Nunca joga erro para cima: o cron não pode quebrar por causa do clima.
 * `forcar` ignora a espera do turno (testes).
 */
export async function verificarEPostarBoletimClima(
  opcoes: { forcar?: boolean; previsao?: Previsao } = {},
): Promise<{ postou: boolean; motivo: string; turno?: string }> {
  try {
    const atual = turnoDoDia();
    const ultimo = await lerUltimo().catch(() => null);
    if (!opcoes.forcar && ultimo?.bloco === atual.chave) {
      return { postou: false, motivo: `boletim da ${atual.turno.nome} já publicado` };
    }
    if (!opcoes.forcar && ultimo && Date.now() - ultimo.em < INTERVALO_MIN_MS) {
      return { postou: false, motivo: "aguardando o próximo turno" };
    }

    const p = opcoes.previsao ?? (await obterPrevisao());
    const texto = await escreverBoletim(p, atual.turno);
    const [mensagem] = await db
      .insert(chatMensagens)
      .values({ motoristaId: MOTORISTA_SISTEMA, nome: NOME_BOLETIM, texto })
      .returning();
    // Grava antes do Push: dois ciclos juntos não publicam duas vezes.
    await gravarUltimo(atual.chave);

    // Web Push (nome do agente + texto) para todos os aparelhos, inclusive com
    // o app fechado. A tag CHAT_<id> impede aviso repetido.
    let push = "não";
    const r = mensagem
      ? await notificarMensagemChat({
          id: mensagem.id,
          motoristaId: MOTORISTA_SISTEMA,
          nome: NOME_BOLETIM,
          texto,
        }).catch(() => null)
      : null;
    if (r && "enviadas" in r && r.enviadas > 0) push = `${r.enviadas} aparelho(s)`;

    return { postou: true, motivo: `boletim da ${atual.turno.nome} (push: ${push})`, turno: atual.turno.nome };
  } catch {
    return { postou: false, motivo: "falha ao montar o boletim" };
  }
}
