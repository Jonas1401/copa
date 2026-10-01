import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { ALTURA, LARGURA, PROMPT_BANNER, extrairImagem, montarArgumentos, paraBanner, prepararFoto, tratamentoLocal } from "../src/lib/banner";

const foto = (w: number, h: number, fmt: "jpeg" | "png" = "jpeg") =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 40 } } })[fmt]().toBuffer();

test("validação: tipo, tamanho, arquivo quebrado e foto pequena", async () => {
  await assert.rejects(prepararFoto(Buffer.alloc(0), "image/jpeg"), /vazio/);
  await assert.rejects(prepararFoto(await foto(800, 600), "image/gif"), /Formato não aceito/);
  await assert.rejects(prepararFoto(Buffer.from("não é imagem"), "image/jpeg"), /Não consegui abrir/);
  await assert.rejects(prepararFoto(await foto(200, 150), "image/jpeg"), /pequena demais/);
  await assert.rejects(prepararFoto(Buffer.alloc(9 * 1024 * 1024, 1), "image/jpeg"), /grande demais/);
  const ok = await sharp(await prepararFoto(await foto(4000, 3000, "png"), "image/png")).metadata();
  assert.equal(ok.format, "jpeg");
  assert.ok(ok.width! <= 1600 && ok.height! <= 1600, "reduz fotos enormes");
});

test("banner final sempre 1536×1024 sem deformar (foto em pé ou deitada) e tratamento local", async () => {
  for (const [w, h] of [[1200, 1600], [2000, 900]]) {
    const m = await sharp(await paraBanner(await foto(w, h))).metadata();
    assert.deepEqual([m.width, m.height, m.format], [LARGURA, ALTURA, "webp"]);
  }
  const local = await sharp(await tratamentoLocal(await foto(1000, 700))).metadata();
  assert.deepEqual([local.width, local.height, local.format], [LARGURA, ALTURA, "webp"]);
});

test("pedido ao gerador: usa os campos que a ferramenta declara", () => {
  const f = { url: "https://app/api/banner-fonte/x", base64: "QUJD" };
  const a = montarArgumentos({ properties: { prompt: { type: "string" }, image_url: { type: "string", description: "URL of the input image" }, aspect_ratio: { type: "string" } } }, f);
  assert.equal(a.args.image_url, f.url);
  assert.equal(a.args.aspect_ratio, "3:2");
  assert.equal(a.args.prompt, PROMPT_BANNER);
  const b = montarArgumentos({ properties: { prompt: {}, images: { type: "array", description: "base64 encoded input images" } } }, f);
  assert.deepEqual(b.args.images, ["data:image/jpeg;base64,QUJD"]);
  const c = montarArgumentos({ properties: { prompt: {}, output_format: {} } }, f);
  assert.equal(c.campoImg, null, "sem campo de foto: não gera caminhão inventado");
  assert.match(PROMPT_BANNER, /NÃO altere a identidade do caminhão/);
});

test("resposta do gerador: acha a imagem em data URL ou base64", async () => {
  const png = await foto(400, 300, "png");
  const a = await extrairImagem({ data: { image: `data:image/png;base64,${png.toString("base64")}` } });
  assert.equal((await sharp(a!).metadata()).width, 400);
  const grande = await foto(1200, 900, "png");
  const b = await extrairImagem({ candidates: [{ inline: grande.toString("base64") }] });
  assert.equal((await sharp(b!).metadata()).width, 1200);
  assert.equal(await extrairImagem({ texto: "sem imagem" }), null);
});

/**
 * Banco descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=… DATABASE_URL=… ./node_modules/.bin/tsx --test tests/banner.test.ts
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try { const u = new URL(uri); return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_"); } catch { return false; }
})();

test("cada motorista tem a sua imagem; sem gerador usa o tratamento local; voltar ao padrão", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { motoristas, bannerFontes } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { processarBanner, infoBanner, imagemBanner, removerBanner, fonteTemporaria } = await import("../src/lib/banner");
  process.env.COMPOSIO_API_KEY = "";
  try {
    await garantirTabelas();
    const [ana] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
    const [beto] = await db.insert(motoristas).values({ nome: "Beto" }).returning();
    const r = await processarBanner(ana.id, await foto(1600, 1200), "image/jpeg");
    assert.equal(r.via, "local", "sem Composio: tratamento local, sem quebrar");
    assert.equal((await infoBanner(ana.id))?.versao, r.versao);
    assert.equal((await sharp((await imagemBanner(ana.id))!).metadata()).width, LARGURA);
    assert.equal(await infoBanner(beto.id), null, "a imagem da Ana não aparece para o Beto");
    assert.equal(await imagemBanner(beto.id), null);
    const r2 = await processarBanner(ana.id, await foto(900, 1400), "image/jpeg");
    assert.notEqual(r2.versao, r.versao, "trocar gera nova versão (atualiza o cache)");
    await assert.rejects(processarBanner(beto.id, Buffer.from("x"), "image/jpeg"));
    assert.equal(await infoBanner(beto.id), null, "falha não cria imagem quebrada");
    await removerBanner(ana.id);
    assert.equal(await infoBanner(ana.id), null);
    await db.insert(bannerFontes).values({ token: "a".repeat(32), imagem: "QUJD", expiraEm: new Date(Date.now() - 1000) });
    assert.equal(await fonteTemporaria("a".repeat(32)), null, "foto temporária expirada não é servida");
    assert.equal(await fonteTemporaria("../../etc"), null);
  } finally {
    await pool.end();
  }
});
