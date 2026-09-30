/**
 * Filtro do grupo SEM APK: entrada pelo servidor (webhook do serviço de WhatsApp Web).
 * A parte com banco roda SOMENTE num PostgreSQL local descartável
 * (TEST_DATABASE_URL = banco fila_push_test_<sufixo>), como os demais testes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ehDoGrupoMonitorado, idDoGrupo, lerMensagensWebhook } from "../src/lib/whatsapp-webhook";

const GRUPO = "INFO. OP PORTO / FOSPAR **";
const LISTA = "PONTOS NA VEZ\n\nCARRETAS TRUCADAS (A):\nA014 - A016 - A021\n\nTRUCADAS PULADAS:\nA137 - A140";

const green = (chatId: string, chatName: string | undefined, texto: string, id = "3EB0GREEN") => ({
  typeWebhook: "incomingMessageReceived",
  instanceData: { idInstance: 7103000000, wid: "5541999990000@c.us", typeInstance: "whatsapp" },
  timestamp: 1732268220,
  idMessage: id,
  senderData: { chatId, ...(chatName ? { chatName } : {}), sender: "5541988887777@c.us", senderName: "Copadubo" },
  messageData: { typeMessage: "extendedTextMessage", extendedTextMessageData: { text: texto } },
});

test("lê os formatos Green-API, Z-API, Evolution, WAHA, Whapi e genérico", () => {
  const g = lerMensagensWebhook(green("120363369140947676@g.us", GRUPO, LISTA));
  assert.deepEqual(g, [{ provedor: "green-api", id: "3EB0GREEN", chatId: "120363369140947676@g.us", chatNome: GRUPO, grupo: true, texto: LISTA }]);

  const gTexto = lerMensagensWebhook({ ...green("x@g.us", GRUPO, ""), messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "oi" } } });
  assert.equal(gTexto[0].texto, "oi");

  const z = lerMensagensWebhook({ isGroup: true, messageId: "ZAPI1", phone: "120363019502650977-group", fromMe: false, chatName: GRUPO, type: "ReceivedCallback", text: { message: LISTA } });
  assert.equal(z[0].provedor, "z-api");
  assert.equal(z[0].grupo, true);
  assert.equal(idDoGrupo(z[0].chatId), "120363019502650977");

  const ev = lerMensagensWebhook({ event: "messages.upsert", instance: "copa", data: { key: { remoteJid: "120363019502650977@g.us", fromMe: false, id: "EVO1" }, message: { conversation: LISTA } } });
  assert.deepEqual([ev[0].provedor, ev[0].id, ev[0].chatNome, ev[0].texto], ["evolution", "EVO1", null, LISTA]);
  const evExt = lerMensagensWebhook({ event: "MESSAGES_UPSERT", data: { key: { remoteJid: "1@g.us", id: "E2" }, message: { extendedTextMessage: { text: "t" } } } });
  assert.equal(evExt[0].texto, "t");

  const w = lerMensagensWebhook({ event: "message", session: "default", payload: { id: "false_1@g.us_AAA", from: "120363019502650977@g.us", fromMe: false, body: LISTA } });
  assert.deepEqual([w[0].provedor, w[0].grupo, w[0].texto], ["waha", true, LISTA]);

  const wh = lerMensagensWebhook({ messages: [{ id: "WH1", from_me: false, type: "text", chat_id: "120363019502650977@g.us", chat_name: GRUPO, text: { body: LISTA } }] });
  assert.deepEqual([wh[0].provedor, wh[0].chatNome], ["whapi", GRUPO]);

  const gen = lerMensagensWebhook({ id: "B1", chatId: "120363019502650977@g.us", chatName: GRUPO, isGroup: true, texto: LISTA });
  assert.equal(gen[0].provedor, "generico");

  for (const lixo of [null, 42, "x", [], {}, { typeWebhook: "stateInstanceChanged", stateInstance: "authorized" }, { event: "connection.update" }]) {
    assert.deepEqual(lerMensagensWebhook(lixo), []);
  }
});

test("só o grupo monitorado passa: nome exato, ID aprendido ou ID fixo (estrito)", () => {
  const [doGrupo] = lerMensagensWebhook(green("120363369140947676@g.us", GRUPO, LISTA));
  const [outroGrupo] = lerMensagensWebhook(green("120363000000000001@g.us", "INFO. OP PORTO / FOSPAR ** OUTRO", LISTA));
  const [privado] = lerMensagensWebhook(green("5541988887777@c.us", GRUPO, LISTA));
  const [semNome] = lerMensagensWebhook(green("120363369140947676@g.us", undefined, LISTA));
  const livre = { id: null, estrito: false };

  assert.deepEqual(ehDoGrupoMonitorado(doGrupo, livre), { ok: true, peloNome: true });
  assert.equal(ehDoGrupoMonitorado({ ...doGrupo, chatNome: "  info.  op porto /  fospar **  " }, livre).ok, true);
  assert.equal(ehDoGrupoMonitorado(outroGrupo, livre).ok, false, "nome parecido não vale");
  assert.equal(ehDoGrupoMonitorado(privado, livre).ok, false, "conversa privada nunca vale, mesmo com o nome");
  assert.equal(ehDoGrupoMonitorado(semNome, livre).ok, false, "sem nome e sem ID conhecido: descarta");
  assert.equal(ehDoGrupoMonitorado(semNome, { id: "120363369140947676", estrito: false }).ok, true, "ID aprendido vale");
  // ID fixo pelo ambiente: só ele vale, nem o nome abre exceção.
  assert.equal(ehDoGrupoMonitorado(doGrupo, { id: "120363000000000001", estrito: true }).ok, false);
  assert.equal(ehDoGrupoMonitorado(outroGrupo, { id: "120363000000000001", estrito: true }).ok, true);
});

const uri = process.env.TEST_DATABASE_URL;
let local = false;
try {
  const u = new URL(uri ?? "");
  local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname) && u.pathname.startsWith("/fila_push_test_");
} catch {
  local = false;
}

test("fluxo completo: segredo, só o grupo, aviso só ao dono, sem repetir e sem gravar texto", { skip: !local }, async () => {
  process.env.DATABASE_URL = uri;
  delete process.env.WHATSAPP_WEBHOOK_SECRET;
  delete process.env.WHATSAPP_GRUPO_ID;
  const { db, pool } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const schema = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const wh = await import("../src/lib/whatsapp-webhook");
  try {
    await garantirTabelas();
    await db.execute(sql`truncate pontos, configuracao, notificacoes restart identity`);
    await db.execute(sql`delete from monitor_deliveries; delete from monitor_messages; delete from monitor_devices; delete from motoristas`);

    // Segredo: sem gerar, nada entra; depois vale em todos os formatos aceitos.
    const pedido = (h: Record<string, string>, q = "") => new Request(`https://copa-links.vercel.app/api/whatsapp/webhook${q}`, { method: "POST", headers: h });
    assert.equal(await wh.segredoWebhookValido(pedido({ authorization: "Bearer qualquer-coisa-longa-123" })), false);
    const segredo = await wh.gerarSegredoWebhook();
    assert.equal(segredo.length, 43);
    for (const p of [
      pedido({ authorization: `Bearer ${segredo}` }),
      pedido({ authorization: `Basic ${segredo}` }),
      pedido({ authorization: segredo }),
      pedido({ "x-webhook-token": segredo }),
      pedido({}, `?token=${segredo}`),
    ]) assert.equal(await wh.segredoWebhookValido(p), true);
    assert.equal(await wh.segredoWebhookValido(pedido({ authorization: `Bearer ${segredo}x` })), false);
    const [cfg] = await db.select().from(schema.configuracao).where(sql`chave = 'whatsapp_webhook_token_hash'`);
    assert.notEqual(cfg.valor, segredo, "no banco fica só o hash");

    // Motoristas: Ana A014, Beto A140 (pulado), Caio A190 (não confundir com A019/A014).
    const [ana] = await db.insert(schema.motoristas).values({ nome: "Ana" }).returning();
    const [beto] = await db.insert(schema.motoristas).values({ nome: "Beto" }).returning();
    const [caio] = await db.insert(schema.motoristas).values({ nome: "Caio" }).returning();
    await db.insert(schema.pontos).values([
      { motoristaId: ana.id, tipo: "CAVALO", livro: "A", numero: 14 },
      { motoristaId: beto.id, tipo: "CAVALO", livro: "A", numero: 140 },
      { motoristaId: caio.id, tipo: "CAVALO", livro: "A", numero: 190 },
    ]);
    const enviados: { motoristaId: number | null | undefined; title: string }[] = [];
    const enviar = (async (payload: { title: string }, opcoes?: { motoristaId?: number | null }) => {
      enviados.push({ motoristaId: opcoes?.motoristaId, title: payload.title });
      return { enviadas: 1, assinaturas: 1 };
    }) as unknown as Parameters<typeof wh.processarWebhookWhatsApp>[1];

    // Conversa privada e outro grupo com a mesma lista: descartados.
    let r = await wh.processarWebhookWhatsApp(green("5541988887777@c.us", "Fulano", LISTA, "P1"), enviar);
    assert.deepEqual([r.doGrupo, r.comLista], [0, 0]);
    r = await wh.processarWebhookWhatsApp(green("120363000000000001@g.us", "Outro grupo", LISTA, "O1"), enviar);
    assert.deepEqual([r.doGrupo, r.comLista], [0, 0]);
    assert.equal(enviados.length, 0);

    // Conversa comum do grupo: registra que o grupo está chegando, sem aviso.
    r = await wh.processarWebhookWhatsApp(green("120363369140947676@g.us", GRUPO, "Bom dia! Alguém viu o A014?", "C1"), enviar);
    assert.deepEqual([r.doGrupo, r.comLista], [1, 0]);

    // Lista do grupo: cada um recebe só o próprio aviso.
    r = await wh.processarWebhookWhatsApp(green("120363369140947676@g.us", GRUPO, LISTA, "L1"), enviar);
    assert.deepEqual([r.doGrupo, r.comLista, r.avisados], [1, 1, 2]);
    const de = (id: number) => enviados.filter((e) => e.motoristaId === id).map((e) => e.title);
    assert.deepEqual(de(ana.id), ["🔔 Ponto na vez nº A014"]);
    assert.deepEqual(de(beto.id), ["⚠️ Ponto pulado nº A140"]);
    assert.deepEqual(de(caio.id), []);

    // O serviço reenvia a mesma mensagem: não repete.
    r = await wh.processarWebhookWhatsApp(green("120363369140947676@g.us", GRUPO, LISTA, "L1"), enviar);
    assert.equal(r.duplicadas, 1);
    assert.equal(enviados.length, 2);

    // ID aprendido: mensagem do grupo sem nome (outro formato) também passa.
    const st = await wh.statusWebhook();
    assert.equal(st.grupoId, "120363369140947676");
    assert.equal(st.grupoIdOrigem, "automatico");
    assert.ok(st.ultimaMensagemGrupo && st.ultimoContato);
    assert.equal(st.listas.length, 1);
    r = await wh.processarWebhookWhatsApp({ event: "message", payload: { id: "W1", from: "120363369140947676@g.us", body: "PONTOS NA VEZ\nA190" } }, enviar);
    assert.equal(r.comLista, 1);
    assert.deepEqual(de(caio.id), ["🔔 Ponto na vez nº A190"]);

    // Nada do texto foi gravado em lugar nenhum.
    const tudo = JSON.stringify(await db.execute(sql`select * from monitor_messages`)) + JSON.stringify(await db.select().from(schema.configuracao));
    assert.equal(tudo.includes("Alguém viu"), false);
    assert.equal(tudo.includes("A014 - A016"), false);

    // "Revogar" o aparelho do servidor no painel desliga os avisos; novo endereço religa.
    await db.execute(sql`update monitor_devices set ativo = 0 where token_hash = 'servidor:whatsapp-web'`);
    r = await wh.processarWebhookWhatsApp(green("120363369140947676@g.us", GRUPO, "PONTOS NA VEZ\nA014", "R1"), enviar);
    assert.deepEqual([r.doGrupo, r.comLista], [1, 0]);
    await wh.gerarSegredoWebhook();
    r = await wh.processarWebhookWhatsApp(green("120363369140947676@g.us", GRUPO, "PONTOS NA VEZ\nA140", "R2"), enviar);
    assert.equal(r.comLista, 1);

    // Desativar: o segredo antigo para de valer.
    await wh.desativarWebhook();
    assert.equal(await wh.segredoWebhookValido(pedido({ authorization: `Bearer ${segredo}` })), false);
  } finally {
    await db.execute(sql`truncate pontos, configuracao, notificacoes restart identity`).catch(() => {});
    await db.execute(sql`delete from monitor_deliveries; delete from monitor_messages; delete from monitor_devices; delete from motoristas`).catch(() => {});
    await pool.end();
  }
});
