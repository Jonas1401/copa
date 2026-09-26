import webpush from "web-push";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { configuracao, motoristas, notificacoes, subscriptions } from "@/db/schema";

/**
 * Backend de Web Push.
 *
 * VAPID: a chave pública vai para o navegador (via /api/push/chave); a chave
 * privada vive só aqui dentro, em variável de ambiente do servidor — ela
 * nunca é enviada ao cliente.
 */

export type PayloadPush = {
  title: string;
  body: string;
  tag: string;
  acao?: string;
  url?: string;
  requireInteraction?: boolean;
  actions?: { action: string; title: string }[];
};

let pronto = false;
let chavesCache: { publica: string; privada: string } | null = null;

/**
 * Par VAPID do servidor. Prioridade: variáveis de ambiente. Sem elas, usa o
 * par guardado na tabela interna `configuracao` (gerado uma única vez), para
 * sobreviver à recriação do ambiente. A privada nunca sai do servidor.
 */
async function obterChaves() {
  if (chavesCache) return chavesCache;

  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    chavesCache = { publica: envPub, privada: envPriv };
    return chavesCache;
  }

  const ler = async () => {
    const linhas = await db
      .select()
      .from(configuracao)
      .where(inArray(configuracao.chave, ["vapid_publica", "vapid_privada"]));
    const pub = linhas.find((l) => l.chave === "vapid_publica")?.valor;
    const priv = linhas.find((l) => l.chave === "vapid_privada")?.valor;
    return pub && priv ? { publica: pub, privada: priv } : null;
  };

  let par = await ler();
  if (!par) {
    const novo = webpush.generateVAPIDKeys();
    await db
      .insert(configuracao)
      .values([
        { chave: "vapid_publica", valor: novo.publicKey },
        { chave: "vapid_privada", valor: novo.privateKey },
      ])
      .onConflictDoNothing();
    // Relê: se dois pedidos geraram ao mesmo tempo, vale o que ficou gravado.
    par = await ler();
  }
  chavesCache = par;
  return par;
}

export async function vapidConfigurado() {
  return Boolean(await obterChaves().catch(() => null));
}

export async function chavePublica() {
  return (await obterChaves().catch(() => null))?.publica ?? "";
}

async function garantirWebPush() {
  const chaves = await obterChaves().catch(() => null);
  if (!chaves) return false;
  if (!pronto) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:monitor@copalinks.app",
      chaves.publica,
      chaves.privada,
    );
    pronto = true;
  }
  return true;
}

// ---------------------------------------------------------- assinaturas
export type EntradaSubscription = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function salvarSubscription(
  entrada: EntradaSubscription,
  dispositivo = "",
  motoristaId: number | null = null,
) {
  const endpoint = String(entrada?.endpoint ?? "").trim();
  const p256dh = String(entrada?.keys?.p256dh ?? "").trim();
  const auth = String(entrada?.keys?.auth ?? "").trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Push Subscription incompleta.");
  }

  await db
    .insert(subscriptions)
    .values({ endpoint, p256dh, auth, dispositivo, ativa: 1, motoristaId })
    .onConflictDoUpdate({
      target: subscriptions.endpoint,
      set: {
        p256dh,
        auth,
        dispositivo,
        ativa: 1,
        // Sem motorista no pedido, mantém o dono que o aparelho já tinha.
        motoristaId: sql`coalesce(excluded.motorista_id, ${subscriptions.motoristaId})`,
      },
    });

  return { ok: true, endpoint };
}

export async function removerSubscription(endpoint: string) {
  await db.delete(subscriptions).where(eq(subscriptions.endpoint, endpoint));
  return { ok: true };
}

export async function totalAssinaturas() {
  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(eq(subscriptions.ativa, 1));
  return linha?.total ?? 0;
}

// ------------------------------------------------------------- envio
/**
 * Envia o Web Push para todas as assinaturas ativas (ou só para uma).
 * `unica` usa a tag como trava de duplicidade: a mesma tag só sai uma vez.
 */
