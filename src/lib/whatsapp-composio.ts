import {
  criarAuthConfigGerenciado,
  criarLinkContaConectada,
  executarFerramenta,
  listarAuthConfigs,
  listarContasConectadas,
  type ContaConectada,
} from "@/lib/composio";
import { obterSegredo } from "@/lib/admin/segredos";

/**
 * WhatsApp Business (WABA) pelo Composio. Nunca usa a conta pessoal dos links
 * wa.me em /contatos e nunca envia mensagens por conta própria.
 *
 * O toolkit pode enviar SOMENTE quando uma conta empresarial for autorizada
 * na página hospedada pelo Composio. Até lá, o status é "não conectado".
 */
const USUARIO = "copalinks-servidor";
const FERRAMENTAS_PERMITIDAS = [
  "WHATSAPP_GET_PHONE_NUMBERS",
  "WHATSAPP_GET_PHONE_NUMBER",
  "WHATSAPP_GET_BUSINESS_PROFILE",
  "WHATSAPP_GET_MESSAGE_TEMPLATES",
  "WHATSAPP_WHO_AM_I",
  "WHATSAPP_SEND_MESSAGE",
  "WHATSAPP_SEND_TEMPLATE_MESSAGE",
];

const CONEXAO_PENDENTE_MS = 15 * 60 * 1000;

type Estado = {
  configurado: boolean;
  conectado: boolean;
  pendente: boolean;
  totalContas: number;
};

async function contasWhatsapp(): Promise<ContaConectada[]> {
  const r = await listarContasConectadas({ toolkit: "whatsapp", limite: 50 });
  // Verifica também o slug, caso a API ignore o filtro.
  return (r.items ?? []).filter((a) => a.toolkit?.slug?.toLowerCase() === "whatsapp");
}

export async function estadoWhatsappComposio(): Promise<Estado> {
  if (!(await obterSegredo("COMPOSIO_API_KEY"))) {
    return { configurado: false, conectado: false, pendente: false, totalContas: 0 };
  }
  const contas = await contasWhatsapp();
  const ativas = contas.filter((a) => a.status === "ACTIVE");
  const pendente = contas.some(
    (a) =>
      a.status === "INITIALIZING" &&
      !!a.created_at &&
      Date.now() - new Date(a.created_at).getTime() < CONEXAO_PENDENTE_MS,
  );
  return {
    configurado: true,
    conectado: ativas.length > 0,
    pendente: ativas.length === 0 && pendente,
    totalContas: ativas.length,
  };
}

/** Link seguro. O Composio solicita o ID da conta WhatsApp Business (WABA) e a autorização da Meta. */
export async function linkWhatsappComposio(siteUrl: string) {
  if (!(await obterSegredo("COMPOSIO_API_KEY"))) {
    throw new Error("Configure a COMPOSIO_API_KEY no card Composio primeiro.");
  }
  const estado = await estadoWhatsappComposio();
  if (estado.conectado) throw new Error("A conta WhatsApp Business já está conectada pelo Composio.");

  const existentes = await listarAuthConfigs("whatsapp");
  let config = (existentes.items ?? []).find(
    (a) =>
      a.toolkit?.slug === "whatsapp" &&
      a.auth_scheme === "OAUTH2" &&
      a.is_composio_managed &&
      a.status === "ENABLED",
  );
  if (!config) {
    const nova = await criarAuthConfigGerenciado("whatsapp", FERRAMENTAS_PERMITIDAS);
    config = nova.auth_config;
  }
  if (!config?.id) throw new Error("O Composio não conseguiu preparar a conexão WhatsApp Business.");

  // Nunca usa Host/Origin vindos da requisição: o retorno vai ao site configurado.
  const site = new URL(siteUrl);
  if (site.protocol !== "https:") throw new Error("Configure SITE_URL com HTTPS para autorizar o WhatsApp.");
  const callback = new URL("/admin", site).toString();
  const link = await criarLinkContaConectada(config.id, USUARIO, callback);
  if (!link.redirect_url) throw new Error("O Composio não devolveu o link de autorização.");
  const destino = new URL(link.redirect_url);
  if (destino.protocol !== "https:" || destino.hostname !== "connect.composio.dev") {
    throw new Error("O Composio devolveu um endereço de autorização inesperado.");
  }
  return { url: destino.toString(), expiraEm: link.expires_at ?? null };
}

/** Prova de acesso somente leitura: consulta os números da conta empresarial, sem enviá-los a ninguém. */
export async function testarWhatsappComposio(): Promise<{ conectado: boolean; mensagem: string }> {
  if (!(await obterSegredo("COMPOSIO_API_KEY"))) {
    return { conectado: false, mensagem: "Composio não configurado." };
  }
  const contas = await contasWhatsapp();
  const ativa = contas.find((a) => a.status === "ACTIVE");
  if (!ativa) {
    return { conectado: false, mensagem: "Conecte e autorize uma conta WhatsApp Business no card WhatsApp." };
  }
  const r = await executarFerramenta("WHATSAPP_GET_PHONE_NUMBERS", {
    userId: ativa.user_id ?? USUARIO,
    connectedAccountId: ativa.id,
    arguments: { limit: 1 },
  });
  if (r.successful === false) {
    return {
      conectado: false,
      mensagem: "Conta ligada ao Composio, mas a Meta recusou a consulta de leitura. Confira o WABA ID e as permissões WhatsApp Business.",
    };
  }
  return {
    conectado: true,
    mensagem: "Conectado pelo Composio · WhatsApp Business autorizado; consulta de leitura à Meta OK. Nenhuma mensagem foi enviada.",
  };
}
