import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { ErroIA } from "../src/lib/ia-provedor";
import {
  ErroImagem,
  MODELO_OPENROUTER_CRIAR,
  MODELO_OPENROUTER_EDITAR,
  analisarImagemDireta,
  gerarImagemDireta,
  imagemDeDataUrl,
  podeGerarImagem,
  querGerarImagem,
} from "../src/lib/ia-imagem";

async function fotoDeTeste(largura = 2000, altura = 1000) {
  return sharp({
    create: { width: largura, height: altura, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

async function comFetch<T>(
  resposta: (url: string, init?: RequestInit) => Response,
  executar: () => Promise<T>,
) {
  const original = globalThis.fetch;
  const chamadas: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: String(input), init });
    return resposta(String(input), init);
  }) as typeof fetch;
  try {
    const valor = await executar();
    return { valor, chamadas };
  } finally {
    globalThis.fetch = original;
  }
}

test("reconhece pedidos para criar imagem e não confunde com perguntas comuns", () => {
  assert.equal(querGerarImagem("gera uma imagem de um caminhão na neblina"), true);
  assert.equal(querGerarImagem("Cria um desenho de um gato de óculos"), true);
  assert.equal(querGerarImagem("me manda uma foto do porto de Paranaguá"), true);
  assert.equal(querGerarImagem("quero um logo para o meu caminhão"), true);
  assert.equal(querGerarImagem("imagem de um pôr do sol na praia"), true);
  assert.equal(querGerarImagem("transforma essa foto em desenho"), false);
  assert.equal(querGerarImagem("o que é essa imagem?"), false);
  assert.equal(querGerarImagem("o freio tá falhando, e agora?"), false);
  assert.equal(querGerarImagem("mostra o quadro de pontos"), false);
  assert.equal(querGerarImagem("faz o cálculo do frete"), false);
  assert.equal(querGerarImagem(""), false);
});

test("limita a criação de imagens a 6 por hora por motorista", () => {
  const id = 987001;
  const inicio = 1_000_000_000_000;
  for (let i = 0; i < 6; i++) assert.equal(podeGerarImagem(id, inicio + i), true);
  assert.equal(podeGerarImagem(id, inicio + 10), false);
  assert.equal(podeGerarImagem(id + 1, inicio + 10), true, "outro motorista tem a própria cota");
  assert.equal(podeGerarImagem(id, inicio + 3600_000 + 1), true, "depois de 1 hora a cota volta");
});

test("a foto enviada vira JPEG reduzido a 1024 px", async () => {
  const dataUrl = `data:image/png;base64,${(await fotoDeTeste()).toString("base64")}`;
  const jpeg = await imagemDeDataUrl(dataUrl);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 512);
});

test("recusa formato que não é imagem aceita e arquivo corrompido", async () => {
  await assert.rejects(
    () => imagemDeDataUrl("data:application/pdf;base64,JVBERi0="),
    (e: unknown) => e instanceof ErroImagem && e.status === 415,
  );
  const lixo = Buffer.from("isto não é uma imagem de verdade").toString("base64");
  await assert.rejects(
    () => imagemDeDataUrl(`data:image/png;base64,${lixo}`),
    (e: unknown) => e instanceof ErroImagem && e.status === 400,
  );
  await assert.rejects(
    () => imagemDeDataUrl("data:image/jpeg;base64,"),
    (e: unknown) => e instanceof ErroImagem,
  );
});

