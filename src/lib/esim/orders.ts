import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { esims, esimOrders, esimPayments, esimPlans, esimUsage, esimUsers, motoristas } from "@/db/schema";
import { calcularPrecoCliente, obterMargemPercentual } from "@/lib/esim/catalog";
import { chamarNexa, extrairLista, extrairObjeto, extrairString, nexaeMode, nexaSettingsStatus, sitePublicoBase, statusPedidoNexa } from "@/lib/esim/nexaesim";
import { registrarErroEsim } from "@/lib/esim/observability";
import { sha256Hex } from "@/lib/esim/nexaesim";
import { processarWebhooksNexaPendentes } from "@/lib/esim/webhooks";
import { reconciliarStatusNexa } from "@/lib/esim/order-status";

export class EsimServiceError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
    this.name = "EsimServiceError";
  }
}

const ID_KEY = /^[A-Za-z0-9._:-]{12,100}$/;
const estadosNaoFinais = ["PAID", "PROVISIONING_FAILED", "PROVISIONING_UNCERTAIN"];

async function usuarioParaMotorista(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], motoristaId: number) {
  const [driver] = await tx.select().from(motoristas).where(eq(motoristas.id, motoristaId)).limit(1);
  if (!driver) throw new EsimServiceError("Cliente CopaLinks não encontrado.", 404);
  const [user] = await tx.insert(esimUsers)
    .values({ motoristaId: driver.id, nome: driver.nome })
    .onConflictDoUpdate({ target: esimUsers.motoristaId, set: { nome: driver.nome } })
    .returning();
  return user;
}

export async function criarPedidoTeste(input: { planId: number; motoristaId: number; idempotencyKey: string }) {
  if (nexaeMode() !== "TEST") throw new EsimServiceError("Pedidos de demonstração só podem ser criados em modo TESTE.", 409);
  if (!Number.isSafeInteger(input.planId) || !Number.isSafeInteger(input.motoristaId) || !ID_KEY.test(input.idempotencyKey)) {
    throw new EsimServiceError("Dados do pedido inválidos.");
  }
  const margem = await obterMargemPercentual();
  const found = await db.select({ order: esimOrders, user: esimUsers }).from(esimOrders)
    .innerJoin(esimUsers, eq(esimUsers.id, esimOrders.userId))
    .where(eq(esimOrders.idempotencyKey, input.idempotencyKey)).limit(1);
  if (found[0]) {
    if (found[0].order.planId !== input.planId || found[0].user.motoristaId !== input.motoristaId) {
      throw new EsimServiceError("Chave de idempotência já usada em outro pedido.", 409);
    }
    return { order: found[0].order, duplicate: true };
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [plan] = await tx.select().from(esimPlans).where(and(
        eq(esimPlans.id, input.planId),
        eq(esimPlans.active, true),
        eq(esimPlans.available, true),
        eq(esimPlans.source, "test-fixture"),
      )).limit(1);
      if (!plan) throw new EsimServiceError("Selecione um plano de demonstração ativo.", 409);
      const user = await usuarioParaMotorista(tx, input.motoristaId);
      const amount = calcularPrecoCliente(plan.wholesalePrice, margem);
      const [order] = await tx.insert(esimOrders).values({
        userId: user.id,
        planId: plan.id,
        status: "AWAITING_PAYMENT",
        currency: plan.currency,
        costAmount: plan.wholesalePrice,
        amount,
        idempotencyKey: input.idempotencyKey,
      }).returning();
      await tx.insert(esimPayments).values({
        orderId: order.id,
        gateway: "test-simulation",
        status: "PENDING",
        amount,
        currency: plan.currency,
        idempotencyKey: `payment:${input.idempotencyKey}`,
      });
      return order;
    });
    return { order: created, duplicate: false };
  } catch (error) {
    if (error instanceof EsimServiceError) throw error;
    const retry = await db.select({ order: esimOrders, user: esimUsers }).from(esimOrders)
      .innerJoin(esimUsers, eq(esimUsers.id, esimOrders.userId))
      .where(eq(esimOrders.idempotencyKey, input.idempotencyKey)).limit(1);
    if (retry[0] && retry[0].order.planId === input.planId && retry[0].user.motoristaId === input.motoristaId) {
      return { order: retry[0].order, duplicate: true };
    }
    throw error;
  }
}

