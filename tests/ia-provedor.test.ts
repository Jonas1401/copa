import assert from "node:assert/strict";
import { test } from "node:test";
import { chatDiretoIA, ErroIA, nomeProvedorIA, provedorPelaChave } from "../src/lib/ia-provedor";

test("detecta provedores pela chave e nomeia a configuração selecionada", () => {
  assert.equal(provedorPelaChave("sk-ant-teste"), "anthropic");
  assert.equal(provedorPelaChave("sk-or-teste"), "openrouter");
  assert.equal(provedorPelaChave("gsk_teste"), "groq");
  assert.equal(provedorPelaChave("AIza-teste"), "gemini");
  assert.equal(provedorPelaChave("sk-teste"), "openai");
  assert.equal(provedorPelaChave("chave-sem-formato"), null);
  assert.equal(nomeProvedorIA("auto", "sk-teste"), "OpenAI");
  assert.equal(nomeProvedorIA("gemini", "chave-manual"), "Google Gemini");
  assert.equal(nomeProvedorIA("desconhecido", "chave-manual"), null);
});

test("faz uma geração real pela API OpenAI e envia ao modelo o contexto literal do site de navios", async () => {
  const fetchOriginal = globalThis.fetch;
  let chamada: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    chamada = { url: String(input), init };
    return Response.json({ choices: [{ message: { content: "O AFENTIS XRISTOS ATH está previsto para 17:30." } }] });
  }) as typeof fetch;

  try {
    const textoFonte = "AFENTIS XRISTOS ATH\n11/10 17:30 · AT — AZ211 BB\nPREVISTA\nhttps://berth-bloom-tracker.lovable.app/";
    const resposta = await chatDiretoIA(
      [
        { role: "system", content: "Responda somente com os dados recebidos. PREVISTA não é confirmação." },
        { role: "user", content: `Qual a previsão?\n\nDados do site:\n${textoFonte}` },
      ],
      "sk-teste-nao-real",
      "auto",
    );

    assert.equal(resposta, "O AFENTIS XRISTOS ATH está previsto para 17:30.");
    assert.equal(chamada.url, "https://api.openai.com/v1/chat/completions");
    assert.equal((chamada.init?.method), "POST");
    const corpo = JSON.parse(String(chamada.init?.body));
    assert.equal(corpo.model, "gpt-4o-mini");
    assert.ok(corpo.messages[1].content.includes("17:30"));
    assert.ok(corpo.messages[1].content.includes("berth-bloom-tracker.lovable.app"));
    assert.equal(new Headers(chamada.init?.headers).get("authorization"), "Bearer sk-teste-nao-real");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("a chave OpenRouter em detecção automática chama o endpoint e o modelo OpenRouter", async () => {
  const fetchOriginal = globalThis.fetch;
  let chamada: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    chamada = { url: String(input), init };
    return Response.json({ choices: [{ message: { content: "Resposta da OpenRouter" } }] });
  }) as typeof fetch;

  try {
    const resposta = await chatDiretoIA(
      [{ role: "user", content: "Teste com dados dos navios" }],
      "sk-or-v1-chave-ficticia",
      "auto",
    );
    assert.equal(resposta, "Resposta da OpenRouter");
    assert.equal(chamada.url, "https://openrouter.ai/api/v1/chat/completions");
    const corpo = JSON.parse(String(chamada.init?.body));
    assert.equal(corpo.model, "openai/gpt-4o-mini");
    assert.equal(new Headers(chamada.init?.headers).get("authorization"), "Bearer sk-or-v1-chave-ficticia");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("usa a API Gemini sem colocar a chave na URL", async () => {
  const fetchOriginal = globalThis.fetch;
  let chamada: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    chamada = { url: String(input), init };
    return Response.json({ candidates: [{ content: { parts: [{ text: "OK" }] } }] });
  }) as typeof fetch;

  try {
    const resposta = await chatDiretoIA([{ role: "user", content: "Teste" }], "AIza-chave-de-teste", "gemini", { maxTokens: 32 });
    assert.equal(resposta, "OK");
    assert.equal(chamada.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    assert.equal(new Headers(chamada.init?.headers).get("x-goog-api-key"), "AIza-chave-de-teste");
    assert.ok(!chamada.url.includes("AIza-chave-de-teste"));
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("usa a API Anthropic e trata resposta não vazia", async () => {
  const fetchOriginal = globalThis.fetch;
  let chamada: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    chamada = { url: String(input), init };
    return Response.json({ content: [{ type: "text", text: "Conectado" }] });
  }) as typeof fetch;

  try {
    assert.equal(await chatDiretoIA([{ role: "user", content: "Teste" }], "sk-ant-teste", "auto"), "Conectado");
    assert.equal(chamada.url, "https://api.anthropic.com/v1/messages");
    assert.equal(new Headers(chamada.init?.headers).get("x-api-key"), "sk-ant-teste");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("falhas de autenticação não expõem a chave e provedor desconhecido não faz requisição", async () => {
  const fetchOriginal = globalThis.fetch;
  const segredo = "sk-segredo-de-teste";
  globalThis.fetch = (async () => new Response("sem permissão", { status: 401 })) as typeof fetch;

  try {
    await assert.rejects(
      chatDiretoIA([{ role: "user", content: "Teste" }], segredo, "openai"),
      (erro: unknown) => erro instanceof ErroIA && erro.codigo === "nao_configurada" && !erro.message.includes(segredo),
    );
    await assert.rejects(
      chatDiretoIA([{ role: "user", content: "Teste" }], segredo, "outro-provedor"),
      (erro: unknown) => erro instanceof ErroIA && erro.codigo === "nao_configurada",
    );
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
