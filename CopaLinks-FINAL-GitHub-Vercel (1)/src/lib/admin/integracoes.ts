import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { amostras, integracoesStatus, subscriptions } from "@/db/schema";
import {
  infoSegredos,
  obterSegredo,
  origemChaveMestra,
  semSegredos,
  type InfoSegredo,
} from "@/lib/admin/segredos";
import { ErroComposio, testarComposio } from "@/lib/composio";
import { chavePublica, notificarTeste, vapidConfigurado } from "@/lib/push";
import { obterPrevisao } from "@/lib/tempo";

/* ------------------------------------------------------------ catálogo */
export type IdIntegracao = "composio" | "clima" | "whatsapp" | "ia" | "notificacoes" | "banco";

export type Campo = {
  chave: string; // nome da variável: COMPOSIO_API_KEY
  rotulo: string;
  secreto: boolean; // true = nunca mostra inteiro (só ••••1234)
  opcoes?: { valor: string; rotulo: string }[]; // campo de escolha (não secreto)
  dica?: string;
};

type Definicao = {
  id: IdIntegracao;
  nome: string;
  descricao: string;
  campos: Campo[];
  /** Campos obrigatórios para considerar a integração "configurada". */
  obrigatorios: string[];
  podeSalvar: boolean;
  podeRemover: boolean;
  rotuloSalvar: string;
  rotuloTestar: string;
};

export const INTEGRACOES: Definicao[] = [
  {
    id: "composio",
    nome: "Composio",
    descricao: "Conexão do CopaLinks com ferramentas e serviços externos através do Composio.",
    campos: [{ chave: "COMPOSIO_API_KEY", rotulo: "Project API Key", secreto: true, dica: "Composio → Settings → Project API Key" }],
    obrigatorios: ["COMPOSIO_API_KEY"],
    podeSalvar: true,
    podeRemover: true,
    rotuloSalvar: "Salvar API Key",
    rotuloTestar: "Testar conexão",
  },
  {
    id: "clima",
    nome: "Previsão do Tempo APPA",
    descricao: "Consulta os dados meteorológicos utilizados pelo CopaLinks.",
    campos: [],
    obrigatorios: [],
    podeSalvar: false,
    podeRemover: false,
    rotuloSalvar: "",
    rotuloTestar: "Testar conexão",
  },
  {
    id: "whatsapp",
    nome: "WhatsApp",
    descricao: "Configuração da integração oficial do WhatsApp utilizada pelo CopaLinks.",
    campos: [
      { chave: "WHATSAPP_ACCESS_TOKEN", rotulo: "WhatsApp Access Token", secreto: true },
      { chave: "WHATSAPP_PHONE_NUMBER_ID", rotulo: "Phone Number ID", secreto: true },
      { chave: "WHATSAPP_BUSINESS_ACCOUNT_ID", rotulo: "WhatsApp Business Account ID", secreto: true },
    ],
    obrigatorios: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    podeSalvar: true,
    podeRemover: true,
    rotuloSalvar: "Salvar",
    rotuloTestar: "Testar conexão",
  },
  {
    id: "ia",
    nome: "IA",
    descricao: "Chave do provedor de inteligência artificial (reservada para recursos futuros do CopaLinks).",
    campos: [
      {
        chave: "AI_PROVIDER",
        rotulo: "Provedor",
        secreto: false,
        opcoes: [
          { valor: "auto", rotulo: "Detectar pela chave" },
          { valor: "openai", rotulo: "OpenAI" },
          { valor: "anthropic", rotulo: "Anthropic (Claude)" },
          { valor: "gemini", rotulo: "Google Gemini" },
          { valor: "groq", rotulo: "Groq" },
          { valor: "openrouter", rotulo: "OpenRouter" },
        ],
      },
      { chave: "AI_API_KEY", rotulo: "AI API Key", secreto: true },
    ],
    obrigatorios: ["AI_API_KEY"],
    podeSalvar: true,
    podeRemover: true,
    rotuloSalvar: "Salvar",
    rotuloTestar: "Testar conexão",
  },
  {
    id: "notificacoes",
    nome: "Notificações",
    descricao: "Serviço de notificações push (Web Push com chaves VAPID) usado para avisar os motoristas.",
    campos: [],
    obrigatorios: [],
    podeSalvar: false,
    podeRemover: false,
    rotuloSalvar: "",
    rotuloTestar: "Testar envio",
  },
  {
    id: "banco",
    nome: "Banco de dados / Backend",
    descricao: "Banco PostgreSQL e servidor do CopaLinks. Credenciais nunca são exibidas.",
    campos: [],
    obrigatorios: [],
    podeSalvar: false,
    podeRemover: false,
    rotuloSalvar: "",
    rotuloTestar: "Testar conexão",
  },
];

