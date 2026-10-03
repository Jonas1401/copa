import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chamarNexa,
  NexaApiError,
  mapearCatalogoNexa,
  NEXAESIM_PATHS,
  NEXAESIM_PRODUCTION_API,
  nexaeMode,
  nexaSettingsStatus,
  sitePublicoBase,
  statusPedidoNexa,
} from "../src/lib/esim/nexaesim";
import { assinaturaHmacTeste, verificarAssinaturaHmac } from "../src/lib/esim/security";
import { calcularPrecoCliente } from "../src/lib/esim/catalog";
import { reconciliarStatusNexa } from "../src/lib/esim/order-status";

const setEnv = (values: Record<string, string | undefined>) => {
  const before: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
};

test("documentação NexaEsim: usa somente base e paths publicados na Partner API v1", () => {
  assert.equal(NEXAESIM_PRODUCTION_API, "https://nexaesim.com/api/partner/v1");
  assert.deepEqual(NEXAESIM_PATHS, {
    catalog: "/package/load",
    coverage: "/package/coverage",
    createOrder: "/order/create",
    queryOrder: "/order/query",
    loadEsims: "/sim-info/load",
    queryUsage: "/sim-info/query-info",
  });
  assert.equal(nexaeMode({}), "TEST");
  assert.equal(nexaeMode({ NEXAESIM_MODE: "production" }), "PRODUCTION");
  assert.equal(nexaeMode({ NEXAESIM_MODE: "sandbox" }), "TEST", "valores não documentados nunca habilitam produção");
});

test("providerErrorCode aceita somente número finito e descarta texto ecoado pelo provedor", () => {
  const makeError = (providerErrorCode: number) => new NexaApiError({
    requestId: "request-test",
    operation: "catalog",
    providerErrorCode,
  });
  assert.equal(makeError(403).providerErrorCode, 403);
  assert.equal(makeError("credential-leak" as unknown as number).providerErrorCode, null);
  assert.equal(makeError(Number.NaN).providerErrorCode, null);
  assert.equal(makeError(Number.POSITIVE_INFINITY).providerErrorCode, null);
});

test("chamarNexa descarta errorCode textual em vez de armazená-lo como providerErrorCode", async () => {
  const restore = setEnv({
    NEXAESIM_MODE: "PRODUCTION",
    NEXAESIM_API_KEY: "unit-test-api-key",
    NEXAESIM_API_URL: NEXAESIM_PRODUCTION_API,
    NEXAESIM_WEBHOOK_SECRET: "unit-test-webhook-secret",
  });
  try {
    await assert.rejects(chamarNexa("catalog", {}, {
      fetcher: async () => new Response(JSON.stringify({ errorCode: "unit-test-api-key", message: "echoed credential" }), { status: 401 }),
    }), (error: unknown) => {
      assert.ok(error instanceof NexaApiError);
      assert.equal(error.providerErrorCode, null);
      assert.equal(error.message.includes("unit-test-api-key"), false);
      return true;
    });
  } finally { restore(); }
});

test("modo TESTE não acessa a rede NexaEsim mesmo com API Key configurada", async () => {
  const restore = setEnv({
    NEXAESIM_MODE: "TEST",
    NEXAESIM_API_KEY: "unit-test-only",
    NEXAESIM_API_URL: NEXAESIM_PRODUCTION_API,
    NEXAESIM_WEBHOOK_SECRET: "unit-test-webhook-secret",
  });
  let calls = 0;
  try {
    const status = nexaSettingsStatus();
    assert.equal(status.mode, "TEST");
    assert.equal(status.providerReady, false);
    assert.equal(status.sandboxDocumented, false);
    await assert.rejects(
      chamarNexa("catalog", {}, { fetcher: async () => { calls += 1; return new Response("{}"); } }),
      /Modo TESTE ativo/,
    );
    assert.equal(calls, 0);
  } finally { restore(); }
});

