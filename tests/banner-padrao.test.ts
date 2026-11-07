import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import sharp from "sharp";

/**
 * Imagem PADRÃO do topo da tela inicial — o mesmo lugar onde o motorista manda
 * a foto que ele quiser ("Personalizar imagem").
 *
 * Pedido do Jonas: a arte da marca (porto + motorista + COPA LINKS + estrada)
 * passa a ser o padrão desse lugar. Antes o componente apontava para
 * `/images/inicio/tempo-topo.webp`, um arquivo que NÃO existia no repositório —
 * o topo do app abria vazio para quem não tinha foto.
 *
 * Regras que este teste trava:
 *   - o padrão é um arquivo de verdade, no repositório;
 *   - ele tem a MESMA moldura 1536×1024 das fotos personalizadas (nada de
 *     deformar, nem de faixa azul sobrando embaixo);
 *   - o componente usa o padrão de `src/lib/banner-padrao.ts` (com o `?v=`
 *     do conteúdo, para o celular não mostrar a arte antiga do cache);
 *   - o script de troca continua funcionando.
 *
 * Como rodar:
 *   ./node_modules/.bin/tsx --test tests/banner-padrao.test.ts
 */

const ler = (p: string) => readFileSync(p, "utf8");
const COMPONENTE = "src/components/inicio/BannerCaminhao.tsx";
const MODULO = "src/lib/banner-padrao.ts";
const ARTE = "public/images/inicio/banner-padrao.webp";
const LARGURA = 1536;
const ALTURA = 1024;

test("o padrão do topo é um arquivo de verdade, não um caminho quebrado", () => {
  const componente = ler(COMPONENTE);
  assert.ok(
    !componente.includes("/images/inicio/tempo-topo.webp"),
    "o banner voltou a apontar para tempo-topo.webp — esse arquivo não existe no repositório",
  );

  const modulo = ler(MODULO);
  const m = modulo.match(/src: "([^"]+)"/);
  assert.ok(m, "src/lib/banner-padrao.ts sem o endereço da imagem padrão");
  const caminho = m[1].split("?")[0];
  assert.equal(caminho, "/images/inicio/banner-padrao.webp", "endereço do padrão mudou sem atualizar este teste");
  assert.ok(existsSync(`public${caminho}`), `a imagem padrão não está em public${caminho}`);
  assert.match(m[1], /\?v=[0-9a-f]{8}$/, "o endereço do padrão perdeu o carimbo de versão (?v=...)");
});

test("o padrão tem a mesma moldura 1536×1024 das fotos personalizadas", async () => {
  const meta = await sharp(ARTE).metadata();
  assert.equal(meta.format, "webp", "o padrão precisa ser WebP (leve para o celular)");
  assert.equal(meta.width, LARGURA, "largura do padrão diferente da moldura do banner");
  assert.equal(meta.height, ALTURA, "altura do padrão diferente da moldura do banner");

  // o módulo gerado concorda com o arquivo
  const modulo = ler(MODULO);
  assert.match(modulo, new RegExp(`largura: ${LARGURA}`), "medida de largura errada em banner-padrao.ts");
  assert.match(modulo, new RegExp(`altura: ${ALTURA}`), "medida de altura errada em banner-padrao.ts");
});

test("o componente usa a arte padrão no mesmo lugar da foto do motorista", () => {
  const s = ler(COMPONENTE);
  assert.ok(s.includes('from "@/lib/banner-padrao"'), "o componente não usa o padrão gerado pelo script");
  assert.ok(s.includes("BANNER_PADRAO.src"), "o componente não mostra o endereço do padrão");
  // a moldura é única: nada de proporção diferente para o padrão
  assert.ok(s.includes("aspect-[1536/1024]"), "a moldura do topo perdeu a proporção 1536×1024");
  assert.ok(
    !/src === BANNER_PADRAO \? "aspect-\[1536\/1071\]"/.test(s),
    "o padrão voltou a ter moldura própria (1071) — a altura do topo muda ao trocar pela foto",
  );
  // padrão centralizado; foto personalizada mantém o enquadramento do caminhão
  assert.ok(s.includes('object-center'), "o padrão perdeu a centralização");
  assert.ok(s.includes("object-[68%_46%]"), "a foto do motorista perdeu o enquadramento do caminhão");
});

test("o script de troca da arte padrão continua no repositório", () => {
  const script = ler("scripts/gerar-banner-padrao.mjs");
  assert.ok(script.includes("banner-padrao.webp"), "o script não grava a imagem padrão do topo");
  assert.ok(script.includes("src/lib/banner-padrao.ts"), "o script não atualiza as medidas/versão");
  assert.ok(script.includes("fit: \"cover\""), "o script voltou a deformar a arte (sem recorte)");
});
