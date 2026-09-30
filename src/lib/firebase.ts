import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

/**
 * Firebase Admin — SOMENTE servidor. A conta de serviço é lida de variável
 * privada da Vercel, nunca importada do GitHub nem enviada ao navegador.
 * O Android recebe só o código monitorado; o texto do WhatsApp não é enviado.
 */
const APP = "copalinks-monitor";

export function firebaseConfigurado() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
}

function aplicativo() {
  const ativo = getApps().find((a) => a.name === APP);
  if (ativo) return ativo;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase não configurado no servidor.");
  let credenciais: { project_id?: string; client_email?: string; private_key?: string };
  try { credenciais = JSON.parse(raw); }
  catch { throw new Error("Credencial Firebase inválida no servidor."); }
  if (!credenciais.project_id || !credenciais.client_email || !credenciais.private_key) {
    throw new Error("Credencial Firebase incompleta no servidor.");
  }
  return initializeApp({
    credential: cert({
      projectId: credenciais.project_id,
      clientEmail: credenciais.client_email,
      privateKey: credenciais.private_key.replace(/\\n/g, "\n"),
    }),
    projectId: credenciais.project_id,
  }, APP);
}

export async function enviarCodigoFCM(fcmToken: string, codigo: string, eventId: string) {
  return getMessaging(aplicativo()).send({
    token: fcmToken,
    data: {
      tipo: "codigo_whatsapp",
      codigo,
      titulo: "🚛 CopaLinks · código monitorado",
      corpo: `O código ${codigo} apareceu em uma notificação do WhatsApp.`,
      evento: eventId,
    },
    android: { priority: "high", ttl: 24 * 60 * 60 * 1000 },
  });
}

/** Teste sob sessão de motorista, para um único Android pareado. */
export async function enviarTesteFCM(fcmToken: string) {
  return getMessaging(aplicativo()).send({
    token: fcmToken,
    data: {
      tipo: "teste_monitor",
      titulo: "🚛 Teste CopaLinks Monitor",
      corpo: "O Firebase aceitou o teste para este aparelho Android.",
      evento: randomUUID(),
    },
    android: { priority: "high", ttl: 60_000 },
  });
}
