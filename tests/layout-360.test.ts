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

test("largura do app é 360 e não sobrou 390 nas telas", () => {
  for (const p of [...TELAS, "src/components/inicio/NavInferior.tsx", "src/components/tempo/TempoApp.tsx"]) {
    const s = ler(p);
    assert.ok(!s.includes("max-w-[390px]"), `${p} ainda tem 390`);
  }
  assert.ok(ler("src/components/MonitorApp.tsx").includes("max-w-[360px]"));
  assert.ok(ler("src/components/inicio/NavInferior.tsx").includes("max-w-[360px]"));
});