test("PRODUÇÃO faz POST documentado, header secreto só no request server-side e idempotência estável", async () => {
  const restore = setEnv({
    NEXAESIM_MODE: "PRODUCTION",
    NEXAESIM_API_KEY: "unit-test-api-key",
    NEXAESIM_API_URL: NEXAESIM_PRODUCTION_API,
    NEXAESIM_WEBHOOK_SECRET: "unit-test-webhook-secret",
  });
  let calledUrl = "";
  let sentHeaders = new Headers();
  let sentBody: unknown;
  try {
    const result = await chamarNexa<{ listPackages: unknown[] }>("catalog", {}, {
      fetcher: async (input, init) => {
        calledUrl = String(input);
        sentHeaders = new Headers(init?.headers);
        sentBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ errorCode: 0, message: "OK", data: { listPackages: [] } }), { status: 200 });
      },
    });
    assert.equal(calledUrl, `${NEXAESIM_PRODUCTION_API}/package/load`);
    assert.equal(sentHeaders.get("X-API-Key"), "unit-test-api-key");
    assert.equal(sentHeaders.get("content-type"), "application/json");
    assert.deepEqual(sentBody, {});
    assert.deepEqual(result.data, { listPackages: [] });
    assert.equal(nexaSettingsStatus().providerReady, true);

    const orderCall = await chamarNexa("createOrder", {
      orderItems: [{ packageId: 13726, quantity: 1 }],
      callbackUrl: "https://copalinks.example/api/esim/webhook",
    }, {
      idempotencyKey: "copalinks-esim-unit-order-1",
      fetcher: async (_input, init) => {
        sentHeaders = new Headers(init?.headers);
        sentBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ errorCode: 0, data: { orderCode: "PO_TEST_ONLY" } }), { status: 200 });
      },
    });
    assert.equal(sentHeaders.get("X-Idempotency-Key"), "copalinks-esim-unit-order-1");
    assert.equal((sentBody as { orderItems: { packageId: number }[] }).orderItems[0].packageId, 13726);
    assert.equal((orderCall.data as { orderCode: string }).orderCode, "PO_TEST_ONLY");
  } finally { restore(); }
});

test("URL da API deve ser a base HTTPS oficial exata; valores inválidos nunca chegam ao fetch", async () => {
  const restore = setEnv({
    NEXAESIM_MODE: "PRODUCTION",
    NEXAESIM_API_KEY: "unit-test-only",
    NEXAESIM_API_URL: "https://evil.example/api/partner/v1",
    NEXAESIM_WEBHOOK_SECRET: "unit-test-webhook-secret",
  });
  let calls = 0;
  try {
    assert.equal(nexaSettingsStatus().apiUrlConfigured, false);
    await assert.rejects(
      chamarNexa("catalog", {}, { fetcher: async () => { calls += 1; return new Response("{}"); } }),
      /NEXAESIM_API_KEY e NEXAESIM_API_URL/,
    );
    assert.equal(calls, 0);
  } finally { restore(); }
});

test("mapper de catálogo consome os campos publicados e ignora registros incompletos", () => {
  const plans = mapearCatalogoNexa({ listPackages: [{
    product: { id: 216, code: "US", name: "United States" },
    packages: [
      { id: 13726, code: "US-1GB-7D", name: "United States 1 GB / 7 Days", wholesalePrice: 4.8, retailPrice: 5.77, currency: "USD", dataAmount: 1, dataUnit: "GB", duration: 7 },
      { id: 13727, name: "", wholesalePrice: 1 },
      { id: 13728, name: "missing cost", currency: "USD" },
    ],
  }] });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0], {
    packageId: "13726",
    productId: "216",
    productCode: "US",
    productName: "United States",
    code: "US-1GB-7D",
    name: "United States 1 GB / 7 Days",
    wholesalePrice: "4.8",
    retailPrice: "5.77",
    currency: "USD",
    dataAmount: "1",
    dataUnit: "GB",
    durationDays: 7,
  });
  assert.throws(() => mapearCatalogoNexa({ listPackages: "invented-shape" }), /Formato de catálogo/);
});