/** Local-only payment simulation. It never creates a real profile or QR code. */
export async function aprovarPagamentoTeste(orderId: number) {
  if (nexaeMode() !== "TEST") throw new EsimServiceError("A simulação de pagamento está bloqueada fora do modo TESTE.", 409);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new EsimServiceError("Pedido inválido.");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM esim_orders WHERE id = ${orderId} FOR UPDATE`);
    const [row] = await tx.select({ order: esimOrders, payment: esimPayments, plan: esimPlans })
      .from(esimOrders)
      .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
      .innerJoin(esimPlans, eq(esimPlans.id, esimOrders.planId))
      .where(eq(esimOrders.id, orderId))
      .limit(1);
    if (!row) throw new EsimServiceError("Pedido não encontrado.", 404);
    if (row.payment.status === "PAID") return { order: row.order, duplicate: true };
    if (row.payment.status !== "PENDING") throw new EsimServiceError("Esse pagamento não pode ser aprovado na simulação.", 409);
    const now = new Date();
    await tx.update(esimPayments).set({ status: "PAID", atualizadoEm: now }).where(eq(esimPayments.id, row.payment.id));
    const [order] = await tx.update(esimOrders).set({ status: "PAID_TEST_SIMULATED", atualizadoEm: now }).where(eq(esimOrders.id, orderId)).returning();
    await tx.insert(esims).values({
      userId: row.order.userId,
      orderId,
      planId: row.plan.id,
      status: "TESTE_NAO_INSTALAVEL",
      providerStatus: "SEM_SANDBOX_PUBLICADO",
      source: "test-fixture",
      totalDataAmount: row.plan.dataAmount,
      totalDataUnit: row.plan.dataUnit,
    }).onConflictDoNothing();
    return { order, duplicate: false };
  });
  return result;
}

function limitarString(value: string | null | undefined, max = 200) {
  return value?.trim().slice(0, max) || null;
}

function lerCodigoPedido(data: unknown) {
  const object = extrairObjeto(data);
  return object ? limitarString(extrairString(object, "orderCode"), 120) : null;
}

function lerStatusPedido(data: unknown) {
  const object = extrairObjeto(data);
  if (!object) return null;
  const raw = object.orderStatus;
  if (typeof raw === "number") return Number.isSafeInteger(raw) ? raw : null;
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return null;
  const status = Number(raw.trim());
  return Number.isSafeInteger(status) ? status : null;
}

async function falhaProvisionamento(orderId: number, error: unknown, operation: string) {
  const registro = await registrarErroEsim(error, operation);
  await db.update(esimOrders).set({
    status: "PROVISIONING_FAILED",
    errorCode: error instanceof Error && error.name === "NexaApiError" ? "nexa_api_error" : "integration_error",
    atualizadoEm: new Date(),
  }).where(and(eq(esimOrders.id, orderId), inArray(esimOrders.status, ["PROVISIONING", "PROVISIONING_UNCERTAIN", "PAID", "PROVISIONING_FAILED"])));
  return { status: "PROVISIONING_FAILED", requestId: registro.requestId, message: registro.message };
}

/**
 * The only production path that can create a Nexa order. It locks the local order,
 * requires a paid gateway payment, and always reuses the persisted idempotency key.
 */
export async function provisionarPedidoPago(orderId: number) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new EsimServiceError("Pedido inválido.");
  if (nexaeMode() !== "PRODUCTION") throw new EsimServiceError("A criação de pedidos Nexa está desativada em TESTE.", 409);
  const callbackBase = sitePublicoBase();
  if (!nexaSettingsStatus().providerReady || !callbackBase) {
    throw new EsimServiceError("A integração de produção não está pronta: configure API Key, URL oficial, segredo de webhook e URL HTTPS pública.", 503);
  }

  const claim = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM esim_orders WHERE id = ${orderId} FOR UPDATE`);
    const [row] = await tx.select({ order: esimOrders, payment: esimPayments, plan: esimPlans })
      .from(esimOrders)
      .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
      .innerJoin(esimPlans, eq(esimPlans.id, esimOrders.planId))
      .where(eq(esimOrders.id, orderId))
      .limit(1);
    if (!row) throw new EsimServiceError("Pedido não encontrado.", 404);
    if (row.payment.status !== "PAID") throw new EsimServiceError("Pedido bloqueado: pagamento ainda não confirmado pelo gateway.", 409);
    if (row.plan.source !== "nexa" || !row.plan.active || !row.plan.available) {
      throw new EsimServiceError("O plano não está ativo/disponível no catálogo NexaEsim.", 409);
    }
    if (row.order.providerOrderCode || ["AGUARDANDO_ESIM", "CONCLUIDO"].includes(row.order.status)) {
      return { action: "already-created" as const, orderCode: row.order.providerOrderCode };
    }
    const provisioningStale = row.order.status === "PROVISIONING" && Date.now() - row.order.atualizadoEm.getTime() > 60_000;
    if (row.order.status === "PROVISIONING" && !provisioningStale) return { action: "in-progress" as const, orderCode: null };
    if (!estadosNaoFinais.includes(row.order.status) && !provisioningStale) {
      throw new EsimServiceError("Esse pedido não está elegível para provisionamento.", 409);
    }
    const packageId = Number(row.plan.providerPackageId);
    if (!Number.isSafeInteger(packageId) || packageId <= 0) {
      throw new EsimServiceError("O ID do plano não pode ser enviado com segurança à NexaEsim.", 409);
    }
    const callbackUrl = row.order.providerCallbackUrl ?? `${callbackBase}/api/esim/webhook`;
    await tx.update(esimOrders).set({
      status: "PROVISIONING",
      providerCallbackUrl: callbackUrl,
      errorCode: null,
      atualizadoEm: new Date(),
    }).where(eq(esimOrders.id, orderId));
    return {
      action: "create" as const,
      packageId,
      idempotencyKey: row.order.idempotencyKey,
      callbackUrl,
      planId: row.plan.id,
      orderId: row.order.id,
      userId: row.order.userId,
    };
  });

  if (claim.action !== "create") {
    if (claim.action === "already-created" && claim.orderCode) {
      await processarWebhooksNexaPendentes(claim.orderCode).catch(() => undefined);
    }
    return { status: claim.action === "in-progress" ? "PROVISIONING" : "ALREADY_CREATED", orderCode: claim.orderCode };
  }

  try {
    const response = await chamarNexa<Record<string, unknown>>(
      "createOrder",
      {
        orderItems: [{ packageId: claim.packageId, quantity: 1 }],
        callbackUrl: claim.callbackUrl,
      },
      { idempotencyKey: claim.idempotencyKey },
    );
    const orderCode = lerCodigoPedido(response.data);
    const providerStatusCode = lerStatusPedido(response.data);
    if (!orderCode) {
      const err = new Error("A resposta válida não continha orderCode documentado.");
      await registrarErroEsim(err, "order/create");
      await db.update(esimOrders).set({
        status: "PROVISIONING_UNCERTAIN",
        errorCode: "provider_order_code_missing",
        atualizadoEm: new Date(),
      }).where(and(eq(esimOrders.id, orderId), eq(esimOrders.status, "PROVISIONING")));
      return { status: "PROVISIONING_UNCERTAIN", message: "A resposta não confirmou um código do pedido. Nova tentativa usará a mesma chave idempotente." };
    }
    const nextStatus = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM esim_orders WHERE id = ${orderId} FOR UPDATE`);
      const [current] = await tx.select({ order: esimOrders, payment: esimPayments })
        .from(esimOrders)
        .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
        .where(eq(esimOrders.id, orderId))
        .limit(1);
      if (!current) throw new EsimServiceError("Pedido desapareceu durante o provisionamento.", 409);
      if (current.order.providerOrderCode && current.order.providerOrderCode !== orderCode) {
        throw new EsimServiceError("A NexaEsim retornou um código diferente para uma chave idempotente já vinculada.", 409);
      }
      const esimRows = await tx.select({ id: esims.id }).from(esims).where(eq(esims.orderId, orderId));
      const merged = reconciliarStatusNexa({
        currentStatus: current.order.status,
        currentProviderStatusCode: current.order.providerStatusCode,
        incomingProviderStatusCode: providerStatusCode,
        hasInstallData: esimRows.length > 0,
      });
      const status = current.payment.status === "REFUNDED" ? "REFUNDED" : merged.status;
      await tx.update(esimOrders).set({
        providerOrderCode: orderCode,
        providerStatusCode: merged.providerStatusCode,
        status,
        errorCode: null,
        atualizadoEm: new Date(),
      }).where(eq(esimOrders.id, orderId));
      return status;
    });
    await processarWebhooksNexaPendentes(orderCode);
    return { status: nextStatus, orderCode };
  } catch (error) {
    return falhaProvisionamento(orderId, error, "order/create");
  }
}

export async function aprovarPagamentoEProvisionar(orderId: number) {
  // Reservado à integração do gateway; confirmação nunca vem de uma chamada do cliente.
  return provisionarPedidoPago(orderId);
}

export async function consultarPedidoNexa(orderId: number) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new EsimServiceError("Pedido inválido.");
  if (nexaeMode() !== "PRODUCTION") throw new EsimServiceError("Consultas externas estão desativadas no modo TESTE.", 409);
  const [row] = await db.select({ order: esimOrders, payment: esimPayments })
    .from(esimOrders)
    .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
    .where(eq(esimOrders.id, orderId))
    .limit(1);
  if (!row) throw new EsimServiceError("Pedido não encontrado.", 404);
  if (row.payment.status !== "PAID") throw new EsimServiceError("Consultas NexaEsim exigem pagamento confirmado e não estornado.", 409);
  if (!row.order.providerOrderCode) throw new EsimServiceError("A NexaEsim ainda não retornou orderCode para este pedido.", 409);
  try {
    const response = await chamarNexa<Record<string, unknown>>("queryOrder", { orderCode: row.order.providerOrderCode });
    const providerStatusCode = lerStatusPedido(response.data);
    if (providerStatusCode != null) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM esim_orders WHERE id = ${orderId} FOR UPDATE`);
        const [current] = await tx.select({ order: esimOrders, payment: esimPayments })
          .from(esimOrders)
          .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
          .where(eq(esimOrders.id, orderId))
          .limit(1);
        if (!current || current.payment.status !== "PAID") return;
        const esimRows = await tx.select({ id: esims.id }).from(esims).where(eq(esims.orderId, orderId));
        const merged = reconciliarStatusNexa({
          currentStatus: current.order.status,
          currentProviderStatusCode: current.order.providerStatusCode,
          incomingProviderStatusCode: providerStatusCode,
          hasInstallData: esimRows.length > 0,
        });
        await tx.update(esimOrders).set({
          providerStatusCode: merged.providerStatusCode,
          status: merged.status,
          atualizadoEm: new Date(),
        }).where(eq(esimOrders.id, orderId));
      });
    }
    await processarWebhooksNexaPendentes(row.order.providerOrderCode);
    return { status: providerStatusCode == null ? "CONSULTA_OK_STATUS_NAO_MAPEADO" : statusPedidoNexa(providerStatusCode) };
  } catch (error) {
    const logged = await registrarErroEsim(error, "order/query");
    throw new EsimServiceError(`${logged.message} Referência técnica: ${logged.requestId}.`, 502);
  }
}

