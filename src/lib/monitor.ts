import { and, desc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/supabase";
import { monitorCodes, monitorDeliveries, monitorDevices, monitorMessages } from "@/db/schema";
import { enviarCodigoFCM } from "@/lib/firebase";
import { extrairCodigos, normalizarCodigo } from "@/lib/matcher";
import { HASH_GRUPO_MONITORADO } from "@/lib/monitor-group";

export const PACOTES_WHATSAPP = ["com.whatsapp", "com.whatsapp.w4b"] as const;
const LIMITE_EVENTOS_MINUTO = 30;
const MAX_CODIGOS_EVENTO = 12;

export type EventoMonitor = {
  eventId: string;
  origem: string;
  grupoHash: string; // SHA-256 do grupo exato, sem enviar o nome do grupo.
  message: string; // SOMENTE códigos, separados por espaço; sem conteúdo bruto.
};

export function validarEventoMonitor(body: unknown):
  | { ok: true; evento: EventoMonitor; codigos: string[] }
  | { ok: false; erro: string } {
  if (!body || typeof body !== "object") return { ok: false, erro: "Evento inválido." };
  const o = body as Partial<EventoMonitor>;
  if (typeof o.eventId !== "string" || !/^[a-f0-9]{64}$/i.test(o.eventId)) return { ok: false, erro: "ID do evento inválido." };
  if (!PACOTES_WHATSAPP.includes(o.origem as (typeof PACOTES_WHATSAPP)[number])) return { ok: false, erro: "Origem não permitida." };
  // Defesa adicional: o Android só captura a conversa escolhida. O grupo é
  // público, portanto isto valida o escopo, não substitui a autenticação do
  // aparelho nem prova criptograficamente a origem da notificação.
  if (typeof o.grupoHash !== "string" || !/^[a-f0-9]{64}$/i.test(o.grupoHash) ||
      o.grupoHash.toLowerCase() !== HASH_GRUPO_MONITORADO) {
    return { ok: false, erro: "Grupo monitorado não autorizado." };
  }
  if (typeof o.message !== "string" || !o.message.trim() || o.message.length > 180) {
    return { ok: false, erro: "Envie somente os códigos encontrados, sem texto da conversa." };
  }
  const palavras = o.message.trim().split(/\s+/);
  if (palavras.length > MAX_CODIGOS_EVENTO || palavras.some((p) => !normalizarCodigo(p))) {
    return { ok: false, erro: "Não envie mensagens brutas. Envie apenas os códigos A/B/M." };
  }
  const codigos = extrairCodigos(o.message, MAX_CODIGOS_EVENTO);
  if (!codigos.length) return { ok: false, erro: "Nenhum código reconhecido." };
  return {
    ok: true,
    evento: { eventId: o.eventId, origem: o.origem!, grupoHash: HASH_GRUPO_MONITORADO, message: o.message },
    codigos,
  };
}

type Enviar = typeof enviarCodigoFCM;

type MonitorAutenticado = typeof monitorDevices.$inferSelect;

/**
 * Idempotência por (monitor, eventId) no PostgreSQL. O mesmo código em um
 * evento só gera uma entrega por aparelho receptor. Nenhuma mensagem bruta,
 * nome, remetente ou telefone é armazenado.
 */
export async function processarEventoMonitor(
  device: MonitorAutenticado,
  entrada: { eventId: string; origem: string; codigos: string[] },
  enviar: Enviar = enviarCodigoFCM,
) {
  // Metadados por no máximo sete dias após o último evento recebido;
  // primeiro os resultados para respeitar a FK de monitor_messages.
  await db.delete(monitorDeliveries).where(lt(monitorDeliveries.criadoEm, sql`now() - interval '7 days'`));
  await db.delete(monitorMessages).where(lt(monitorMessages.criadoEm, sql`now() - interval '7 days'`));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(monitorMessages)
    .where(and(eq(monitorMessages.monitorDeviceId, device.id), gt(monitorMessages.criadoEm, sql`now() - interval '1 minute'`)));
  if ((n ?? 0) >= LIMITE_EVENTOS_MINUTO) return { limite: true, duplicada: false, correspondencias: 0, aceitas: 0, falhas: 0 };

  const [nova] = await db.insert(monitorMessages).values({
    monitorDeviceId: device.id, eventId: entrada.eventId, origem: entrada.origem, codigos: entrada.codigos,
  }).onConflictDoNothing().returning({ id: monitorMessages.id });
  if (!nova) return { limite: false, duplicada: true, correspondencias: 0, aceitas: 0, falhas: 0 };

  const matching = await db.select({ codigo: monitorCodes.codigo, motoristaId: monitorCodes.motoristaId })
    .from(monitorCodes)
    .where(and(inArray(monitorCodes.codigo, entrada.codigos), eq(monitorCodes.ativo, 1)));
  const donos = [...new Set(matching.map((m) => m.motoristaId))];
  const aparelhos = donos.length
    ? await db.select({ id: monitorDevices.id, motoristaId: monitorDevices.motoristaId, fcmToken: monitorDevices.fcmToken })
      .from(monitorDevices)
      .where(and(
        eq(monitorDevices.tipo, "RECEIVER"), eq(monitorDevices.ativo, 1),
        isNotNull(monitorDevices.fcmToken), inArray(monitorDevices.motoristaId, donos),
      ))
    : [];

  const destinos = matching.flatMap((m) => aparelhos.filter((a) => a.motoristaId === m.motoristaId)
    .map((aparelho) => ({ ...aparelho, codigo: m.codigo, motoristaId: m.motoristaId })));
  let aceitas = 0;
  let falhas = 0;
  // Não inicia centenas de requests de uma vez num Function da Vercel.
  for (let i = 0; i < destinos.length; i += 10) {
    await Promise.all(destinos.slice(i, i + 10).map(async (destino) => {
      const [claim] = await db.insert(monitorDeliveries).values({
        messageId: nova.id, motoristaId: destino.motoristaId, deviceId: destino.id, codigo: destino.codigo,
      }).onConflictDoNothing().returning({ id: monitorDeliveries.id });
      if (!claim) return;
      try {
        await enviar(destino.fcmToken!, destino.codigo, entrada.eventId);
        aceitas++;
        await db.update(monitorDeliveries).set({ status: "ACCEPTED", atualizadoEm: new Date() })
          .where(eq(monitorDeliveries.id, claim.id));
      } catch (e) {
        falhas++;
        await db.update(monitorDeliveries).set({ status: "FAILED", atualizadoEm: new Date() })
          .where(eq(monitorDeliveries.id, claim.id));
        // Só desativa quando o Firebase confirma que o token FCM expirou.
        const code = (e as { code?: string })?.code ?? "";
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
          await db.update(monitorDevices).set({ ativo: 0, fcmToken: null }).where(eq(monitorDevices.id, destino.id));
        }
      }
    }));
  }
  await db.update(monitorDevices).set({ ultimoContatoEm: new Date() }).where(eq(monitorDevices.id, device.id));
  return { limite: false, duplicada: false, correspondencias: matching.length, aceitas, falhas };
}