test("assinatura do webhook HMAC-SHA256 valida corpo exato em tempo constante", () => {
  const body = '{"orderCode":"PO1","orderStatus":6}';
  const secret = "unit-test-webhook-secret";
  const signature = assinaturaHmacTeste(body, secret);
  assert.equal(signature, signature.toUpperCase());
  assert.equal(verificarAssinaturaHmac(body, signature, secret), true);
  assert.equal(verificarAssinaturaHmac(`${body} `, signature, secret), false);
  assert.equal(verificarAssinaturaHmac(body, signature, "another-secret"), false);
  assert.equal(verificarAssinaturaHmac(body, "not-a-signature", secret), false);
  assert.equal(verificarAssinaturaHmac(body, signature, undefined), false);
});

test("valores documentados de status NexaEsim e preço com margem", () => {
  assert.equal(statusPedidoNexa(1), "CRIADO");
  assert.equal(statusPedidoNexa(2), "AGUARDANDO_PAGAMENTO_NEXA");
  assert.equal(statusPedidoNexa(3), "PROVISIONANDO");
  assert.equal(statusPedidoNexa(4), "FALHA_PAGAMENTO_NEXA");
  assert.equal(statusPedidoNexa(5), "CANCELADO_NEXA");
  assert.equal(statusPedidoNexa(6), "CONCLUIDO");
  assert.equal(statusPedidoNexa(11), "PROVISIONAMENTO_CANCELADO");
  assert.equal(statusPedidoNexa(12), "FALHA_PROVISIONAMENTO");
  assert.equal(statusPedidoNexa(999), "STATUS_NEXA_NAO_MAPEADO");
  assert.equal(calcularPrecoCliente("9.95", 15), "11.44");
  assert.equal(calcularPrecoCliente("0.10", 0), "0.10");
});

test("status Nexa idempotent/out-of-order jamais desfaz conclusão e aceita retry iniciado", () => {
  assert.deepEqual(reconciliarStatusNexa({
    currentStatus: "PROVISIONING",
    currentProviderStatusCode: 3,
    incomingProviderStatusCode: 2,
    hasInstallData: false,
  }), { status: "PROVISIONING", providerStatusCode: 3 });
  assert.deepEqual(reconciliarStatusNexa({
    currentStatus: "CONCLUIDO",
    currentProviderStatusCode: 6,
    incomingProviderStatusCode: 2,
    hasInstallData: true,
  }), { status: "CONCLUIDO", providerStatusCode: 6 });
  assert.deepEqual(reconciliarStatusNexa({
    currentStatus: "AGUARDANDO_ESIM",
    currentProviderStatusCode: 6,
    incomingProviderStatusCode: 2,
    hasInstallData: true,
  }), { status: "CONCLUIDO", providerStatusCode: 6 });
  assert.deepEqual(reconciliarStatusNexa({
    currentStatus: "PROVISIONING_FAILED",
    currentProviderStatusCode: 12,
    incomingProviderStatusCode: 2,
    hasInstallData: false,
  }), { status: "PROVISIONING_FAILED", providerStatusCode: 12 });
  assert.deepEqual(reconciliarStatusNexa({
    currentStatus: "PROVISIONING",
    currentProviderStatusCode: 12,
    incomingProviderStatusCode: 3,
    hasInstallData: false,
  }), { status: "PROVISIONING", providerStatusCode: 3 });
});

test("URL HTTPS do callback é normalizada sem expor credenciais", () => {
  assert.equal(sitePublicoBase({ SITE_URL: "https://shop.example/path?ignore=1" }), "https://shop.example");
  assert.equal(sitePublicoBase({ VERCEL_URL: "copalinks.example" }), "https://copalinks.example");
  assert.equal(sitePublicoBase({ SITE_URL: "http://shop.example" }), null);
  assert.equal(sitePublicoBase({ SITE_URL: "https://user:pass@shop.example" }), null);
});