export async function consultarConsumoNexa(esimId: number) {
  if (!Number.isSafeInteger(esimId) || esimId <= 0) throw new EsimServiceError("eSIM inválido.");
  const [row] = await db.select({ esim: esims, order: esimOrders, payment: esimPayments })
    .from(esims)
    .innerJoin(esimOrders, eq(esimOrders.id, esims.orderId))
    .innerJoin(esimPayments, eq(esimPayments.orderId, esimOrders.id))
    .where(eq(esims.id, esimId))
    .limit(1);
  if (!row) throw new EsimServiceError("eSIM não encontrado.", 404);
  if (row.payment.status !== "PAID") throw new EsimServiceError("Consulta de consumo exige pagamento confirmado.", 409);
  if (row.esim.source !== "nexa") {
    await db.insert(esimUsage).values({
      esimId,
      status: "TESTE_SEM_CONSULTA",
      note: "Nenhuma chamada externa foi feita no modo de teste.",
    });
    return { status: "TESTE_SEM_CONSULTA", note: "Nenhuma chamada externa foi feita." };
  }
  if (!row.esim.iccid) throw new EsimServiceError("A consulta de consumo exige um ICCID recebido da NexaEsim.", 409);
  if (nexaeMode() !== "PRODUCTION") throw new EsimServiceError("Consulta NexaEsim desativada no modo TESTE.", 409);
  try {
    const response = await chamarNexa<unknown>("queryUsage", { iccid: row.esim.iccid });
    const responseJson = JSON.stringify(response.data);
    const payloadHash = sha256Hex(responseJson);
    await db.insert(esimUsage).values({
      esimId,
      providerPayloadHash: payloadHash,
      status: "RESPOSTA_RECEBIDA_SEM_SCHEMA_PUBLICADO",
      note: "A documentação pública lista sim-info/query-info, mas não define os campos de consumo da resposta; nenhum valor de GB foi inferido ou exposto.",
    });
    // The provider response is deliberately neither logged, persisted, nor sent to the browser.
    return {
      status: "RESPOSTA_RECEBIDA_SEM_SCHEMA_PUBLICADO",
      note: "Resposta recebida com segurança. O schema público de consumo precisa ser confirmado com a NexaEsim antes de mapear GB.",
      requestId: response.requestId,
    };
  } catch (error) {
    const logged = await registrarErroEsim(error, "sim-info/query-info");
    await db.insert(esimUsage).values({ esimId, status: "ERRO", note: `Consulta falhou. Referência técnica: ${logged.requestId}.` });
    throw new EsimServiceError(`${logged.message} Referência técnica: ${logged.requestId}.`, 502);
  }
}

export async function consultarEsimsNexa(email: string, orderCode: string) {
  if (nexaeMode() !== "PRODUCTION") throw new EsimServiceError("Consultas externas estão desativadas no modo TESTE.", 409);
  if (!email.trim() || !orderCode.trim()) throw new EsimServiceError("E-mail e código do pedido são necessários.");
  try {
    const result = await chamarNexa<unknown>("loadEsims", { email: email.trim(), orderCode: orderCode.trim() });
    // A resposta de /sim-info/load não tem um schema de entrega publicado; guardamos apenas o hash.
    const hash = sha256Hex(JSON.stringify(result.data));
    return { status: "RESPOSTA_RECEBIDA_SEM_SCHEMA_PUBLICADO", payloadHash: hash, requestId: result.requestId };
  } catch (error) {
    const logged = await registrarErroEsim(error, "sim-info/load");
    throw new EsimServiceError(`${logged.message} Referência técnica: ${logged.requestId}.`, 502);
  }
}

export async function carregarSimInfosDoCallback(callback: Record<string, unknown>) {
  const records = extrairLista(callback.simInfos) ?? [];
  return records.map((value) => extrairObjeto(value)).filter((value): value is Record<string, unknown> => Boolean(value));
}