test("cria imagem pelo OpenRouter (POST /api/v1/images) e devolve os bytes decodificados", async () => {
  const bytes = Buffer.from("imagem-gerada-de-teste");
  const { valor, chamadas } = await comFetch(
    () => Response.json({ data: [{ b64_json: bytes.toString("base64"), media_type: "image/png" }] }),
    () => gerarImagemDireta("um caminhão de carga na neblina", null, "sk-or-v1-teste-nao-real", "auto"),
  );
  assert.equal(valor.toString(), "imagem-gerada-de-teste");
  assert.equal(chamadas[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal((chamadas[0].init?.method), "POST");
  const corpo = JSON.parse(String(chamadas[0].init?.body));
  assert.equal(corpo.model, MODELO_OPENROUTER_CRIAR);
  assert.ok(corpo.prompt.includes("um caminhão de carga na neblina"));
  assert.ok(corpo.prompt.includes("sem nudez"), "instrução de segurança vai junto do pedido");
  assert.equal(corpo.input_references, undefined);
  assert.equal(new Headers(chamadas[0].init?.headers).get("authorization"), "Bearer sk-or-v1-teste-nao-real");
});

test("com foto de referência o OpenRouter recebe a foto em input_references", async () => {
  const foto = await fotoDeTeste(300, 300);
  const { chamadas } = await comFetch(
    () => Response.json({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }),
    () => gerarImagemDireta("transforma em desenho", foto, "sk-or-v1-teste-nao-real", "openrouter"),
  );
  assert.equal(chamadas[0].url, "https://openrouter.ai/api/v1/images");
  const corpo = JSON.parse(String(chamadas[0].init?.body));
  assert.equal(corpo.model, MODELO_OPENROUTER_EDITAR);
  assert.equal(corpo.input_references[0].type, "image_url");
  assert.ok(corpo.input_references[0].image_url.url.startsWith("data:image/jpeg;base64,"));
});

test("sem OpenRouter, a chave da OpenAI ou do Gemini não gera imagem e a mensagem explica o caminho", async () => {
  for (const chave of ["sk-teste-nao-real", "AIza-teste-nao-real"]) {
    await assert.rejects(
      () => gerarImagemDireta("x", null, chave, "auto"),
      (e: unknown) => e instanceof ErroIA && e.codigo === "nao_configurada" && e.message.includes("OpenRouter"),
    );
  }
});

test("provedores sem geração de imagem avisam em vez de chamar a API", async () => {
  await assert.rejects(
    () => gerarImagemDireta("x", null, "gsk_teste-nao-real", "auto"),
    (e: unknown) => e instanceof ErroIA && e.codigo === "nao_configurada",
  );
});

test("erro 401 da chave do OpenRouter vira mensagem de configuração, sem vazar a chave", async () => {
  await assert.rejects(
    () =>
      comFetch(
        () => new Response("{}", { status: 401 }),
        () => gerarImagemDireta("x", null, "sk-or-v1-segredo-nao-real", "openrouter"),
      ),
    (e: unknown) => e instanceof ErroIA && e.codigo === "nao_configurada" && !e.message.includes("sk-or-v1-segredo"),
  );
});

test("402 do OpenRouter (sem saldo) explica o problema de forma clara", async () => {
  await assert.rejects(
    () =>
      comFetch(
        () => new Response("{}", { status: 402 }),
        () => gerarImagemDireta("x", null, "sk-or-v1-teste-nao-real", "auto"),
      ),
    (e: unknown) => e instanceof ErroIA && e.message.includes("sem saldo"),
  );
});

test("analisa a foto pela OpenAI (visão) com a pergunta e o contexto da conversa", async () => {
  const foto = await fotoDeTeste(400, 300);
  const { valor, chamadas } = await comFetch(
    () => Response.json({ choices: [{ message: { content: "Parece um pneu com desgaste nas laterais." } }] }),
    () =>
      analisarImagemDireta(
        "isso é um problema?",
        foto,
        "sk-teste-nao-real",
        "auto",
        [{ papel: "user", texto: "antes de tudo, oi" }],
      ),
  );
  assert.equal(valor, "Parece um pneu com desgaste nas laterais.");
  assert.equal(chamadas[0].url, "https://api.openai.com/v1/chat/completions");
  const corpo = JSON.parse(String(chamadas[0].init?.body));
  const usuario = corpo.messages[1].content;
  assert.equal(usuario[0].type, "text");
  assert.ok(usuario[0].text.includes("isso é um problema?"));
  assert.ok(usuario[0].text.includes("antes de tudo, oi"));
  assert.equal(usuario[1].type, "image_url");
  assert.ok(usuario[1].image_url.url.startsWith("data:image/jpeg;base64,"));
});

test("analisa a foto pela Anthropic e pelo Gemini no formato de cada API", async () => {
  const foto = await fotoDeTeste(200, 200);
  const anthropic = await comFetch(
    () => Response.json({ content: [{ type: "text", text: "Uma planta." }] }),
    () => analisarImagemDireta("o que é?", foto, "sk-ant-teste-nao-real", "auto"),
  );
  assert.equal(anthropic.valor, "Uma planta.");
  const corpoA = JSON.parse(String(anthropic.chamadas[0].init?.body));
  assert.equal(corpoA.messages[0].content[0].type, "image");
  assert.equal(corpoA.messages[0].content[0].source.media_type, "image/jpeg");

  const gemini = await comFetch(
    () => Response.json({ candidates: [{ content: { parts: [{ text: "Um gato." }] } }] }),
    () => analisarImagemDireta("o que é?", foto, "AIza-teste-nao-real", "auto"),
  );
  assert.equal(gemini.valor, "Um gato.");
  const corpoG = JSON.parse(String(gemini.chamadas[0].init?.body));
  assert.ok(corpoG.contents[0].parts[0].inlineData.mimeType === "image/jpeg");
});

test("Groq não analisa imagens e recebe mensagem clara", async () => {
  const foto = await fotoDeTeste(200, 200);
  await assert.rejects(
    () => analisarImagemDireta("o que é?", foto, "gsk_teste-nao-real", "auto"),
    (e: unknown) => e instanceof ErroIA && e.codigo === "nao_configurada" && e.message.includes("Groq"),
  );
});
