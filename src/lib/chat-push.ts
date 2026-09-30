import { enviarPush } from "@/lib/push";
import { motoristasComChatSilenciado } from "@/lib/chat-silencio";

/**
 * Web Push das mensagens do chat dos motoristas (SOMENTE servidor).
 *
 * Toda mensagem gravada em `chat_mensagens` — escrita por um motorista ou
 * postada por um agente do servidor (ex.: "🌦️ Clima no Porto", via Composio)
 * — vira uma notificação com o NOME de quem enviou e o TEXTO da mensagem.
 *
 * - Sai para todos os aparelhos com notificações ativas, menos os de quem
 *   escreveu (ninguém precisa ser avisado da própria mensagem).
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
  /** 0 = mensagem do sistema/agente (não exclui ninguém do envio). */
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
  opcoes: { requireInteraction?: boolean } = {},
) {
  const nome = resumir(m.nome || "Motorista", TITULO_MAX);
  const corpo = resumir(m.texto, CORPO_MAX);
  if (!corpo) return { enviadas: 0, assinaturas: 0, erro: "Mensagem vazia." };

  const doSistema = m.motoristaId <= 0;
  // Quem silenciou o chat não recebe avisos de mensagens (inclui os do sistema).
  const silenciados = await motoristasComChatSilenciado();
  return enviarPush(
    {
      // Motorista: "💬 Fulano"; agente do servidor já traz o próprio emoji no nome.
      title: doSistema ? nome : `💬 ${nome}`,
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
      // Quem escreveu não recebe o próprio recado; mensagens do sistema vão a todos.
      excetoMotoristaId: doSistema ? null : m.motoristaId,
      semMotoristas: silenciados,
    },
  );
}
