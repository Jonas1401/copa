import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { configuracao, monitorDevices, monitorMessages } from "@/db/schema";
import { analisarMensagemGrupo } from "@/lib/grupo-filtro";
import { processarMensagemGrupo } from "@/lib/grupo-aviso";
import { enviarPush } from "@/lib/push";
import { NOME_GRUPO_MONITORADO, normalizarNomeGrupo } from "@/lib/monitor-group";

/**
 * Filtro do grupo SEM APK — entrada pelo servidor (SOMENTE servidor).
 *
 * Um navegador/PWA não consegue ler notificações nem mensagens de outros
 * apps. Sem o app Android, a leitura automática acontece assim:
 *
 *   conta WhatsApp que participa do grupo
 *     → conectada a um serviço de "WhatsApp Web" (Green-API, Z-API,
 *       Evolution API, WAHA ou Whapi), como um aparelho conectado
 *     → o serviço chama POST /api/whatsapp/webhook a cada mensagem
 *     → aqui: só o grupo "INFO. OP PORTO / FOSPAR **" passa; as listas
 *       vão para o MESMO processarMensagemGrupo do monitor Android
 *       (mesmo filtro, mesmos avisos, mesma trava de 1 aviso por dia).
 *
 * Privacidade: o serviço envia mensagens de TODAS as conversas da conta.
 * Qualquer conversa que não seja o grupo é descartada na hora, sem gravar
 * nada. Do grupo, o texto não é gravado: só a hora da última mensagem,
 * o ID do grupo e os metadados do monitor (quantidade de códigos).
 */

export type ProvedorWebhook = "green-api" | "z-api" | "evolution" | "waha" | "whapi" | "generico";

