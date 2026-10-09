/**
 * Web Push das mensagens do chat.
 *
 * Roda SOMENTE num PostgreSQL local descartável (mesma regra do
 * cron-push.test.ts): TEST_DATABASE_URL apontando para um banco chamado
 * fila_push_test_<sufixo>. Nunca toca no banco de produção.
 *
 * Um servidor HTTP local faz o papel do serviço de Push do navegador
 * (Google/Mozilla): recebe o que o backend envia e o teste confere para
 * quem foi e o que foi (o corpo cifrado é conferido por tamanho/cabeçalhos;
 * o texto é conferido pela trava de duplicidade `notificacoes`).
 * O web-push só fala HTTPS, então o serviço falso usa um certificado
 * autoassinado descartável e a validação TLS é desligada SÓ neste processo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync } from "node:crypto";

const uri = process.env.TEST_DATABASE_URL;
let local = false;
try {
  const u = new URL(uri ?? "");
  local =
    ["localhost", "127.0.0.1", "::1"].includes(u.hostname) &&
    u.pathname.startsWith("/fila_push_test_");
} catch {
  local = false;
}

/** Chave p256dh válida (ponto EC P-256 não comprimido, base64url). */
function chaveP256dh() {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  return Buffer.concat([Buffer.from([4]), x, y]).toString("base64url");
}