/** Resumo do painel admin sem texto ou remetentes. */
export async function resumoMonitor() {
  const [devices, codes, messages, deliveries] = await Promise.all([
    db.select({ id: monitorDevices.id, tipo: monitorDevices.tipo, motoristaId: monitorDevices.motoristaId,
      nome: monitorDevices.nome, ativo: monitorDevices.ativo, ultimoContatoEm: monitorDevices.ultimoContatoEm })
      .from(monitorDevices).orderBy(desc(monitorDevices.id)).limit(100),
    db.select({ n: sql<number>`count(*)::int` }).from(monitorCodes).where(eq(monitorCodes.ativo, 1)),
    db.select({ id: monitorMessages.id, codigos: monitorMessages.codigos, criadoEm: monitorMessages.criadoEm })
      .from(monitorMessages).orderBy(desc(monitorMessages.id)).limit(25),
    db.select({ messageId: monitorDeliveries.messageId, status: monitorDeliveries.status })
      .from(monitorDeliveries).orderBy(desc(monitorDeliveries.id)).limit(300),
  ]);
  return {
    devices: devices.map((d) => ({ ...d, ultimoContatoEm: d.ultimoContatoEm?.toISOString() ?? null })),
    codigoCount: codes[0]?.n ?? 0,
    receptorCount: devices.filter((d) => d.tipo === "RECEIVER" && d.ativo).length,
    monitorCount: devices.filter((d) => d.tipo === "MONITOR" && d.ativo).length,
    eventos: messages.map((m) => ({ id: m.id, codigos: m.codigos, criadoEm: m.criadoEm.toISOString(),
      aceitas: deliveries.filter((d) => d.messageId === m.id && d.status === "ACCEPTED").length,
      falhas: deliveries.filter((d) => d.messageId === m.id && d.status === "FAILED").length })),
  };
}
