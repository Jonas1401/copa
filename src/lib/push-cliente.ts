/**
 * Web Push no navegador — usado pelo app (motorista) e pelo painel do
 * administrador. Só roda no cliente (usa window e navigator).
 */
import { CHAVE_MOTORISTA } from "@/lib/motoristas";

export const temSuportePush = () =>
  typeof window !== "undefined" &&
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

/** A chave pública VAPID vem do servidor em base64url: vira bytes p/ o browser. */
export function chaveUint8(chave: string) {
  const base = chave.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base);
  const saida = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) saida[i] = bin.charCodeAt(i);
  return saida;
}

/** Motorista salvo neste aparelho pelo app (o aviso sai com o nome dele). */
export function motoristaDoAparelho(): number | null {
  try {
    const m = JSON.parse(localStorage.getItem(CHAVE_MOTORISTA) ?? "null") as { id?: unknown } | null;
    return typeof m?.id === "number" ? m.id : null;
  } catch {
    return null;
  }
}

/** Inscrição que este aparelho já tem (sem pedir permissão nem criar nada). */
export async function assinaturaAtual(): Promise<PushSubscription | null> {
  if (!temSuportePush()) return null;
  const registro = await navigator.serviceWorker.getRegistration("/");
  return (await registro?.pushManager.getSubscription()) ?? null;
}

/**
 * Tempo máximo de cada etapa da ativação. `serviceWorker.ready` e
 * `pushManager.subscribe` podem não terminar NUNCA (o SW não instala, o
 * servidor de Push não responde): sem esse teto o botão "Ativar notificações"
 * girava para sempre e, como o aviso do administrador cobre a tela inteira,
 * o motorista ficava com o aplicativo travado.
 */
export const TEMPO_PUSH_MS = 20_000;

/** Resolve `promessa` ou recusa com `etapa` depois de `ms`. */
export function comTempoLimite<T>(promessa: Promise<T>, ms: number, etapa: string): Promise<T> {
  let fim: ReturnType<typeof setTimeout> | undefined;
  const espera = new Promise<never>((_, recusar) => {
    fim = setTimeout(() => recusar(new Error(`Tempo esgotado em ${etapa}.`)), ms);
  });
  return Promise.race([promessa, espera]).finally(() => {
    if (fim) clearTimeout(fim);
  });
}

/** fetch que desiste sozinho (o do navegador espera para sempre). */
async function fetchComTempo(url: string, init: RequestInit, ms: number) {
  const controlador = new AbortController();
  const fim = setTimeout(() => controlador.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controlador.signal });
  } finally {
    clearTimeout(fim);
  }
}

/**
 * Registra o service worker, cria/confirma a inscrição Web Push deste
 * aparelho e envia ao servidor. `motoristaId` liga o aparelho ao motorista
 * (null mantém a ligação que já existir no servidor).
 * Toda etapa tem tempo limite: ou volta com a assinatura, ou recusa — nunca
 * fica parada no meio.
 */
export async function garantirAssinaturaPush(motoristaId: number | null): Promise<PushSubscription> {
  const chave = await fetchComTempo("/api/push/chave", { cache: "no-store" }, TEMPO_PUSH_MS)
    .then((r) => r.json())
    .catch(() => null);
  if (!chave?.publicKey) throw new Error("VAPID indisponível no servidor.");

  const registro = await comTempoLimite(
    navigator.serviceWorker.register("/sw.js", { scope: "/" }),
    TEMPO_PUSH_MS,
    "o registro das notificações",
  );
  await comTempoLimite(navigator.serviceWorker.ready, TEMPO_PUSH_MS, "a instalação das notificações");

  const existente = await comTempoLimite(registro.pushManager.getSubscription(), TEMPO_PUSH_MS, "a leitura da inscrição");
  const assinatura =
    existente ??
    (await comTempoLimite(
      registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveUint8(chave.publicKey),
      }),
      TEMPO_PUSH_MS,
      "a inscrição das notificações",
    ));

  // Se o servidor não gravar a inscrição, o alerta não fecha: melhor avisar
  // agora do que deixar o motorista tocando num botão que não muda nada.
  const salvo = await fetchComTempo(
    "/api/push/subscription",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: assinatura.toJSON(),
        dispositivo: navigator.userAgent.slice(0, 160),
        motoristaId,
      }),
    },
    TEMPO_PUSH_MS,
  );
  if (!salvo.ok) throw new Error("O servidor não confirmou as notificações.");
  return assinatura;
}
