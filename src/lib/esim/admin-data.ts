import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  esimApiErrors,
  esimOrders,
  esimPayments,
  esimPlans,
  esims,
  esimUsage,
  esimUsers,
  esimWebhookEvents,
  motoristas,
} from "@/db/schema";
import { nexaSettingsStatus } from "@/lib/esim/nexaesim";
import { obterMargemPercentual } from "@/lib/esim/catalog";

export async function painelEsimAdmin() {
  const [marginPercent, plans, orderRows, esimRows, customers, drivers, usageRows, events, errors, totals] = await Promise.all([
    obterMargemPercentual(),
    db.select().from(esimPlans).orderBy(esimPlans.providerProductName, esimPlans.name),
    db.select({ order: esimOrders, payment: esimPayments, plan: esimPlans, user: esimUsers })
      .from(esimOrders)
      .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
      .innerJoin(esimPlans, eq(esimPlans.id, esimOrders.planId))
      .innerJoin(esimUsers, eq(esimUsers.id, esimOrders.userId))
      .orderBy(desc(esimOrders.id)).limit(100),
    db.select({ esim: esims, plan: esimPlans, user: esimUsers, order: esimOrders })
      .from(esims)
      .innerJoin(esimPlans, eq(esimPlans.id, esims.planId))
      .innerJoin(esimUsers, eq(esimUsers.id, esims.userId))
      .innerJoin(esimOrders, eq(esimOrders.id, esims.orderId))
      .orderBy(desc(esims.id)).limit(100),
    db.select({ user: esimUsers, orders: sql<number>`count(${esimOrders.id})::int` })
      .from(esimUsers)
      .leftJoin(esimOrders, eq(esimOrders.userId, esimUsers.id))
      .groupBy(esimUsers.id)
      .orderBy(desc(esimUsers.id)).limit(100),
    db.select({ id: motoristas.id, name: motoristas.nome }).from(motoristas).orderBy(motoristas.nome).limit(500),
    db.select().from(esimUsage).orderBy(desc(esimUsage.id)).limit(200),
    db.select().from(esimWebhookEvents).orderBy(desc(esimWebhookEvents.id)).limit(50),
    db.select().from(esimApiErrors).orderBy(desc(esimApiErrors.id)).limit(30),
    db.select({
      plans: sql<number>`(SELECT count(*)::int FROM esim_plans)`,
      orders: sql<number>`(SELECT count(*)::int FROM esim_orders)`,
      payments: sql<number>`(SELECT count(*)::int FROM esim_payments WHERE status = 'PAID')`,
      esims: sql<number>`(SELECT count(*)::int FROM esims)`,
      webhooks: sql<number>`(SELECT count(*)::int FROM esim_webhook_events)`,
    }).from(esimPlans).limit(1),
  ]);

  const latestUsage = new Map<number, (typeof usageRows)[number]>();
  for (const row of usageRows) if (!latestUsage.has(row.esimId)) latestUsage.set(row.esimId, row);

  return {
    provider: nexaSettingsStatus(),
    // A shared callback secret alone is not an installed/verified payment-gateway adapter.
    paymentGatewayConfigured: false,
    marginPercent,
    totals: totals[0] ?? { plans: 0, orders: 0, payments: 0, esims: 0, webhooks: 0 },
    plans: plans.map((plan) => ({
      id: plan.id,
      providerPackageId: plan.providerPackageId,
      productName: plan.providerProductName,
      productCode: plan.providerProductCode,
      name: plan.name,
      code: plan.code,
      wholesalePrice: plan.wholesalePrice,
      retailReferencePrice: plan.retailReferencePrice,
      currency: plan.currency,
      dataAmount: plan.dataAmount,
      dataUnit: plan.dataUnit,
      durationDays: plan.durationDays,
      source: plan.source,
      available: plan.available,
      active: plan.active,
      syncedAt: plan.syncedAt?.toISOString() ?? null,
    })),
    customers: customers.map(({ user, orders }) => ({
      id: user.id,
      motoristaId: user.motoristaId,
      name: user.nome,
      email: user.email,
      orders,
      createdAt: user.criadoEm.toISOString(),
    })),
    eligibleCustomers: drivers.map((driver) => ({ id: driver.id, name: driver.name })),
    orders: orderRows.map(({ order, payment, plan, user }) => ({
      id: order.id,
      userId: user.id,
      customerName: user.nome,
      customerEmail: user.email,
      planId: plan.id,
      planName: plan.name,
      status: order.status,
      providerOrderCode: order.providerOrderCode,
      providerStatusCode: order.providerStatusCode,
      amount: order.amount,
      costAmount: order.costAmount,
      currency: order.currency,
      paymentStatus: payment.status,
      paymentMethod: payment.method,
      gateway: payment.gateway,
      createdAt: order.criadoEm.toISOString(),
      updatedAt: order.atualizadoEm.toISOString(),
    })),
    esims: esimRows.map(({ esim, plan, user, order }) => {
      const usage = latestUsage.get(esim.id);
      return {
        id: esim.id,
        userId: user.id,
        customerName: user.nome,
        planName: plan.name,
        orderId: order.id,
        iccid: esim.iccid,
        status: esim.status,
        providerStatus: esim.providerStatus,
        source: esim.source,
        totalDataAmount: esim.totalDataAmount ?? plan.dataAmount,
        totalDataUnit: esim.totalDataUnit ?? plan.dataUnit,
        usedAmount: usage?.usedAmount ?? null,
        remainingAmount: usage?.remainingAmount ?? null,
        usageUnit: usage?.dataUnit ?? null,
        usageStatus: usage?.status ?? null,
        usageNote: usage?.note ?? null,
        usageCheckedAt: usage?.consultadoEm.toISOString() ?? null,
        expiresAt: esim.expiresAt?.toISOString() ?? null,
        createdAt: esim.criadoEm.toISOString(),
        hasInstallationData: Boolean(esim.qrCode || esim.qrUrl || esim.installationUrl),
      };
    }),
    webhookEvents: events.map((event) => ({
      id: event.id,
      provider: event.provider,
      eventType: event.eventType,
      providerOrderCode: event.providerOrderCode,
      status: event.status,
      result: event.result,
      receivedAt: event.receivedAt.toISOString(),
      processedAt: event.processedAt?.toISOString() ?? null,
      pendingPayload: undefined,
    })),
    apiErrors: errors.map((error) => ({
      id: error.id,
      requestId: error.requestId,
      operation: error.operation,
      httpStatus: error.httpStatus,
      providerErrorCode: error.providerErrorCode,
      message: error.message,
      createdAt: error.criadoEm.toISOString(),
    })),
  };
}