export const definicao = (id: string) => INTEGRACOES.find((i) => i.id === id);

/* -------------------------------------------------------------- status */
export type StatusIntegracao = "conectado" | "erro" | "nao_configurado" | "nao_testado";

export type EstadoIntegracao = {
  id: IdIntegracao;
  nome: string;
  descricao: string;
  status: StatusIntegracao;
  mensagem: string;
  verificadoEm: string | null;
  configurada: boolean;
  campos: (Campo & { info: InfoSegredo; valorPublico?: string })[];
  detalhes: { rotulo: string; valor: string }[];
  podeSalvar: boolean;
  podeRemover: boolean;
  rotuloSalvar: string;
  rotuloTestar: string;
};

const ambiente = () =>
  process.env.NODE_ENV === "production" ? "Produção" : process.env.NODE_ENV === "test" ? "Teste" : "Desenvolvimento";

/** Status de todas as integrações — SEM nenhum valor de chave. */
export async function listarEstados(): Promise<EstadoIntegracao[]> {
  const todasChaves = INTEGRACOES.flatMap((i) => i.campos.map((c) => c.chave));
  const [info, salvos, provedor, ultimaAmostra, nAssinaturas, origemMestra] = await Promise.all([
    infoSegredos(todasChaves),
    db.select().from(integracoesStatus),
    obterSegredo("AI_PROVIDER"),
    db.select({ em: amostras.criadoEm }).from(amostras).orderBy(desc(amostras.id)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(subscriptions).where(eq(subscriptions.ativa, 1)),
    origemChaveMestra(),
  ]);

  const estados: EstadoIntegracao[] = [];
  for (const d of INTEGRACOES) {
    const configurada = d.obrigatorios.every((c) => info[c]?.configurado);
    const s = salvos.find((x) => x.id === d.id);
    const detalhes: { rotulo: string; valor: string }[] = [];

    if (d.id === "composio") {
      detalhes.push({ rotulo: "Endpoint", valor: "backend.composio.dev/api/v3.1 · x-api-key" });
      detalhes.push({
        rotulo: "Uso no CopaLinks",
        valor: "Reserva da leitura do ponto (1×/min) · tempo atual se a estação da APPA cair",
      });
    }
    if (d.id === "clima") {
      detalhes.push({ rotulo: "Fonte", valor: "weather-appa.app.simport.com.br" });
      detalhes.push({ rotulo: "Uso", valor: "Tela de tempo e chip do clima da tela inicial" });
    }
    if (d.id === "notificacoes") {
      const pub = await chavePublica();
      detalhes.push({ rotulo: "Provedor", valor: "Web Push (VAPID) · Chrome / Android" });
      detalhes.push({ rotulo: "Chave pública VAPID", valor: pub ? `••••${pub.slice(-4)}` : "—" });
      detalhes.push({ rotulo: "Aparelhos inscritos", valor: String(nAssinaturas[0]?.n ?? 0) });
    }
    if (d.id === "banco") {
      detalhes.push({ rotulo: "Ambiente", valor: ambiente() });
      detalhes.push({
        rotulo: "Última sincronização",
        valor: ultimaAmostra[0]?.em ? ultimaAmostra[0].em.toISOString() : "—",
      });
      detalhes.push({
        rotulo: "Criptografia das chaves",
        valor:
          origemMestra === "ambiente"
            ? "AES-256-GCM · chave mestra em SECRETS_MASTER_KEY"
            : "AES-256-GCM · chave mestra no banco (defina SECRETS_MASTER_KEY)",
      });
    }

    // Integrações sem campos (clima, notificações, banco) estão sempre "configuradas".
    const semCampos = d.campos.length === 0;
    let status: StatusIntegracao;
    if (!semCampos && !configurada) status = "nao_configurado";
    else if (s) status = s.status as StatusIntegracao;
    else status = "nao_testado";

    estados.push({
      id: d.id,
      nome: d.nome,
      descricao: d.descricao,
      status,
      mensagem:
        status === "nao_configurado"
          ? "Não configurado."
          : s?.mensagem ?? "Ainda não testado.",
      verificadoEm: status === "nao_configurado" ? null : s?.verificadoEm.toISOString() ?? null,
      configurada: semCampos || configurada,
      campos: d.campos.map((c) => ({
        ...c,
        info: info[c.chave],
        // Único campo mostrado por inteiro: o nome do provedor (não é segredo).
        ...(c.secreto ? {} : { valorPublico: provedor ?? "auto" }),
      })),
      detalhes,
      podeSalvar: d.podeSalvar,
      podeRemover: d.podeRemover,
      rotuloSalvar: d.rotuloSalvar,
      rotuloTestar: d.rotuloTestar,
    });
  }
  return estados;
}

async function gravarStatus(id: IdIntegracao, status: "conectado" | "erro" | "nao_configurado", mensagem: string) {
  await db
    .insert(integracoesStatus)
    .values({ id, status, mensagem, verificadoEm: new Date() })
    .onConflictDoUpdate({
      target: integracoesStatus.id,
      set: { status, mensagem, verificadoEm: new Date() },
    });
}

export async function limparStatus(id: IdIntegracao) {
  await db.delete(integracoesStatus).where(eq(integracoesStatus.id, id));
}

/* --------------------------------------------------------------- testes */
function provedorPelaChave(chave: string) {
  if (chave.startsWith("sk-ant-")) return "anthropic";
  if (chave.startsWith("sk-or-")) return "openrouter";
  if (chave.startsWith("gsk_")) return "groq";
  if (chave.startsWith("AIza")) return "gemini";
  if (chave.startsWith("sk-")) return "openai";
  return null;
}

async function testarIA() {
  const chave = await obterSegredo("AI_API_KEY");
  if (!chave) return { ok: false, naoConfig: true, msg: "Não configurado." };
  const escolhido = (await obterSegredo("AI_PROVIDER")) ?? "auto";
  const provedor = escolhido === "auto" ? provedorPelaChave(chave) : escolhido;
  const pedidos: Record<string, { url: string; headers: Record<string, string>; nome: string }> = {
    openai: { nome: "OpenAI", url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${chave}` } },
    anthropic: {
      nome: "Anthropic",
      url: "https://api.anthropic.com/v1/models",
      headers: { "x-api-key": chave, "anthropic-version": "2023-06-01" },
    },
    gemini: { nome: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/models", headers: { "x-goog-api-key": chave } },
    groq: { nome: "Groq", url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${chave}` } },
    openrouter: { nome: "OpenRouter", url: "https://openrouter.ai/api/v1/key", headers: { Authorization: `Bearer ${chave}` } },
  };
  const p = provedor ? pedidos[provedor] : null;
  if (!p) return { ok: false, msg: "Provedor não reconhecido pela chave. Escolha o provedor no campo acima." };
  const r = await fetch(p.url, { headers: p.headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (r.ok) return { ok: true, msg: `Conectado · ${p.nome} aceitou a chave.` };
  if (r.status === 401 || r.status === 403) return { ok: false, msg: `${p.nome} recusou a chave (inválida ou sem permissão).` };
  return { ok: false, msg: `${p.nome} respondeu ${r.status}.` };
}

async function testarWhatsApp() {
  const token = await obterSegredo("WHATSAPP_ACCESS_TOKEN");
  const phoneId = await obterSegredo("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return { ok: false, naoConfig: true, msg: "Não configurado." };
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name,quality_rating`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const d = (await r.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    error?: { message?: string; code?: number };
  };
  if (r.ok) {
    return {
      ok: true,
      msg: `Conectado · ${d.verified_name ?? "número verificado"}${d.display_phone_number ? ` (${d.display_phone_number})` : ""}.`,
    };
  }
  if (d.error?.code === 190 || r.status === 401) return { ok: false, msg: "Access Token inválido ou expirado." };
  return { ok: false, msg: semSegredos(d.error?.message ?? `A Meta respondeu ${r.status}.`, [token, phoneId]) };
}

/**
 * Testa a integração no servidor e grava o resultado.
 * `endpointAparelho`: para "notificacoes", envia o teste só para o aparelho
 * do próprio administrador (nunca dispara para todos os motoristas).
 */
export async function testar(id: IdIntegracao, opcoes: { endpointAparelho?: string } = {}) {
  let ok = false;
  let naoConfig = false;
  let msg = "";
  const segredosEnvolvidos = [
    await obterSegredo("COMPOSIO_API_KEY"),
    await obterSegredo("AI_API_KEY"),
    await obterSegredo("WHATSAPP_ACCESS_TOKEN"),
  ];

  try {
    if (id === "composio") {
      if (!(await obterSegredo("COMPOSIO_API_KEY"))) {
        naoConfig = true;
        msg = "Não configurado.";
      } else {
        msg = await testarComposio();
        ok = true;
      }
    } else if (id === "clima") {
      const t0 = Date.now();
      const p = await obterPrevisao(true);
      ok = p.fontes.simport;
      msg = ok
        ? `Conectado · previsão APPA ${p.horas.length}h${p.fontes.estacao ? " + estação do porto" : ""} (${Date.now() - t0} ms). Agora: ${p.agora.temperatura}°C, ${p.agora.descricao.toLowerCase()}.`
        : "A SIMPORT não respondeu. Usando só a Open-Meteo como reserva.";
    } else if (id === "whatsapp") {
      const r = await testarWhatsApp();
      ok = r.ok;
      naoConfig = Boolean(r.naoConfig);
      msg = r.msg;
    } else if (id === "ia") {
      const r = await testarIA();
      ok = r.ok;
      naoConfig = Boolean(r.naoConfig);
      msg = r.msg;
    } else if (id === "notificacoes") {
      if (!(await vapidConfigurado())) {
        msg = "Chaves VAPID indisponíveis no servidor.";
      } else if (opcoes.endpointAparelho) {
        const r = await notificarTeste(opcoes.endpointAparelho);
        ok = r.enviadas > 0;
        msg = ok
          ? "Conectado · notificação de teste enviada para este aparelho."
          : r.erro === "Nenhuma assinatura ativa."
            ? "Este aparelho não está inscrito. Ative as notificações no app e teste de novo."
            : `Envio recusado pelo serviço de push (${r.erro ?? "assinatura expirada"}).`;
      } else {
        // Sem aparelho: confere se as chaves VAPID assinam um pedido válido.
        const pub = await chavePublica();
        const ecdh = createECDH("prime256v1");
        ecdh.generateKeys();
        webpush.generateRequestDetails(
          {
            endpoint: "https://fcm.googleapis.com/fcm/send/teste-copalinks",
            keys: {
              p256dh: ecdh.getPublicKey().toString("base64url"),
              auth: randomBytes(16).toString("base64url"),
            },
          },
          "teste",
        );
        ok = true;
        msg = `Conectado · chaves VAPID válidas (••••${pub.slice(-4)}). Ative as notificações neste aparelho para testar o envio real.`;
      }
    } else if (id === "banco") {
      const t0 = Date.now();
      const r = await db.execute(sql`select current_database() as banco, split_part(version(), ' ', 2) as versao`);
      const linha = (r as unknown as { rows: { banco: string; versao: string }[] }).rows[0];
      ok = true;
      msg = `Conectado · PostgreSQL ${linha?.versao ?? ""} · banco "${linha?.banco ?? ""}" · ${Date.now() - t0} ms.`;
    }
  } catch (e) {
    ok = false;
    msg =
      e instanceof ErroComposio
        ? e.message
        : e instanceof Error && e.name === "TimeoutError"
          ? "O serviço demorou demais para responder."
          : "Falha ao conectar com o serviço.";
  }

  msg = semSegredos(msg, segredosEnvolvidos);
  const status = naoConfig ? "nao_configurado" : ok ? "conectado" : "erro";
  await gravarStatus(id, status, msg);
  return { status, mensagem: msg };
}
