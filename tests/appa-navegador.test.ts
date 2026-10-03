import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { lerPainelAppa } from "../src/lib/appa/leitor";
import { capturarPagina, chromiumLocal, lerViaNavegador } from "../src/lib/appa/metodos/navegador";
import { pastaDoIdioma } from "../src/lib/appa/metodos/ocr";
import { ErroMetodo } from "../src/lib/appa/tipos";

/**
 * NAVEGADOR AUTOMÁTICO E OCR DE VERDADE (Chromium + Tesseract).
 *
 * Abre uma página que se comporta como o painel da APPA (nasce vazia, os dados
 * chegam por XHR depois de 1,5 s e as marés/sol só montam ao rolar a tela) e
 * confere que o servidor: espera o carregamento dinâmico, rola, captura texto,
 * tabelas, JSON e a imagem, e que o OCR lê a mesma imagem.
 *
 * Só roda onde existe um Chromium: aponte `APPA_CHROMIUM_PATH` para o
 * executável (ex.: /usr/bin/chromium ou o Chrome instalado) e rode
 *   APPA_CHROMIUM_PATH=/usr/bin/chromium ./node_modules/.bin/tsx --test tests/appa-navegador.test.ts
 * Sem Chromium os testes ficam "skipped" — os testes puros (tests/appa-leitor.test.ts)
 * cobrem a mesma lógica com uma página falsa.
 */
process.env.APPA_LOG = "0";
for (const v of ["APPA_METODOS", "APPA_NAVEGADOR", "APPA_BROWSER_WS", "APPA_SCREENSHOT_URL"]) delete process.env[v];

const exe = chromiumLocal();
const temChromium = Boolean(exe && existsSync(exe));
const temIdioma = Boolean(pastaDoIdioma());
const pasta = new URL("./fixtures/appa-spa/", import.meta.url);

let servidor: Server;
let url = "";

before(async () => {
  if (!temChromium) return;
  const html = readFileSync(new URL("index.html", pasta));
  const json = readFileSync(new URL("painel.json", pasta));
  servidor = createServer((req, res) => {
    if (req.url?.startsWith("/api/painel.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(json);
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/`;
  process.env.SIMPORT_PAINEL_URL = url;
});

after(async () => {
  if (servidor) await new Promise((ok) => servidor.close(ok));
  delete process.env.SIMPORT_PAINEL_URL;
});

test("Chromium real: espera o painel dinâmico, rola até as marés, captura texto, tabelas, JSON e a imagem", { skip: !temChromium, timeout: 90_000 }, async () => {
  const cap = await capturarPagina({ url, timeoutMs: 40_000, screenshot: true });
  assert.equal(cap.renderizou, true, "o painel apareceu depois do carregamento dinâmico");
  assert.match(cap.texto, /Previsão de Chuvas/);
  assert.match(cap.texto, /Previsão de Marés/, "rolou a página e o bloco carregado sob demanda apareceu");
  assert.match(cap.texto, /08:40\s*1\.5m Alta/);
  assert.ok(cap.tabelas.length >= 2, "tabelas de chuva e vento identificadas");
  assert.deepEqual(cap.tabelas[0][1].slice(0, 1), ["08:00"]);
  assert.ok(cap.json.some((j) => j.url.endsWith("/api/painel.json")), "a resposta XHR da página foi interceptada");
  assert.ok(cap.screenshot && cap.screenshot.length > 20_000, "captura de tela da página inteira");
  assert.equal(cap.screenshot.subarray(1, 4).toString(), "PNG");
  assert.ok(cap.duracaoMs < 40_000);

  const l = lerViaNavegador(cap);
  assert.equal(l.painel.chuva.length, 12);
  assert.deepEqual(l.painel.chuva[3], { hora: "14:00", mm: 6.4, prob: 92 });
  assert.equal(l.painel.mares.length, 4, "marés do bloco que só aparece ao rolar");
  assert.equal(l.painel.agora.pressao, 1017);
});

test("Chromium real: o HTML sozinho vem vazio (SPA) e o navegador automático assume sem alarde", { skip: !temChromium, timeout: 90_000 }, async () => {
  const r = await lerPainelAppa({ metodos: ["html", "playwright"] });
  assert.equal(r.status, "sucesso");
  assert.equal(r.metodo, "playwright");
  assert.deepEqual(r.tentativas.map((t) => [t.metodo, t.resultado]), [["html", "vazio"], ["playwright", "sucesso"]]);
  assert.match(r.tentativas[0].detalhe, /montado por JavaScript/);
  const l = r.leitura!;
  assert.equal(l.metodo_leitura, "playwright");
  assert.equal(l.temperatura, "19°C");
  assert.equal(l.chuva_forte, "sim · 6,4 mm às 14:00");
  assert.match(l.tempestade ?? "", /^sim · 04\/10, madrugada e manhã/);
  assert.equal(l.alertas.length, 1);
});

test("Chromium + OCR reais: a captura de tela é lida por OCR e dá os mesmos números do texto", { skip: !temChromium || !temIdioma, timeout: 120_000 }, async () => {
  const r = await lerPainelAppa({
    metodos: ["playwright", "ocr"],
    executores: {
      // O leitor de texto "falha" de propósito para forçar o OCR a ler a imagem da mesma captura.
      playwright: async (ctx) => {
        await ctx.captura();
        throw new ErroMetodo("texto renderizado ignorado neste teste", "vazio");
      },
    },
  });
  assert.equal(r.status, "sucesso", r.erro ?? "");
  assert.equal(r.metodo, "ocr");
  const l = r.leitura!;
  assert.equal(l.metodo_leitura, "ocr");
  assert.equal(l.temperatura, "19°C");
  assert.equal(l.umidade, "86%");
  assert.equal(l.pressao, "1017 hPa");
  assert.match(l.chuva_forte ?? "", /^sim · 6,4 mm às 14:00$/, "6.4 mm, nunca 64 mm");
  assert.equal(l.detalhes.painel.chuva.length, 12);
  assert.equal(l.detalhes.painel.vento.length, 12);
  assert.match(l.tempestade ?? "", /^sim · /);
  assert.ok(r.tentativas[1].duracaoMs < 60_000);
});
