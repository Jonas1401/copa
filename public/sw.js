/* ------------------------------------------------------------------
   Service Worker — Monitor Ponto CopaLinks
   Recebe os pushes do backend e transforma em notificação real do
   Chrome (desktop e Android). Também mantém o /api/cron acordado
   a cada minuto, para os alertas de chuva/navios/ponto saírem
   mesmo com o aplicativo fechado.
------------------------------------------------------------------ */

const APP_URL = "/";
const CRON_URL = "/api/cron";
const WAKE_URL = "/api/cron/wake";
const ICONE = "/icons/copalinks-192.png";
const BADGE = "/icons/copalinks-badge-72.png";
const ACAO_PADRAO = [{ action: "ver-monitor", title: "Ver monitor" }];

/* Intervalo do keepalive: 60 s, como o cron do servidor. */
const WAKE_INTERVALO_MS = 60 * 1000;
/* Não acorda entre 22:30 e 05:30 a não ser que chegue um push. */
const HORA_SILENCIO_INICIO = 22 * 60 + 30;
const HORA_SILENCIO_FIM = 5 * 60 + 30;

let wakeToken = null;
let wakeTimer = null;
let ultimoWake = 0;
let ultimoCronOk = 0;

/* Defensivo: em alguns worker contexts (testes, SW antigos) essas APIs
   podem não existir. Sem elas o keepalive simplesmente não roda, mas o
   recebimento de push continua funcionando normalmente. */
const _setTimeout = (typeof setTimeout !== "undefined") ? setTimeout : function (_fn, _t) { return 0; };
const _clearTimeout = (typeof clearTimeout !== "undefined") ? clearTimeout : function () {};

self.addEventListener("install", (evento) => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
  // Assim que o SW ativa (inclusive após novo deploy), começa a manter
  // o /api/cron acordado.
  evento.waitUntil(iniciarKeepalive());
});

/* ------------------------------------------------------- rede (passa direto) */
self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Usa "credenciais same-origin" para os cookies da sessão do admin
  // (não afeta o wake token, que vai por header).
  evento.respondWith(
    fetch(req).catch(
      () =>
        new Response("Sem conexão", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    ),
  );
});

/* ---------------------------------------------------- wake / keepalive ---- */

function minutosDoDia(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}
function emHorarioSilencio(d = new Date()) {
  const m = minutosDoDia(d);
  return m >= HORA_SILENCIO_INICIO || m < HORA_SILENCIO_FIM;
}

async function buscarWakeToken() {
  try {
    const r = await fetch(WAKE_URL, { cache: "no-store", credentials: "omit" });
    if (!r.ok) return null;
    const j = await r.json();
    return j.token || null;
  } catch {
    return null;
  }
}

async function chamarCron() {
  // Evita disparar duas vezes no mesmo segundo (ex.: um push chega
  // enquanto o timer está disparando).
  const agora = Date.now();
  if (agora - ultimoWake < 45_000) return;
  ultimoWake = agora;

  // Busca o token se não tiver ou se o anterior já tiver sido rejeitado.
  if (!wakeToken) wakeToken = await buscarWakeToken();
  if (!wakeToken) return;

  try {
    const r = await fetch(CRON_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { "X-Wake-Token": wakeToken },
    });
    if (r.status === 401) {
      // Token pode ter sido rotacionado; tenta pegar um novo na próxima.
      wakeToken = null;
      return;
    }
    if (r.ok) ultimoCronOk = Date.now();
  } catch {
    // Sem rede: tenta de novo no próximo ciclo.
  }
}

function agendarProximoWake() {
  _clearTimeout(wakeTimer);
  let atraso = WAKE_INTERVALO_MS;
  if (emHorarioSilencio()) {
    const agora = new Date();
    const fim = new Date(agora);
    fim.setHours(5, 30, 0, 0);
    if (minutosDoDia(agora) >= HORA_SILENCIO_INICIO) {
      fim.setDate(fim.getDate() + 1);
    }
    atraso = Math.max(30 * 60_000, fim.getTime() - agora.getTime());
  }
  wakeTimer = _setTimeout(() => {
    void chamarCron().finally(() => agendarProximoWake());
  }, atraso);
}

