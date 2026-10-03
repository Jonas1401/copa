import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { esimApiErrors } from "@/db/schema";
import { NexaApiError, type NexaOperation } from "@/lib/esim/nexaesim";

/** Persist only sanitized metadata. Never pass provider bodies, headers or eSIM delivery data here. */
export async function registrarErroEsim(error: unknown, fallbackOperation: string) {
  const requestId = error instanceof NexaApiError ? error.requestId : randomUUID();
  const operation = error instanceof NexaApiError ? error.operation : fallbackOperation;
  const httpStatus = error instanceof NexaApiError ? error.httpStatus : null;
  const providerErrorCode = error instanceof NexaApiError ? error.providerErrorCode : null;
  const message = error instanceof NexaApiError
    ? error.message
    : "Falha interna na integração eSIM. Detalhes técnicos não foram registrados.";
  await db.insert(esimApiErrors).values({
    requestId,
    operation: operation.slice(0, 80),
    httpStatus,
    providerErrorCode: providerErrorCode == null ? null : String(providerErrorCode),
    message: message.slice(0, 260),
  });
  return { requestId, message };
}

export function nomeOperacaoNexa(operation: NexaOperation) {
  const nomes: Record<NexaOperation, string> = {
    catalog: "package/load",
    coverage: "package/coverage",
    createOrder: "order/create",
    queryOrder: "order/query",
    loadEsims: "sim-info/load",
    queryUsage: "sim-info/query-info",
  };
  return nomes[operation];
}

export async function ultimosErrosEsim() {
  return db.select().from(esimApiErrors).orderBy(desc(esimApiErrors.id)).limit(30);
}
