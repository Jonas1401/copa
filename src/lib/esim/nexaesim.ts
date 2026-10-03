import { createHash, randomUUID } from "node:crypto";

export const NEXAESIM_DOCS = "https://nexaesim.com/partner/api-docs";
export const NEXAESIM_PRODUCTION_API = "https://nexaesim.com/api/partner/v1";

/** These are the only commerce paths currently listed in NexaEsim's official v1 docs. */
export const NEXAESIM_PATHS = {
  catalog: "/package/load",
  coverage: "/package/coverage",
  createOrder: "/order/create",
  queryOrder: "/order/query",
  loadEsims: "/sim-info/load",
  queryUsage: "/sim-info/query-info",
} as const;

export type NexaMode = "TEST" | "PRODUCTION";
export type NexaOperation = keyof typeof NEXAESIM_PATHS;

export class NexaApiError extends Error {
  readonly requestId: string;
  readonly operation: NexaOperation;
  readonly httpStatus: number | null;
  readonly providerErrorCode: number | null;

  constructor(options: {
    requestId: string;
    operation: NexaOperation;
    httpStatus?: number | null;
    providerErrorCode?: number | null;
    message?: string;
  }) {
    super(options.message ?? "A NexaEsim não concluiu a solicitação.");
    this.name = "NexaApiError";
    this.requestId = options.requestId;
    this.operation = options.operation;
    this.httpStatus = options.httpStatus ?? null;
    this.providerErrorCode = typeof options.providerErrorCode === "number" && Number.isFinite(options.providerErrorCode)
      ? options.providerErrorCode
      : null;
  }
}

export type NexaSettingsStatus = {
  mode: NexaMode;
  apiKeyConfigured: boolean;
  apiUrlConfigured: boolean;
  webhookSecretConfigured: boolean;
  providerReady: boolean;
  sandboxDocumented: false;
  docsUrl: string;
};

export function nexaeMode(env: Record<string, string | undefined> = process.env): NexaMode {
  return env.NEXAESIM_MODE?.trim().toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "TEST";
}

function baseUrlIsOfficial(value: string | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim().replace(/\/+$/, ""));
    return parsed.protocol === "https:" && parsed.origin === "https://nexaesim.com" &&
      parsed.pathname.replace(/\/+$/, "") === "/api/partner/v1" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export function nexaSettingsStatus(env: Record<string, string | undefined> = process.env): NexaSettingsStatus {
  const mode = nexaeMode(env);
  const apiKeyConfigured = Boolean(env.NEXAESIM_API_KEY?.trim());
  const apiUrlConfigured = baseUrlIsOfficial(env.NEXAESIM_API_URL);
  const webhookSecretConfigured = Boolean(env.NEXAESIM_WEBHOOK_SECRET?.trim());
  return {
    mode,
    apiKeyConfigured,
    apiUrlConfigured,
    webhookSecretConfigured,
    providerReady: mode === "PRODUCTION" && apiKeyConfigured && apiUrlConfigured && webhookSecretConfigured,
    sandboxDocumented: false,
    docsUrl: NEXAESIM_DOCS,
  };
}

export function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBody(raw: string, requestId: string, operation: NexaOperation, status: number): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value)) return value;
  } catch {
    // Do not keep or surface the body; it can contain credentials or eSIM data.
  }
  throw new NexaApiError({
    requestId,
    operation,
    httpStatus: status,
    message: "Resposta inválida da NexaEsim; o corpo não foi registrado.",
  });
}

/**
 * Calls a documented NexaEsim Commerce API route. TEST is deliberately local-only:
 * the public v1 docs publish no sandbox base URL or sandbox procedure.
 */
export async function chamarNexa<T = Record<string, unknown>>(
  operation: NexaOperation,
  payload: Record<string, unknown>,
  options: { idempotencyKey?: string; fetcher?: typeof fetch } = {},
): Promise<{ data: T; requestId: string; httpStatus: number }> {
  const requestId = randomUUID();
  const status = nexaSettingsStatus();
  if (status.mode !== "PRODUCTION") {
    throw new NexaApiError({
      requestId,
      operation,
      message: "Modo TESTE ativo: nenhuma chamada externa foi feita.",
    });
  }
  if (!status.apiKeyConfigured || !status.apiUrlConfigured) {
    throw new NexaApiError({
      requestId,
      operation,
      message: "Configure NEXAESIM_API_KEY e NEXAESIM_API_URL no ambiente do backend.",
    });
  }

  const apiKey = process.env.NEXAESIM_API_KEY!.trim();
  const baseUrl = process.env.NEXAESIM_API_URL!.trim().replace(/\/+$/, "");
  const url = `${baseUrl}${NEXAESIM_PATHS[operation]}`;
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "X-API-Key": apiKey,
        ...(options.idempotencyKey ? { "X-Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new NexaApiError({
      requestId,
      operation,
      message: "NexaEsim indisponível ou sem resposta. Use a mesma tentativa idempotente; não gere outro pedido.",
    });
  }

  const responseText = await response.text().catch(() => "");
  const envelope = parseBody(responseText, requestId, operation, response.status);
  const providerCode = envelope.errorCode;
  if (!response.ok || (providerCode !== undefined && providerCode !== 0)) {
    throw new NexaApiError({
      requestId,
      operation,
      httpStatus: response.status,
      // The public contract documents an integer code; never surface arbitrary error text that could echo a credential.
      providerErrorCode: typeof providerCode === "number" && Number.isFinite(providerCode) ? providerCode : null,
      message: "NexaEsim recusou ou não concluiu a solicitação. Consulte o painel de erros do administrador.",
    });
  }
  return {
    data: (envelope.data ?? envelope) as T,
    requestId,
    httpStatus: response.status,
  };
}

