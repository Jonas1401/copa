import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

test("Service Worker mostra Push sem janela do app e abre o monitor ao tocar", async () => {
  type Evento = { data?: { json(): unknown }; waitUntil(p: Promise<unknown>): void };
  type Notificacao = { body: string; tag: string; requireInteraction: boolean; data: { url: string } };
  const handlers = new Map<string, (evento: Evento & Record<string, unknown>) => void>();
  const mostradas: { titulo: string; opcoes: Notificacao }[] = [];
  const janelasAbertas: string[] = [];
  const self = {
    location: { origin: "https://copa-links.vercel.app" },
    addEventListener(nome: string, handler: (evento: Evento & Record<string, unknown>) => void) {
      handlers.set(nome, handler);
    },
    registration: {
      async showNotification(titulo: string, opcoes: Notificacao) {
        await new Promise((r) => setTimeout(r, 25));
        mostradas.push({ titulo, opcoes });
      },
    },
    clients: {
      async matchAll() { return []; }, // app fechado, nenhuma janela aberta
      async openWindow(url: string) { janelasAbertas.push(url); },
    },
    skipWaiting() {},
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, Response, Date, fetch }, { filename: "public/sw.js" });

  let pendente: Promise<unknown> | null = null;
  const push = handlers.get("push");
  assert.ok(push, "Service Worker precisa escutar Push");
  push({
    data: { json: () => ({
      title: "🚛 Monitor Ponto CopaLinks",
      body: "Seu número saiu para o trabalho: agora aparece como Último Escalado.",
      tag: "SAIU_CAVALO_LIVRO_A_A184_A187_M1",
      url: "/",
      requireInteraction: true,
    }) },
    waitUntil(p) { pendente = p; },
  });
  assert.ok(pendente, "o Worker precisa manter o evento vivo até a notificação aparecer");
  await pendente;
  assert.equal(mostradas.length, 1);
  assert.match(mostradas[0].opcoes.body, /Último Escalado/);
  assert.equal(mostradas[0].opcoes.requireInteraction, true);
  assert.equal(mostradas[0].opcoes.tag, "SAIU_CAVALO_LIVRO_A_A184_A187_M1");

  let aguardaClique: Promise<unknown> | null = null;
  const click = handlers.get("notificationclick");
  assert.ok(click, "Service Worker precisa abrir o app ao tocar no aviso");
  click({
    notification: { data: mostradas[0].opcoes.data, close() {} },
    action: "ver-monitor",
    waitUntil(p) { aguardaClique = p; },
  });
  assert.ok(aguardaClique);
  await aguardaClique;
  assert.deepEqual(janelasAbertas, ["https://copa-links.vercel.app/"]);
});

test("Service Worker mostra a mensagem do chat (nome + texto) e abre o chat ao tocar, com o app fechado ou aberto", async () => {
  type Evento = { data?: { json(): unknown }; waitUntil(p: Promise<unknown>): void };
  type Notificacao = { body: string; tag: string; data: { url: string; acao: string; tag: string } };
  const handlers = new Map<string, (evento: Evento & Record<string, unknown>) => void>();
  const mostradas: { titulo: string; opcoes: Notificacao }[] = [];
  const janelasAbertas: string[] = [];
  const mensagens: unknown[] = [];
  const navegadas: string[] = [];
  let janelas: unknown[] = [];
  const self = {
    location: { origin: "https://copa-links.vercel.app" },
    addEventListener(nome: string, handler: (evento: Evento & Record<string, unknown>) => void) {
      handlers.set(nome, handler);
    },
    registration: { async showNotification(titulo: string, opcoes: Notificacao) { mostradas.push({ titulo, opcoes }); } },
    clients: {
      async matchAll() { return janelas; },
      async openWindow(url: string) { janelasAbertas.push(url); },
    },
    skipWaiting() {},
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, Response, Date, fetch }, { filename: "public/sw.js" });

  // Push da mensagem do chat, exatamente como src/lib/chat-push.ts envia.
  let pendente: Promise<unknown> | null = null;
  handlers.get("push")!({
    data: { json: () => ({ title: "💬 Ana", body: "Balança liberou, bora!", tag: "CHAT_12", acao: "chat", url: "/?chat=1",
      actions: [{ action: "abrir-chat", title: "Abrir chat" }, { action: "fechar", title: "Fechar" }] }) },
    waitUntil(p) { pendente = p; },
  });
  await pendente;
  assert.equal(mostradas[0].titulo, "💬 Ana");
  assert.equal(mostradas[0].opcoes.body, "Balança liberou, bora!");
  assert.equal(mostradas[0].opcoes.data.acao, "chat");
  assert.equal(mostradas[0].opcoes.data.url, "/?chat=1");

  // 1) App fechado: toque abre o app já no chat.
  let aguarda: Promise<unknown> | null = null;
  const click = handlers.get("notificationclick")!;
  click({ notification: { data: mostradas[0].opcoes.data, close() {} }, action: "abrir-chat", waitUntil(p) { aguarda = p; } });
  await aguarda;
  assert.deepEqual(janelasAbertas, ["https://copa-links.vercel.app/?chat=1"]);

  // 2) App aberto: a aba recebe "abrir-chat" (sem recarregar) e é focada.
  let focada = false;
  janelas = [{
    url: "https://copa-links.vercel.app/",
    async focus() { focada = true; },
    postMessage(m: unknown) { mensagens.push(m); },
    async navigate(u: string) { navegadas.push(u); },
  }];
  click({ notification: { data: mostradas[0].opcoes.data, close() {} }, action: "", waitUntil(p) { aguarda = p; } });
  await aguarda;
  assert.equal(focada, true);
  // O objeto nasce noutro contexto do vm: compara pelo conteúdo, não pelo protótipo.
  assert.deepEqual(JSON.parse(JSON.stringify(mensagens)), [{ tipo: "abrir-chat", tag: "CHAT_12" }]);
  assert.deepEqual(navegadas, ["https://copa-links.vercel.app/?chat=1"]);
  assert.equal(janelasAbertas.length, 1, "não abre segunda janela quando o app já está aberto");

  // 3) "Fechar" só descarta a notificação.
  let fechou = false;
  click({ notification: { data: mostradas[0].opcoes.data, close() { fechou = true; } }, action: "fechar", waitUntil() {} });
  assert.equal(fechou, true);
  assert.equal(mensagens.length, 1);
});
