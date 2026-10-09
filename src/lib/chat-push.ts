import { sistemaPodePublicar } from "@/lib/politica-automacao";
import { enviarPush } from "@/lib/push";
import { motoristasComChatSilenciado } from "@/lib/chat-silencio";

/**
 * Web Push das mensagens do chat dos motoristas (SOMENTE servidor).
 *
 * Toda mensagem gravada em `chat_mensagens` — escrita por um motorista ou
 * postada pelo monitor de navios do servidor (leitura via Composio)
 * — vira uma notificação com o NOME de quem enviou e o TEXTO da mensagem.
 *
 * - Sai para os aparelhos com notificações ativas, menos os de quem escreveu;
 *   anúncios do sistema também podem excluir uma pessoa específica.
 * - A tag `CHAT_<id>` garante que cada mensagem notifica uma única vez, mesmo
 *   se a rota for chamada de novo.
 * - Tocar na notificação abre o app direto no chat (`/?chat=1`), com o
 *   aplicativo fechado ou não: quem exibe é o Service Worker (public/sw.js).
 *
 * Nada aqui altera a fila, os pontos ou os avisos NA VEZ/SAIU.
 */

/** Limite do corpo da notificação (Android corta textos longos). */
const CORPO_MAX = 220;
/** Rótulo do nome no título da notificação. */
const TITULO_MAX = 60;

export const URL_ABRIR_CHAT = "/?chat=1";

export type MensagemChatParaPush = {
  id: number;
  /** 0 = mensagem do sistema/agente (envia a todos, salvo exclusão explícita). */
  motoristaId: number;
  nome: string;
  texto: string;
};

function resumir(texto: string, max: number) {
  const limpo = texto.replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1).trimEnd()}…` : limpo;
}

export async function notificarMensagemChat(
  m: MensagemChatParaPush,
  opcoes: {
    requireInteraction?: boolean;
    /** Para anúncios do sistema, permite não avisar o próprio recém-chegado. */
    excetoMotoristaId?: number | null;
    /** Texto criativo opcional para a notificação, diferente do recado no chat. */
    notificacao?: { titulo?: string; corpo?: string };
  } = {},
) {
  const doSistema = m.motoristaId <= 0;
  if (doSistema && !sistemaPodePublicar(m.nome)) {
    return { enviadas: 0, assinaturas: 0, erro: "Aviso automático desativado pela política do porto." };
  }
  const navio = doSistema && sistemaPodePublicar(m.nome);
  const nome = resumir(m.nome || "Motorista", TITULO_MAX);
  // Não cortar o saldo/decimais nem reescrever os dados do navio. O sistema
  // operacional ainda pode encurtar a visualização; o payload mantém o texto.
  const corpo = navio ? m.texto.trim() : resumir(opcoes.notificacao?.corpo?.trim() || m.texto, CORPO_MAX);
  if (!corpo) return { enviadas: 0, assinaturas: 0, erro: "Mensagem vazia." };
  // Quem silenciou o chat não recebe avisos de mensagens (inclui os do sistema).
  const silenciados = await motoristasComChatSilenciado();
  return enviarPush(
    {
      // Motorista: "💬 Fulano"; agente do servidor já traz o próprio emoji no nome.
      title: resumir(opcoes.notificacao?.titulo?.trim() || (doSistema ? nome : `💬 ${nome}`), TITULO_MAX),
      body: corpo,
      tag: `CHAT_${m.id}`,
      acao: "chat",
      url: URL_ABRIR_CHAT,
      requireInteraction: opcoes.requireInteraction ?? false,
      actions: [
        { action: "abrir-chat", title: "Abrir chat" },
        { action: "fechar", title: "Fechar" },
      ],
    },
    {
      unica: true,
      retentavel: navio,
      ...(navio ? { timeoutMs: 10000 } : {}),
      // Quem escreveu não recebe o próprio recado; o sistema pode excluir o novo integrante.
      excetoMotoristaId: doSistema ? (opcoes.excetoMotoristaId ?? null) : m.motoristaId,
      semMotoristas: silenciados,
    },
  );
}
