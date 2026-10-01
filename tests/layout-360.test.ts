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
    assert.ok(s.includes("#063a78"), `${p} sem a cor azul do fundo`);
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