test("chat: mensagem de motorista e de agente viram Push com nome + texto, sem avisar quem escreveu", { skip: !local }, async () => {
  process.env.DATABASE_URL = uri;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const pasta = mkdtempSync(join(tmpdir(), "chat-push-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(pasta, "k.pem"),
    "-out", join(pasta, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const tls = { key: readFileSync(join(pasta, "k.pem")), cert: readFileSync(join(pasta, "c.pem")) };

  const recebidos: { url: string; topic: string | undefined; urgency: string | undefined }[] = [];
  const servico = createServer(tls, (req, res) => {
    let n = 0;
    req.on("data", (c) => (n += c.length));
    req.on("end", () => {
      recebidos.push({
        url: req.url ?? "",
        topic: req.headers["topic"] as string | undefined,
        urgency: req.headers["urgency"] as string | undefined,
      });
      assert.ok(n > 0, "corpo cifrado deve existir");
      res.statusCode = 201;
      res.end();
    });
  });
  await new Promise<void>((r) => servico.listen(0, "127.0.0.1", () => r()));
  const porta = (servico.address() as AddressInfo).port;
  const base = `https://localhost:${porta}`;

  const { db, pool } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  try {
  const { chatMensagens, motoristas, notificacoes, subscriptions } = await import("@/db/schema");
  const { garantirTabelas } = await import("@/lib/estado");
  const { salvarSubscription } = await import("@/lib/push");
  const { notificarMensagemChat } = await import("@/lib/chat-push");

  await garantirTabelas();
  await db.execute(sql`truncate subscriptions, notificacoes, chat_mensagens restart identity cascade`);
  await db.execute(sql`delete from motoristas`);

  const [ana] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
  const [beto] = await db.insert(motoristas).values({ nome: "Beto" }).returning();
  const auth = Buffer.alloc(16, 7).toString("base64url");
  await salvarSubscription({ endpoint: `${base}/ana`, keys: { p256dh: chaveP256dh(), auth } }, "Ana-cel", ana.id);
  await salvarSubscription({ endpoint: `${base}/beto`, keys: { p256dh: chaveP256dh(), auth } }, "Beto-cel", beto.id);
  await salvarSubscription({ endpoint: `${base}/sem-dono`, keys: { p256dh: chaveP256dh(), auth } }, "anon", null);

  // 1) Ana escreve: Beto e o aparelho sem dono recebem; Ana não.
  const [msg] = await db
    .insert(chatMensagens)
    .values({ motoristaId: ana.id, nome: ana.nome, texto: "Balança liberou, bora!" })
    .returning();
  const r1 = await notificarMensagemChat({ id: msg.id, motoristaId: ana.id, nome: ana.nome, texto: msg.texto });
  assert.equal(r1.assinaturas, 2);
  assert.equal(r1.enviadas, 2);
  const urls1 = recebidos.map((r) => r.url).sort();
  assert.deepEqual(urls1, ["/beto", "/sem-dono"]);
  assert.ok(recebidos.every((r) => r.urgency === "high"));
  assert.ok(recebidos.every((r) => r.topic === `CHAT_${msg.id}`.slice(0, 32)));

  // Conteúdo do aviso: título com o nome e corpo com a mensagem.
  const [trava] = await db.select().from(notificacoes);
  assert.equal(trava.tag, `CHAT_${msg.id}`);
  assert.equal(trava.titulo, "💬 Ana");
  assert.equal(trava.corpo, "Balança liberou, bora!");

  // 2) Repetir a mesma mensagem não notifica de novo (tag única).
  const r2 = await notificarMensagemChat({ id: msg.id, motoristaId: ana.id, nome: ana.nome, texto: msg.texto });
  assert.equal(r2.enviadas, 0);
  assert.equal(recebidos.length, 2);

  // 3) Monitor de navios (motorista_id 0): todos recebem.
  recebidos.length = 0;
  const [clima] = await db
    .insert(chatMensagens)
    .values({ motoristaId: 0, nome: "🚢 Navios no Porto", texto: "ECO CERBERUS\nSaldo Total do Navio 544,190 Tons." })
    .returning();
  const r3 = await notificarMensagemChat(
    { id: clima.id, motoristaId: 0, nome: clima.nome, texto: clima.texto },
    { requireInteraction: true },
  );
  assert.equal(r3.enviadas, 3);
  assert.deepEqual(recebidos.map((r) => r.url).sort(), ["/ana", "/beto", "/sem-dono"]);
  const travas = await db.select().from(notificacoes);
  const doClima = travas.find((t) => t.tag === `CHAT_${clima.id}`);
  assert.equal(doClima?.titulo, "🚢 Navios no Porto");
  assert.equal(doClima?.corpo, "ECO CERBERUS\nSaldo Total do Navio 544,190 Tons.");

  // 4) Boas-vindas do sistema não estão mais na lista de agentes permitidos.
  const [paulo] = await db.insert(motoristas).values({ nome: "Paulo" }).returning();
  await salvarSubscription({ endpoint: `${base}/paulo`, keys: { p256dh: chaveP256dh(), auth } }, "Paulo-cel", paulo.id);
  recebidos.length = 0;
  const [boasVindas] = await db.insert(chatMensagens).values({
    motoristaId: 0,
    nome: "👋 CopaLinks",
    texto: "Fala, turma! O Paulo chegou ao CopaLinks. Deixem um alô! 🚛",
  }).returning();
  const r4 = await notificarMensagemChat(
    { id: boasVindas.id, motoristaId: 0, nome: "👋 CopaLinks", texto: boasVindas.texto },
    {
      excetoMotoristaId: paulo.id,
      notificacao: { titulo: "👋 Reforço novo na boleia!", corpo: "Paulo chegou. Abra o chat e mande um alô!" },
    },
  );
  assert.equal(r4.enviadas, 0);
  assert.deepEqual(recebidos, []);
  const avisos = await db.select().from(notificacoes);
  const avisoBoasVindas = avisos.find((n) => n.tag === `CHAT_${boasVindas.id}`);
  assert.equal(avisoBoasVindas, undefined);

  // 5) Texto longo é resumido para caber na notificação.
  const longo = "x".repeat(600);
  const [m4] = await db.insert(chatMensagens).values({ motoristaId: beto.id, nome: "Beto", texto: longo }).returning();
  await notificarMensagemChat({ id: m4.id, motoristaId: beto.id, nome: "Beto", texto: longo });
  const t4 = (await db.select().from(notificacoes)).find((t) => t.tag === `CHAT_${m4.id}`);
  assert.ok(t4 && t4.corpo.length <= 220 && t4.corpo.endsWith("…"));

  } finally {
    await db.execute(sql`truncate subscriptions, notificacoes, chat_mensagens restart identity cascade`).catch(() => {});
    await db.execute(sql`delete from motoristas`).catch(() => {});
    servico.close();
    rmSync(pasta, { recursive: true, force: true });
    await pool.end();
  }
});
