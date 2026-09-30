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
 * Registra o service worker, cria/confirma a inscrição Web Push deste
 * aparelho e envia ao servidor. `motoristaId` liga o aparelho ao motorista
 * (null mantém a ligação que já existir no servidor).
 */
export async function garantirAssinaturaPush(motoristaId: number | null): Promise<PushSubscription> {
  const chave = await fetch("/api/push/chave", { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => null);
  if (!chave?.publicKey) throw new Error("VAPID indisponível no servidor.");

  const registro = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  const existente = await registro.pushManager.getSubscription();
  const assinatura =
    existente ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveUint8(chave.publicKey),
    }));

  await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscription: assinatura.toJSON(),
      dispositivo: navigator.userAgent.slice(0, 160),
      motoristaId,
    }),
  });
  return assinatura;
}