export type MensagemWebhook = {
  provedor: ProvedorWebhook;
  /** ID da mensagem no serviço (para não processar a mesma duas vezes). */
  id: string;
  chatId: string;
  chatNome: string | null;
  grupo: boolean;
  texto: string;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const primeiro = (...v: unknown[]) => v.map(str).find((s) => s.trim()) ?? "";
const ehJidDeGrupo = (id: string) => /@g\.us$/i.test(id.trim()) || /-group$/i.test(id.trim());

/** "120363…@g.us" (Green, Evolution, WAHA, Whapi) e "120363…-group" (Z-API) → "120363…". */
export function idDoGrupo(chatId: string) {
  return chatId.trim().toLowerCase().replace(/@g\.us$/, "").replace(/-group$/, "");
}

/* ---------------------------------------------------- formatos aceitos */

function greenApi(o: Obj): MensagemWebhook[] {
  if (!/^(incoming|outgoing|outgoingAPI)MessageReceived$/.test(str(o.typeWebhook))) return [];
  const remetente = obj(o.senderData);
  const dados = obj(o.messageData);
  if (!remetente || !dados) return [];
  const chatId = str(remetente.chatId);
  return [{
    provedor: "green-api",
    id: str(o.idMessage),
    chatId,
    chatNome: str(remetente.chatName) || null,
    grupo: ehJidDeGrupo(chatId),
    texto: primeiro(
      obj(dados.textMessageData)?.textMessage,
      obj(dados.extendedTextMessageData)?.text,
      obj(dados.editedMessageData)?.textMessage,
      obj(dados.fileMessageData)?.caption,
    ),
  }];
}

function evolution(o: Obj): MensagemWebhook[] {
  if (str(o.event).toLowerCase().replace(/_/g, ".") !== "messages.upsert") return [];
  const lista = Array.isArray(o.data) ? o.data : [o.data];
  return lista.flatMap((d): MensagemWebhook[] => {
    const x = obj(d);
    const chave = obj(x?.key);
    if (!x || !chave) return [];
    const m = obj(x.message);
    const chatId = str(chave.remoteJid);
    return [{
      provedor: "evolution",
      id: str(chave.id),
      chatId,
      chatNome: null,
      grupo: ehJidDeGrupo(chatId),
      texto: primeiro(
        m?.conversation,
        obj(m?.extendedTextMessage)?.text,
        obj(m?.imageMessage)?.caption,
        obj(m?.documentMessage)?.caption,
      ),
    }];
  });
}

function waha(o: Obj): MensagemWebhook[] {
  if (str(o.event) !== "message" && str(o.event) !== "message.any") return [];
  const p = obj(o.payload);
  if (!p) return [];
  const chatId = p.fromMe === true ? str(p.to) : str(p.from);
  return [{ provedor: "waha", id: str(p.id), chatId, chatNome: null, grupo: ehJidDeGrupo(chatId), texto: str(p.body) }];
}

function whapi(o: Obj): MensagemWebhook[] {
  if (!Array.isArray(o.messages)) return [];
  return o.messages.flatMap((mm): MensagemWebhook[] => {
    const x = obj(mm);
    if (!x) return [];
    const chatId = str(x.chat_id);
    return [{
      provedor: "whapi",
      id: str(x.id),
      chatId,
      chatNome: str(x.chat_name) || null,
      grupo: ehJidDeGrupo(chatId),
      texto: primeiro(obj(x.text)?.body, obj(x.image)?.caption, obj(x.document)?.caption),
    }];
  });
}

function zApi(o: Obj): MensagemWebhook[] {
  if (!("messageId" in o) || !("phone" in o)) return [];
  if (str(o.type) && str(o.type) !== "ReceivedCallback") return [];
  const chatId = str(o.phone);
  return [{
    provedor: "z-api",
    id: str(o.messageId),
    chatId,
    chatNome: str(o.chatName) || null,
    grupo: o.isGroup === true || ehJidDeGrupo(chatId),
    texto: primeiro(obj(o.text)?.message, obj(o.image)?.caption, obj(o.document)?.caption),
  }];
}

/** Ponte própria (ex.: script Baileys): { id, chatId, chatName, isGroup, texto }. */
function generico(o: Obj): MensagemWebhook[] {
  const texto = typeof o.texto === "string" ? o.texto : typeof o.text === "string" ? o.text : "";
  const chatId = primeiro(o.chatId, o.groupId);
  const chatNome = primeiro(o.chatName, o.groupName) || null;
  if (!texto || (!chatId && !chatNome)) return [];
  return [{
    provedor: "generico",
    id: primeiro(o.id, o.messageId),
    chatId: chatId || `nome:${chatNome}`,
    chatNome,
    grupo: o.isGroup === true || ehJidDeGrupo(chatId),
    texto,
  }];
}

/** Lê o corpo enviado pelo serviço e devolve as mensagens (qualquer formato aceito). */
export function lerMensagensWebhook(body: unknown): MensagemWebhook[] {
  const o = obj(body);
  if (!o) return [];
  for (const formato of [greenApi, evolution, waha, whapi, zApi, generico]) {
    const r = formato(o);
    if (r.length) return r;
  }
  return [];
}

/**
 * A mensagem é do grupo monitorado? Com WHATSAPP_GRUPO_ID definido, vale só
 * esse ID (regra estrita). Sem ele, vale o nome exato do grupo ou o ID já
 * aprendido na primeira mensagem reconhecida pelo nome.
 */
export function ehDoGrupoMonitorado(
  m: MensagemWebhook,
  grupo: { id: string | null; estrito: boolean },
): { ok: boolean; peloNome: boolean } {
  if (!m.grupo || !m.chatId) return { ok: false, peloNome: false };
  const peloId = Boolean(grupo.id) && idDoGrupo(m.chatId) === grupo.id;
  if (grupo.estrito) return { ok: peloId, peloNome: false };
  const peloNome = Boolean(m.chatNome) && normalizarNomeGrupo(m.chatNome!) === normalizarNomeGrupo(NOME_GRUPO_MONITORADO);
  return { ok: peloId || peloNome, peloNome };
}

/* -------------------------------------------------- endereço e segredo */

const CHAVE_TOKEN = "whatsapp_webhook_token_hash";
const CHAVE_GRUPO = "whatsapp_grupo_id";
const CHAVE_ULTIMA_GRUPO = "whatsapp_webhook_ultima_msg_grupo";
const CHAVE_CONTATO = "whatsapp_webhook_ultimo_contato";
/** Não é um SHA-256: nenhum segredo de aparelho Android pode casar com ele. */
const TOKEN_HASH_SERVIDOR = "servidor:whatsapp-web";
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

function segredoAmbiente() {
  const s = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

function grupoAmbiente() {
  const g = process.env.WHATSAPP_GRUPO_ID?.trim();
  return g ? idDoGrupo(g) : null;
}

async function lerConfig(chaves: string[]) {
  const linhas = await db.select().from(configuracao).where(inArray(configuracao.chave, chaves));
  return new Map(linhas.map((l) => [l.chave, l]));
}

async function gravarConfig(chave: string, valor: string) {
  await db
    .insert(configuracao)
    .values({ chave, valor })
    .onConflictDoUpdate({ target: configuracao.chave, set: { valor, criadoEm: new Date() } });
}

/**
 * Segredo enviado pelo serviço. Aceita os formatos usados pelos serviços:
 * Authorization "Bearer …" / "Basic …" / valor puro (Green-API webhookUrlToken,
 * Evolution e WAHA com cabeçalho), X-Webhook-Token, ou ?token= no endereço
 * (serviços que só aceitam URL, como a Z-API).
 */
function segredosDoPedido(req: Request): string[] {
  const url = new URL(req.url);
  return [
    url.searchParams.get("token") ?? "",
    (req.headers.get("authorization") ?? "").replace(/^(Bearer|Basic|Token)\s+/i, ""),
    req.headers.get("x-webhook-token") ?? "",
  ]
    .map((s) => s.trim())
    .filter((s) => s.length >= 16 && s.length <= 256);
}

export async function segredoWebhookValido(req: Request) {
  const candidatos = segredosDoPedido(req);
  if (!candidatos.length) return false;
  const aceitos: string[] = [];
  const amb = segredoAmbiente();
  if (amb) aceitos.push(sha256(amb));
  const guardado = (await lerConfig([CHAVE_TOKEN])).get(CHAVE_TOKEN)?.valor;
  if (guardado) aceitos.push(guardado);
  return candidatos.some((c) => {
    const h = Buffer.from(sha256(c));
    return aceitos.some((a) => {
      const b = Buffer.from(a);
      return b.length === h.length && timingSafeEqual(b, h);
    });
  });
}

/** Novo segredo do endereço (o anterior deixa de valer). Mostrado UMA vez; no banco fica só o hash. */
export async function gerarSegredoWebhook() {
  const segredo = randomBytes(32).toString("base64url");
  await gravarConfig(CHAVE_TOKEN, sha256(segredo));
  // Novo endereço reativa a entrada, se o admin tinha revogado o "aparelho" do servidor.
  await db.update(monitorDevices).set({ ativo: 1 }).where(eq(monitorDevices.tokenHash, TOKEN_HASH_SERVIDOR));
  return segredo;
}

export async function desativarWebhook() {
  await db.delete(configuracao).where(eq(configuracao.chave, CHAVE_TOKEN));
}

/** Registro "aparelho" usado pelo processamento existente (monitor_messages exige um). */
async function aparelhoServidor() {
  await db
    .insert(monitorDevices)
    .values({ tipo: "MONITOR", tokenHash: TOKEN_HASH_SERVIDOR, nome: "WhatsApp sem APK (servidor)" })
    .onConflictDoNothing();
  const [d] = await db
    .select({ id: monitorDevices.id, ativo: monitorDevices.ativo })
    .from(monitorDevices)
    .where(eq(monitorDevices.tokenHash, TOKEN_HASH_SERVIDOR))
    .limit(1);
  return d;
}

/* ------------------------------------------------------ processamento */

type Enviar = typeof enviarPush;
let contatoGravadoEm = 0;

export async function processarWebhookWhatsApp(body: unknown, enviar: Enviar = enviarPush) {
  // "Serviço conectado": no máximo uma gravação por minuto por instância.
  if (Date.now() - contatoGravadoEm > 60_000) {
    contatoGravadoEm = Date.now();
    await gravarConfig(CHAVE_CONTATO, new Date().toISOString()).catch(() => {});
  }

  const mensagens = lerMensagensWebhook(body);
  const amb = grupoAmbiente();
  const grupo = { id: amb ?? (await lerConfig([CHAVE_GRUPO])).get(CHAVE_GRUPO)?.valor ?? null, estrito: Boolean(amb) };

  let doGrupo = 0;
  let comLista = 0;
  let avisados = 0;
  let duplicadas = 0;
  for (const m of mensagens) {
    const confere = ehDoGrupoMonitorado(m, grupo);
    // Outra conversa (privada ou outro grupo): descartada, nada é gravado.
    if (!confere.ok) continue;
    doGrupo++;
    const id = idDoGrupo(m.chatId);
    if (confere.peloNome && grupo.id !== id && !id.startsWith("nome:")) {
      // Aprende o ID do grupo: continua valendo se o serviço omitir o nome.
      await gravarConfig(CHAVE_GRUPO, id);
      grupo.id = id;
    }
    await gravarConfig(CHAVE_ULTIMA_GRUPO, new Date().toISOString());

    const analise = analisarMensagemGrupo(m.texto);
    if (!analise.naVez.length && !analise.pulados.length) continue; // conversa comum do grupo
    const aparelho = await aparelhoServidor();
    // "Revogar" no painel (Aparelhos pareados) desliga a entrada pelo servidor.
    if (!aparelho?.ativo) continue;
    comLista++;
    const eventId = sha256(`${m.provedor}|${id}|${m.id || sha256(m.texto)}`);
    const r = await processarMensagemGrupo(aparelho, { eventId, origem: `whatsapp-web:${m.provedor}`, texto: m.texto }, enviar);
    if (r.duplicada) duplicadas++;
    avisados += "avisados" in r && typeof r.avisados === "number" ? r.avisados : 0;
  }
  return { recebidas: mensagens.length, doGrupo, comLista, duplicadas, avisados };
}

/** Painel do administrador: situação da conexão (sem texto de mensagens). */
export async function statusWebhook() {
  const cfg = await lerConfig([CHAVE_TOKEN, CHAVE_GRUPO, CHAVE_ULTIMA_GRUPO, CHAVE_CONTATO]);
  const [aparelho] = await db
    .select({ id: monitorDevices.id })
    .from(monitorDevices)
    .where(eq(monitorDevices.tokenHash, TOKEN_HASH_SERVIDOR))
    .limit(1);
  const eventos = aparelho
    ? await db
        .select({ codigos: monitorMessages.codigos, criadoEm: monitorMessages.criadoEm })
        .from(monitorMessages)
        .where(eq(monitorMessages.monitorDeviceId, aparelho.id))
        .orderBy(desc(monitorMessages.id))
        .limit(10)
    : [];
  const amb = grupoAmbiente();
  return {
    configurado: Boolean(cfg.get(CHAVE_TOKEN) || segredoAmbiente()),
    segredoCriadoEm: cfg.get(CHAVE_TOKEN)?.criadoEm.toISOString() ?? null,
    segredoNoAmbiente: Boolean(segredoAmbiente()),
    grupoId: amb ?? cfg.get(CHAVE_GRUPO)?.valor ?? null,
    grupoIdOrigem: amb ? "ambiente" : cfg.get(CHAVE_GRUPO) ? "automatico" : null,
    ultimoContato: cfg.get(CHAVE_CONTATO)?.valor ?? null,
    ultimaMensagemGrupo: cfg.get(CHAVE_ULTIMA_GRUPO)?.valor ?? null,
    listas: eventos.map((e) => ({ codigos: e.codigos as string[], criadoEm: e.criadoEm.toISOString() })),
  };
}
