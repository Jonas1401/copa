/* ------------------------------------------------------------------
   Service Worker — Monitor Ponto CopaLinks
   Recebe os pushes do backend e transforma em notificação real do
   Chrome (desktop e Android). Não faz leitura da página monitorada:
   o monitoramento continua no servidor, a cada 5 segundos.
------------------------------------------------------------------ */

const APP_URL = "/";
// Ícone oficial CopaLinks (mesmo do app instalado) e badge monocromático.
const ICONE = "/icons/copalinks-192.png";
// Ícone pequeno/monocromático da notificação (Android espera 72x72).
const BADGE = "/icons/copalinks-badge-72.png";
const ACAO_PADRAO = [{ action: "ver-monitor", title: "Ver monitor" }];

self.addEventListener("install", (evento) => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

/* ------------------------------------------------------- rede (passa direto)
   Um handler de fetch é exigido por algumas versões do Chrome para considerar
   o app instalável — e é o app instalado que mostra a LOGO do CopaLinks no
   lugar do ícone do Chrome na notificação. */
self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Deixa o servidor/HTTP cache cuidarem das respostas.
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

/* ---------------------------------------------------------- push */
self.addEventListener("push", (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch (e) {
    dados = { body: evento.data ? evento.data.text() : "" };
  }

  const titulo = dados.title || "🚛 Monitor Ponto CopaLinks";
  const corpo = dados.body || "Atualização do monitoramento.";
  // Tag dinâmica: agrupa notificações do mesmo caso e evita repetição
  // (ex.: TRUCK_LIVRO_A_A025_A030).
  const tag = dados.tag || `monitor_${Date.now()}`;

  const opcoes = {
    body: corpo,
    tag: tag,
    // renotify: true garante som e vibração toda vez que a notificação for atualizada
    renotify: true,
    icon: dados.icon || ICONE,
    badge: dados.badge || BADGE,
    image: dados.image || undefined,
    // vibração padrão para acordar o celular no bolso (vibra 300ms, pausa 100ms, vibra 400ms)
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

  // action "fechar" só descarta; qualquer outra (inclusive o corpo) abre.
  if (evento.action === "fechar") return;

  const destino = new URL(dados.url || APP_URL, self.location.origin).href;

  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // 1) já existe uma aba do Monitor Ponto? foca nela.
      for (const janela of janelas) {
        if (janela.url && janela.url.startsWith(self.location.origin)) {
          if ("focus" in janela) await janela.focus();
          if ("navigate" in janela && janela.url !== destino) {
            try {
              await janela.navigate(destino);
            } catch (e) {
              /* mantém onde está */
            }
          }
          return;
        }
      }

      // 2) não existe: abre o aplicativo.
      if (self.clients.openWindow) {
        return self.clients.openWindow(destino);
      }
    })(),
  );
});

/* --------- assinatura renovada pelo próprio navegador: volta ao backend */
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
      } catch (e) {
        /* fica para a próxima ativação */
      }
    })(),
  );
});
