import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { esimOrders, esimPayments, esimWebhookEvents } from "@/db/schema";
import { provisionarPedidoPago, EsimServiceError } from "@/lib/esim/orders";
import { registrarErroEsim } from "@/lib/esim/observability";
import { sha256Hex } from "@/lib/esim/nexaesim";

export type EventoGateway = {
  eventId: string;
  orderId: number;
  paymentId: string;
  status: "paid" | "failed" | "cancelled" | "refunded";
  amount: string | number;
  currency: string;
  method?: "pix" | "card";
};

function quantiaCentavos(value: string | number) {
  const raw = String(value).trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

function normalizarEvento(value: unknown): EventoGateway | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.eventId !== "string" || row.eventId.length < 1 || row.eventId.length > 200) return null;
  const orderId = Number(row.orderId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
  if (typeof row.paymentId !== "string" || row.paymentId.length < 1 || row.paymentId.length > 200) return null;
  if (!["paid", "failed", "cancelled", "refunded"].includes(String(row.status))) return null;
  if (typeof row.currency !== "string" || !/^[A-Za-z]{3}$/.test(row.currency)) return null;
  const amount = quantiaCentavos(row.amount as string | number);
  if (amount == null) return null;
  const method = row.method === "pix" || row.method === "card" ? row.method : undefined;
  return {
    eventId: row.eventId,
    orderId,
    paymentId: row.paymentId,
    status: row.status as EventoGateway["status"],
    amount: String(row.amount),
    currency: row.currency.toUpperCase(),
    method,
  };
}

/**
 * Canonical payment-gateway adapter contract for CopaLinks. The current app has
 * no payment vendor installed, so a vendor adapter must normalize its signed
 * callback to these fields before enabling production checkout.
 */
export async function processarEventoPagamento(rawBody: string, rawEvent: unknown) {
  const event = normalizarEvento(rawEvent);
  if (!event) throw new EsimServiceError("Evento de pagamento inválido.");
  const amount = quantiaCentavos(event.amount);
  const eventHash = sha256Hex(rawBody);

  const outcome = await db.transaction(async (tx) => {
    const [knownId] = await tx.select().from(esimWebhookEvents).where(and(
      eq(esimWebhookEvents.provider, "payment-gateway"),
      eq(esimWebhookEvents.providerEventId, event.eventId),
    )).limit(1);
    if (knownId) {
      return { duplicate: true, paid: false, orderId: event.orderId };
    }

    await tx.execute(sql`SELECT id FROM esim_orders WHERE id = ${event.orderId} FOR UPDATE`);
    const [row] = await tx.select({ order: esimOrders, payment: esimPayments })
      .from(esimOrders)
      .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
      .where(eq(esimOrders.id, event.orderId))
      .limit(1);
    if (!row) throw new EsimServiceError("Pedido de pagamento não encontrado.", 404);
    const expectedPayment = quantiaCentavos(row.payment.amount);
    const expectedOrder = quantiaCentavos(row.order.amount);
    if (
      expectedPayment == null || expectedOrder == null || amount !== expectedPayment || expectedPayment !== expectedOrder ||
      row.payment.currency !== event.currency || row.order.currency !== event.currency
    ) {
      throw new EsimServiceError("Valor ou moeda do pagamento não correspondem ao pedido.", 409);
    }
    if (row.payment.gatewayPaymentId && row.payment.gatewayPaymentId !== event.paymentId) {
      throw new EsimServiceError("O pagamento já está vinculado a outra referência do gateway.", 409);
    }

    const [receipt] = await tx.insert(esimWebhookEvents).values({
      provider: "payment-gateway",
      eventHash,
      providerEventId: event.eventId,
      eventType: event.status,
      status: "RECEIVED",
    }).onConflictDoNothing().returning();
    if (!receipt) return { duplicate: true, paid: false, orderId: event.orderId };

    const now = new Date();
    let paymentStatus = row.payment.status;
    let orderStatus = row.order.status;
    if (event.status === "paid") {
      if (row.payment.status !== "REFUNDED") {
        paymentStatus = "PAID";
        // A distinct/replayed capture event must not roll a provisioned order back to PAID.
        orderStatus = row.payment.status === "PAID" ? row.order.status : "PAID";
      }
    } else if (event.status === "refunded") {
      paymentStatus = "REFUNDED";
      orderStatus = "REFUNDED";
    } else if (row.payment.status !== "PAID" && row.payment.status !== "REFUNDED") {
      paymentStatus = event.status === "cancelled" ? "CANCELLED" : "FAILED";
      orderStatus = event.status === "cancelled" ? "CANCELLED" : "PAYMENT_FAILED";
    }

    await tx.update(esimPayments).set({
      gateway: "normalized-contract-no-vendor-adapter",
      gatewayPaymentId: event.paymentId,
      method: event.method ?? row.payment.method,
      status: paymentStatus,
      atualizadoEm: now,
    }).where(eq(esimPayments.id, row.payment.id));
    await tx.update(esimOrders).set({ status: orderStatus, atualizadoEm: now }).where(eq(esimOrders.id, row.order.id));
    await tx.update(esimWebhookEvents).set({
      status: "PROCESSED",
      result: `payment_${event.status}`,
      processedAt: now,
    }).where(eq(esimWebhookEvents.id, receipt.id));
    return { duplicate: false, paid: paymentStatus === "PAID", orderId: event.orderId };
  });

  if (outcome.paid && !outcome.duplicate) {
    // Payment is already durably confirmed. A provider failure leaves a safe,
    // paid order for admin retry using the same Nexa idempotency key.
    try {
      await provisionarPedidoPago(outcome.orderId);
    } catch (error) {
      await registrarErroEsim(error, "order/create");
      await db.update(esimOrders).set({
        status: "PROVISIONING_FAILED",
        errorCode: "provisioning_blocked",
        atualizadoEm: new Date(),
      }).where(and(eq(esimOrders.id, outcome.orderId), eq(esimOrders.status, "PAID")));
      // The signed payment event is already persisted, so this safe response
      // prevents gateway retries from initiating another charge.
    }
  }
  return { accepted: true, duplicate: outcome.duplicate };
}
