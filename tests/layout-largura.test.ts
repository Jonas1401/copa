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

test("imagens de topo se fundem ao fundo azul (foto do caminhão: só a base em degradê)", () => {
  const css = ler("src/app/globals.css");
  assert.ok(css.includes(".imagem-degrade"), "globals.css sem a classe .imagem-degrade");
  assert.ok(css.includes(".imagem-nitida"), "globals.css sem a classe .imagem-nitida (foto nítida)");
  // A máscara da foto do caminhão tem de deixar o topo 100% nítido: nada de
  // máscara antes dos 95% da altura (o degradê é só na base).
  const mask = css.slice(css.indexOf(".imagem-nitida"), css.indexOf(".imagem-degrade"));
  assert.ok(/#000\s+0%,\s*#000\s+95%/.test(mask), ".imagem-nitida não mantém a foto nítida até 95%");
  for (const p of ["src/components/inicio/BannerCaminhao.tsx", "src/components/tempo/TempoApp.tsx"]) {
    const s = ler(p);
    assert.ok(/imagem-(degrade|nitida)/.test(s), `${p} sem degradê de máscara na imagem`);
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

test("banner do caminhão: foto nítida no topo, degradê só nos 5% da base, trocar foto discreto", () => {
  const s = ler("src/components/inicio/BannerCaminhao.tsx");
  assert.ok(!s.includes("h-[58%]"), "BannerCaminhao.tsx voltou a sujar o topo da foto com o véu azul de 58%");
  assert.ok(!s.includes("h-[44%]"), "BannerCaminhao.tsx voltou a fundir 44% da foto (o pedido é só a base)");
  assert.ok(!s.includes("linear-gradient(90deg,"), "BannerCaminhao.tsx voltou a cobrir o lado esquerdo da foto");
  assert.ok(!s.includes("radial-gradient("), "BannerCaminhao.tsx voltou a jogar brilho sobre a foto");
  assert.ok(s.includes("imagem-nitida"), "BannerCaminhao.tsx sem a máscara de foto nítida");
  assert.ok(s.includes("bottom-0 h-[5%]") && s.includes("#002b6b_100%"), "BannerCaminhao.tsx sem o degradê de 5% na base");
  assert.ok(s.includes("object-[68%_46%]"), "BannerCaminhao.tsx alterou o enquadramento do caminhão");
  // trocar a foto = só o ícone, pequeno e quase sem "caixa", para não poluir a frente da imagem
  assert.ok(/aria-label="Personalizar imagem"[\s\S]{0,400}h-10 w-10[\s\S]{0,200}bg-black\/20/.test(s), "o botão de personalizar deixou de ser discreto");
});

test("ícones do cabeçalho (compartilhar e tempo) ficam discretos sobre a foto", () => {
  const s = ler("src/components/inicio/Cabecalho.tsx");
  assert.ok(!s.includes("bg-[#0b2152]/80"), "os controles do cabeçalho voltaram a ter a caixa azul pesada");
  assert.ok(!s.includes("border-[#2a5bb0]/70"), "os controles do cabeçalho voltaram a ter borda destacada");
  assert.ok(s.includes("bg-black/20"), "os controles do cabeçalho sem fundo discreto");
  assert.ok(s.includes("h-11 w-11"), "o botão de compartilhar perdeu o ganho de toque de 44 px");
  assert.ok(s.includes("size={17}"), "os ícones do cabeçalho deixaram de ser pequenos");
});