export async function enviarPush(
  payload: PayloadPush,
  opcoes: {
    somenteEndpoint?: string;
    unica?: boolean;
    /** Só os aparelhos deste motorista (+ aparelhos ainda sem dono). */
    motoristaId?: number | null;
  } = {},
) {
  if (!(await garantirWebPush())) {
    return {
      enviadas: 0,
      assinaturas: 0,
      erro: "VAPID não configurado no servidor.",
    };
  }

  const lista = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ativa, 1));
  // Notificação crítica (chamada, saída, perto da vez):
  // Envia para TODOS os aparelhos ativos cadastrados (ou seja, seu celular sempre recebe
  // mesmo que o perfil tenha sido recriado ou mudado de ID, garantindo que NUNCA falhe).
  let alvos = opcoes.somenteEndpoint
    ? lista.filter((s) => s.endpoint === opcoes.somenteEndpoint)
    : lista;

  if (!alvos.length) {
    return { enviadas: 0, assinaturas: 0, erro: "Nenhuma assinatura ativa." };
  }

  if (opcoes.unica !== false) {
    // Impede notificação duplicada: mesma tag não dispara duas vezes.
    const [reservada] = await db
      .insert(notificacoes)
      .values({ tag: payload.tag, titulo: payload.title, corpo: payload.body })
      .onConflictDoNothing()
      .returning();
    await db.execute(
      sql`delete from notificacoes where criado_em < now() - interval '2 days'`,
    );
    if (!reservada) {
      return {
        enviadas: 0,
        assinaturas: alvos.length,
        erro: "Notificação já enviada (tag repetida).",
      };
    }
  }

  const corpo = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    acao: payload.acao,
    url: payload.url ?? "/",
    requireInteraction: payload.requireInteraction ?? false,
    actions: payload.actions ?? [{ action: "ver-monitor", title: "Ver monitor" }],
  });

  let enviadas = 0;
  const invalidas: string[] = [];

  await Promise.all(
    alvos.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          corpo,
          {
            // TTL de 24 horas para o Google/FCM reter a mensagem caso o celular esteja desligado ou sem rede
            TTL: 86400,
            // 'high' força entrega imediata em celulares Android mesmo em Doze Mode / tela desligada
            urgency: "high",
            topic: payload.tag.slice(0, 32),
          },
        );
        enviadas += 1;
        await db
          .update(subscriptions)
          .set({ ultimoEnvioEm: new Date() })
          .where(eq(subscriptions.endpoint, s.endpoint));
      } catch (erro) {
        const codigo = (erro as { statusCode?: number })?.statusCode;
        // 404 / 410: assinatura expirada. 403: assinatura de outro servidor.
        // Em qualquer caso ela não volta a funcionar: descarta.
        if (codigo === 404 || codigo === 410 || codigo === 403) {
          invalidas.push(s.endpoint);
        }
      }
    }),
  );

  if (invalidas.length) {
    await db
      .delete(subscriptions)
      .where(inArray(subscriptions.endpoint, invalidas));
  }

  return {
    enviadas,
    assinaturas: alvos.length,
    descartadas: invalidas.length,
    tag: payload.tag,
  };
}

// ------------------------------------------------- notificações do turno
async function nomeDoMotorista(id: number | null | undefined) {
  if (!id) return null;
  const [m] = await db
    .select({ nome: motoristas.nome })
    .from(motoristas)
    .where(eq(motoristas.id, id))
    .limit(1);
  return m?.nome ?? null;
}

export async function notificarEvento(entrada: {
  acao: "chamada" | "saiu" | "voltou" | "perto";
  /** Quantos estão na frente (usado no aviso "perto da vez"). */
  naFrente?: number;
  tipo: string;
  livro: string;
  codigo: string;
  codigoNaVez: string;
  rotulo: string;
  /** Dono do ponto: o aviso vai para os aparelhos dele, com o nome dele. */
  motoristaId?: number | null;
}) {
  const nome = await nomeDoMotorista(entrada.motoristaId);
  const saudacao = nome ? `Olá, ${nome}! ` : "";
  const linha = `${entrada.rotulo} — Livro ${entrada.livro}`;
  const detalhe = `Seu ponto: ${entrada.codigo}\nNa Vez: ${entrada.codigoNaVez}`;
  const textos: Record<string, string> = {
    chamada: `${saudacao}Seu número foi chamado!\n${linha}\n${detalhe}`,
    saiu: `${saudacao}Seu ponto saiu da fila.\n${linha}\n${detalhe}`,
    voltou: `${saudacao}Seu ponto voltou para a fila.\n${linha}\n${detalhe}`,
    perto: `${saudacao}Seu ponto está chegando perto da vez: ${entrada.naFrente ?? "poucos"} na frente.\n${linha}\n${detalhe}`,
  };

  // Tag dinâmica no formato TRUCK_LIVRO_A_A025_A030.
  const tag = [
    ...(entrada.acao === "perto" ? [`PERTO${entrada.naFrente ?? ""}`] : []),
    entrada.tipo.replace(/\s+/g, "_"),
    `LIVRO_${entrada.livro}`,
    entrada.codigo,
    entrada.codigoNaVez,
  ].join("_");

  return enviarPush(
    {
      title: "🚛 Monitor Ponto CopaLinks",
      body: textos[entrada.acao] ?? textos.chamada,
      tag,
      acao: entrada.acao,
      url: "/",
      requireInteraction: entrada.acao === "chamada" || entrada.acao === "perto",
      actions: [
        { action: "ver-monitor", title: "Ver monitor" },
        { action: "fechar", title: "Agora não" },
      ],
    },
    { motoristaId: entrada.motoristaId ?? null },
  );
}

export async function notificarTeste(somenteEndpoint?: string) {
  let nome: string | null = null;
  if (somenteEndpoint) {
    const [s] = await db
      .select({ motoristaId: subscriptions.motoristaId })
      .from(subscriptions)
      .where(eq(subscriptions.endpoint, somenteEndpoint))
      .limit(1);
    nome = await nomeDoMotorista(s?.motoristaId);
  }
  const tag = `TESTE_${Date.now()}`;
  return enviarPush(
    {
      title: "🚛 Monitor Ponto CopaLinks",
      body: `${nome ? `Olá, ${nome}!\n` : ""}Teste de notificação\nO Web Push está funcionando corretamente.`,
      tag,
      acao: "teste",
      url: "/",
      actions: [{ action: "ver-monitor", title: "Ver monitor" }],
    },
    { somenteEndpoint, unica: false },
  );
}
