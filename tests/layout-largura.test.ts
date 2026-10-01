import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");
const TELAS = [
  "src/components/MonitorApp.tsx",
  "src/components/frete/FreteApp.tsx",
  "src/components/motoristas/BoasVindas.tsx",
  "src/app/contatos/page.tsx",
];

/** Telas do app do motorista (fora o painel /admin, que é uma tela de mesa). */
const TELAS_COMPLETAS = [
  ...TELAS,
  "src/app/page.tsx",
  "src/components/inicio/NavInferior.tsx",
  "src/components/tempo/TempoApp.tsx",
  "src/components/chat/ChatMotoristas.tsx",
  "src/components/chat/AssistenteIA.tsx",
  "src/components/alerta/AlertaAdmin.tsx",
  "src/components/inicio/BannerCaminhao.tsx",
];

test("telas não usam mais a foto do navio como fundo", () => {
  for (const p of TELAS) {
    const s = ler(p);
    assert.ok(!s.includes("FUNDO.src"), `${p} ainda usa a foto de fundo`);
    assert.ok(s.includes("#002b6b") && s.includes("fundo-app"), `${p} sem a cor azul do fundo`);
  }
});

test("imagens de topo usam degradê suave para se fundir ao fundo azul", () => {
  const css = ler("src/app/globals.css");
  assert.ok(css.includes(".imagem-degrade"), "globals.css sem a classe .imagem-degrade");
  for (const p of ["src/components/inicio/BannerCaminhao.tsx", "src/components/tempo/TempoApp.tsx"]) {
    const s = ler(p);
    assert.ok(s.includes("imagem-degrade"), `${p} sem degradê de máscara na imagem`);
    assert.ok(s.includes("#002b6b"), `${p} não funde a base na cor azul do fundo`);
  }
});

test("a viewport usa a largura em dp configurada no aparelho (device-width)", () => {
  const s = ler("src/app/layout.tsx");
  assert.ok(s.includes('width: "device-width"'), "layout.tsx sem width: device-width");
  assert.ok(!s.includes("maximumScale"), "layout.tsx não deve travar o zoom do aparelho");
});

test("globals.css define a coluna com a largura do aparelho", () => {
  const css = ler("src/app/globals.css");
  assert.ok(css.includes(".largura-aparelho"), "globals.css sem a classe .largura-aparelho");
  const bloco = css.slice(css.indexOf(".largura-aparelho"));
  assert.ok(/width:\s*100%/.test(bloco), ".largura-aparelho sem width: 100%");
  assert.ok(/max-width:\s*100%/.test(bloco), ".largura-aparelho sem max-width: 100%");
  // Só em telas grandes (tablet/desktop) o conteúdo é centralizado com um teto.
  assert.ok(
    /@media \(min-width: 768px\)[\s\S]{0,120}max-width: 768px/.test(css),
    "sem o teto de 768 px para tablet/desktop",
  );
});

test("o app usa a largura do aparelho e não uma coluna fixa de 360 px", () => {
  for (const p of TELAS_COMPLETAS) {
    const s = ler(p);
    assert.ok(!s.includes("max-w-[360px]"), `${p} ainda tem a coluna fixa de 360 px`);
    assert.ok(!s.includes("max-w-[390px]"), `${p} ainda tem a coluna fixa de 390 px`);
    assert.ok(!s.includes("max-w-[460px]"), `${p} ainda tem a coluna fixa de 460 px`);
  }
  // As telas que montam a estrutura do app precisam da classe da largura do aparelho.
  for (const p of [
    "src/components/MonitorApp.tsx",
    "src/components/inicio/NavInferior.tsx",
    "src/components/frete/FreteApp.tsx",
    "src/components/tempo/TempoApp.tsx",
    "src/app/contatos/page.tsx",
    "src/components/motoristas/BoasVindas.tsx",
    "src/components/chat/ChatMotoristas.tsx",
    "src/components/chat/AssistenteIA.tsx",
  ]) {
    assert.ok(ler(p).includes("largura-aparelho"), `${p} não usa a largura do aparelho`);
  }
});

test("banner do caminhão mantém a faixa de limpeza no topo (58%), base (44%), esquerda, legenda e enquadramento", () => {
  const s = ler("src/components/inicio/BannerCaminhao.tsx");
  assert.ok(s.includes("top-0 h-[58%]"), "BannerCaminhao.tsx sem a faixa azul de 58% no topo");
  assert.ok(s.includes("bottom-0 h-[44%]") && s.includes("#002b6b_100%"), "BannerCaminhao.tsx sem a base de 44% fundindo no #002b6b");
  assert.ok(s.includes("linear-gradient(90deg,"), "BannerCaminhao.tsx sem proteção do lado esquerdo");
  assert.ok(s.includes("radial-gradient("), "BannerCaminhao.tsx sem limpeza da linha da legenda");
  assert.ok(s.includes("object-[68%_46%]"), "BannerCaminhao.tsx alterou o enquadramento do caminhão");
});