export type NexaPlan = {
  packageId: string;
  productId: string | null;
  productCode: string | null;
  productName: string;
  code: string | null;
  name: string;
  wholesalePrice: string;
  retailPrice: string | null;
  currency: string;
  dataAmount: string | null;
  dataUnit: string | null;
  durationDays: number | null;
};

function textField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function decimalField(record: Record<string, unknown>, key: string, optional = false): string | null {
  const value = record[key];
  if (optional && value == null) return null;
  if ((typeof value !== "number" && typeof value !== "string") || !Number.isFinite(Number(value)) || Number(value) < 0) {
    return null;
  }
  return String(value);
}

/** Parses only fields explicitly shown in /package/load's official response example. */
export function mapearCatalogoNexa(data: unknown): NexaPlan[] {
  if (!isRecord(data) || !Array.isArray(data.listPackages)) {
    throw new Error("Formato de catálogo não reconhecido; a resposta não foi registrada.");
  }
  const plans: NexaPlan[] = [];
  for (const groupValue of data.listPackages) {
    if (!isRecord(groupValue)) continue;
    const product = isRecord(groupValue.product) ? groupValue.product : {};
    const productName = textField(product, "name");
    const packages = Array.isArray(groupValue.packages) ? groupValue.packages : [];
    for (const packageValue of packages) {
      if (!isRecord(packageValue)) continue;
      const packageId = textField(packageValue, "id");
      const wholesalePrice = decimalField(packageValue, "wholesalePrice");
      const name = textField(packageValue, "name") ?? textField(packageValue, "code");
      const currency = textField(packageValue, "currency") ?? "USD";
      const numericPackageId = packageId == null ? Number.NaN : Number(packageId);
      if (
        !packageId || !Number.isSafeInteger(numericPackageId) || numericPackageId <= 0 ||
        wholesalePrice == null || !name || !productName || !/^[A-Za-z]{3}$/.test(currency)
      ) continue;
      const duration = decimalField(packageValue, "duration", true);
      const durationDays = duration == null ? null : Number(duration);
      plans.push({
        packageId,
        productId: textField(product, "id"),
        productCode: textField(product, "code"),
        productName,
        code: textField(packageValue, "code"),
        name,
        wholesalePrice,
        retailPrice: decimalField(packageValue, "retailPrice", true),
        currency: currency.toUpperCase(),
        dataAmount: decimalField(packageValue, "dataAmount", true),
        dataUnit: textField(packageValue, "dataUnit"),
        durationDays: durationDays != null && Number.isSafeInteger(durationDays) ? durationDays : null,
      });
    }
  }
  return plans;
}

export function sitePublicoBase(env: Record<string, string | undefined> = process.env) {
  const configured = env.SITE_URL?.trim();
  const vercelUrl = env.VERCEL_URL?.trim();
  const candidate = configured || (vercelUrl ? `https://${vercelUrl}` : "");
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function statusPedidoNexa(value: unknown): string {
  switch (Number(value)) {
    case 1: return "CRIADO";
    case 2: return "AGUARDANDO_PAGAMENTO_NEXA";
    case 3: return "PROVISIONANDO";
    case 4: return "FALHA_PAGAMENTO_NEXA";
    case 5: return "CANCELADO_NEXA";
    case 6: return "CONCLUIDO";
    case 11: return "PROVISIONAMENTO_CANCELADO";
    case 12: return "FALHA_PROVISIONAMENTO";
    default: return "STATUS_NEXA_NAO_MAPEADO";
  }
}

export function extrairString(record: Record<string, unknown>, key: string): string | null {
  return textField(record, key);
}

export function extrairObjeto(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function extrairLista(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