async function iniciarKeepalive() {
  _setTimeout(() => { void chamarCron().finally(() => agendarProximoWake()); }, 1500);

  try {
    const reg = self.registration;
    if (reg && reg.periodicSync) {
      const tags = await reg.periodicSync.getTags().catch(() => []);
      if (!tags.includes("copalinks-cron")) {
        await reg.periodicSync.register("copalinks-cron", {
          minInterval: 60 * 1000,
        }).catch(() => {});
      }
    }
  } catch { /* ignorar se não suportado */ }
}

self.addEventListener("periodicsync", (evento) => {
  if (evento.tag === "copalinks-cron") {
    evento.waitUntil(chamarCron());
  }
});

// Quando chega qualquer push, já chamamos o cron mais cedo (o SO acabou
// de acordar o navegador, é um bom momento para consultar novidades).
function acordar() {
  ultimoWake = 0;
  void chamarCron().finally(() => agendarProximoWake());
}

/* ---------------------------------------------------------- push */
self.addEventListener("push", (evento) => {
  // Avisa o cron que o navegador está vivo — puxa possíveis novidades
  // imediatamente sem esperar o próximo timer.
  _setTimeout(acordar, 500);

  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch (e) {
    dados = { body: evento.data ? evento.data.text() : "" };
  }

  const titulo = dados.title || "🚛 Monitor Ponto CopaLinks";
  const corpo = dados.body || "Atualização do monitoramento.";
  const tag = dados.tag || `monitor_${Date.now()}`;

  const opcoes = {
    body: corpo,
    tag: tag,
    renotify: true,
    icon: dados.icon || ICONE,
    badge: dados.badge || BADGE,
    image: dados.image || undefined,
    vibrate: [300, 100, 400, 100, 300],
    requireInteraction: Boolean(dados.requireInteraction),
    silent: false,
    data: {
      url: dados.url || APP_URL,
      acao: dados.acao || "atualizacao",
      tag: tag,
      criadoEm: Date.now(),
    },
    actions: (Array.isArray(dados.actions) && dados.actions.length
      ? dados.actions
      : ACAO_PADRAO
    ).slice(0, 2),
  };

  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

/* ------------------------------------------------- clique na notificação */
self.addEventListener("notificationclick", (evento) => {
  const dados = (evento.notification && evento.notification.data) || {};
  evento.notification.close();
  if (evento.action === "fechar") return;
  const destino = new URL(dados.url || APP_URL, self.location.origin).href;
  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const janela of janelas) {
        if (janela.url && janela.url.startsWith(self.location.origin)) {
          if ("focus" in janela) await janela.focus();
          if (dados.acao === "chat" && "postMessage" in janela) {
            try { janela.postMessage({ tipo: "abrir-chat", tag: dados.tag }); }
            catch (e) { /* segue */ }
          }
          if ("navigate" in janela && janela.url !== destino) {
            try { await janela.navigate(destino); }
            catch (e) { /* mantém */ }
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })(),
  );
});

/* --------- assinatura renovada pelo próprio navegador ---- */
self.addEventListener("pushsubscriptionchange", (evento) => {
  evento.waitUntil(
    (async () => {
      try {
        const nova = await self.registration.pushManager.subscribe(
          evento.oldSubscription ? evento.oldSubscription.options : {},
        );
        await fetch("/api/push/subscription", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(nova.toJSON()),
        });
      } catch (e) { /* fica para a próxima */ }
    })(),
  );
});

self.addEventListener("message", (evento) => {
  const dados = evento.data || {};
  if (dados.tipo === "ping") {
    // A página abriu: garante que o keepalive está rodando.
    void iniciarKeepalive();
  }
});
