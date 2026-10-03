import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { esims, esimOrders, esimPayments, esimPlans, esimWebhookEvents } from "@/db/schema";
import { extrairLista, extrairObjeto, extrairString, statusPedidoNexa } from "@/lib/esim/nexaesim";
import { sha256Hex } from "@/lib/esim/nexaesim";
import { reconciliarStatusNexa } from "@/lib/esim/order-status";

function parseData(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function urlHttps(value: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString().slice(0, 2_000) : null;
  } catch {
    return null;
  }
}

function codigoStatusOrder(orderStatus: unknown) {
  if (typeof orderStatus === "number") return Number.isSafeInteger(orderStatus) ? orderStatus : null;
  if (typeof orderStatus !== "string" || !/^\d+$/.test(orderStatus.trim())) return null;
  const status = Number(orderStatus.trim());
  return Number.isSafeInteger(status) ? status : null;
}

function registrosSim(body: Record<string, unknown>) {
  const list = extrairLista(body.simInfos) ?? [];
  return list.map((item) => extrairObjeto(item)).filter((item): item is Record<string, unknown> => Boolean(item));
}

async function aplicarEvento(eventId: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM esim_webhook_events WHERE id = ${eventId} FOR UPDATE`);
    const [event] = await tx.select().from(esimWebhookEvents).where(eq(esimWebhookEvents.id, eventId)).limit(1);
    if (!event) return { status: "NOT_FOUND" as const };
    if (event.status === "PROCESSADO") return { status: "DUPLICATE" as const };
    const body = extrairObjeto(event.pendingPayload);
    if (!body) return { status: "PENDING" as const };
    const orderCode = extrairString(body, "orderCode");
    if (!orderCode) {
      await tx.update(esimWebhookEvents).set({ status: "ERRO", result: "callback_sem_orderCode", pendingPayload: null }).where(eq(esimWebhookEvents.id, event.id));
      return { status: "INVALID" as const };
    }

    const [orderRef] = await tx.select({ id: esimOrders.id }).from(esimOrders)
      .where(eq(esimOrders.providerOrderCode, orderCode)).limit(1);
    if (!orderRef) {
      await tx.update(esimWebhookEvents).set({
        providerOrderCode: orderCode,
        eventType: "order_callback",
        status: "PENDENTE_PEDIDO",
        result: "orderCode_ainda_nao_vinculado",
      }).where(eq(esimWebhookEvents.id, event.id));
      return { status: "PENDING" as const };
    }

    // Lock before reading payment/order state so gateway callbacks and provider callbacks
    // serialize around the same paid, user-bound order.
    await tx.execute(sql`SELECT id FROM esim_orders WHERE id = ${orderRef.id} FOR UPDATE`);
    const [row] = await tx.select({ order: esimOrders, payment: esimPayments, plan: esimPlans })
      .from(esimOrders)
      .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
      .innerJoin(esimPlans, eq(esimPlans.id, esimOrders.planId))
      .where(eq(esimOrders.id, orderRef.id))
      .limit(1);
    if (!row) return { status: "PENDING" as const };
    if (row.payment.status !== "PAID") {
      await tx.update(esimWebhookEvents).set({
        providerOrderCode: orderCode,
        eventType: "order_callback",
        status: "PENDENTE_PAGAMENTO",
        result: "entrega_bloqueada_ate_confirmacao_do_gateway",
      }).where(eq(esimWebhookEvents.id, event.id));
      return { status: "PENDING" as const };
    }
    const infos = registrosSim(body);
    const now = new Date();
    for (const info of infos) {
      const iccid = extrairString(info, "iccid");
      if (!iccid || iccid.length > 100) continue;
      const [existing] = await tx.select().from(esims).where(eq(esims.iccid, iccid)).limit(1);
      if (existing && (existing.orderId !== row.order.id || existing.userId !== row.order.userId)) {
        throw new Error("ICCID já vinculado a outra compra; nenhuma associação foi alterada.");
      }
      const providerStatus = info.status == null ? null : String(info.status).slice(0, 80);
      const qrCode = extrairString(info, "qrCode");
      const qrUrl = urlHttps(extrairString(info, "qrUrl"));
      const installationUrl = urlHttps(extrairString(info, "installationUrl"));
      const ready = Number(body.orderStatus) === 6 && Boolean(qrCode || qrUrl || installationUrl);
      const packageId = extrairString(info, "packageId");
      const selectedPlan = packageId
        ? (await tx.select().from(esimPlans).where(eq(esimPlans.providerPackageId, packageId)).limit(1))[0] ?? row.plan
        : row.plan;
      const values = {
        userId: row.order.userId,
        orderId: row.order.id,
        planId: selectedPlan.id,
        iccid,
        status: ready || existing?.status === "DISPONIVEL" ? "DISPONIVEL" : "AGUARDANDO_DADOS_DE_INSTALACAO",
        providerStatus: providerStatus ?? existing?.providerStatus ?? null,
        qrCode: qrCode?.slice(0, 12_000) ?? existing?.qrCode ?? null,
        qrUrl: qrUrl?.slice(0, 2_000) ?? existing?.qrUrl ?? null,
        activationCode: extrairString(info, "activationCode")?.slice(0, 2_000) ?? existing?.activationCode ?? null,
        installationUrl: installationUrl?.slice(0, 2_000) ?? existing?.installationUrl ?? null,
        smDp: extrairString(info, "smDp")?.slice(0, 500) ?? existing?.smDp ?? null,
        expiresAt: parseData(extrairString(info, "expiredTime")) ?? existing?.expiresAt ?? null,
        totalDataAmount: selectedPlan.dataAmount,
        totalDataUnit: selectedPlan.dataUnit,
        source: "nexa",
        atualizadoEm: now,
      };
      if (existing) {
        await tx.update(esims).set(values).where(eq(esims.id, existing.id));
      } else {
        await tx.insert(esims).values(values);
      }
    }

    const providerStatusCode = codigoStatusOrder(body.orderStatus);
    const esimRows = await tx.select({ id: esims.id }).from(esims).where(eq(esims.orderId, row.order.id));
    const hasInstallData = esimRows.length > 0;
    const mergedStatus = reconciliarStatusNexa({
      currentStatus: row.order.status,
      currentProviderStatusCode: row.order.providerStatusCode,
      incomingProviderStatusCode: providerStatusCode,
      hasInstallData,
    });
    await tx.update(esimOrders).set({
      status: mergedStatus.status,
      providerStatusCode: mergedStatus.providerStatusCode,
      errorCode: null,
      atualizadoEm: now,
    }).where(eq(esimOrders.id, row.order.id));
    await tx.update(esimWebhookEvents).set({
      providerOrderCode: orderCode,
      eventType: "order_callback",
      status: "PROCESSADO",
      result: `status_${providerStatusCode ?? "desconhecido"};_esims_${infos.length}`,
      pendingPayload: null,
      processedAt: now,
    }).where(eq(esimWebhookEvents.id, event.id));
    return { status: "PROCESSED" as const };
  });
}

/** Called only after the request signature has been verified against the exact raw body. */
export async function receberWebhookNexa(rawBody: string, body: unknown) {
  const record = extrairObjeto(body);
  if (!record) return { status: "INVALID" as const };
  const orderCode = extrairString(record, "orderCode");
  const hash = sha256Hex(rawBody);
  const [inserted] = await db.insert(esimWebhookEvents).values({
    provider: "nexaesim",
    eventHash: hash,
    providerOrderCode: orderCode,
    eventType: "order_callback",
    status: "RECEBIDO",
    pendingPayload: record,
  }).onConflictDoNothing().returning();
  if (inserted) return aplicarEvento(inserted.id);

  const [existing] = await db.select().from(esimWebhookEvents).where(and(
    eq(esimWebhookEvents.provider, "nexaesim"),
    eq(esimWebhookEvents.eventHash, hash),
  )).limit(1);
  if (!existing) return { status: "PENDING" as const };
  if (existing.status === "PROCESSADO") return { status: "DUPLICATE" as const };
  return aplicarEvento(existing.id);
}

export async function processarWebhooksNexaPendentes(orderCode: string) {
  const rows = await db.select({ id: esimWebhookEvents.id }).from(esimWebhookEvents).where(and(
    eq(esimWebhookEvents.provider, "nexaesim"),
    eq(esimWebhookEvents.providerOrderCode, orderCode),
    inArray(esimWebhookEvents.status, ["PENDENTE_PEDIDO", "PENDENTE_PAGAMENTO", "RECEBIDO"]),
  ));
  const results = [];
  for (const row of rows) results.push(await aplicarEvento(row.id));
  return results;
}
