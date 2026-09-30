import assert from "node:assert/strict";
import { test } from "node:test";
import { EMOJIS, FIGURINHAS, figurinhaDe, soEmojis, textoDaFigurinha } from "../src/lib/figurinhas";

test("figurinha da lista é reconhecida pelo texto exato", () => {
  for (const f of FIGURINHAS) assert.deepEqual(figurinhaDe(textoDaFigurinha(f)), f);
  assert.equal(figurinhaDe("☕ Bom dia, motoristas!"), FIGURINHAS[0]);
  assert.equal(figurinhaDe("☕ Bom dia, motoristas! A fila tá grande"), null, "texto a mais = mensagem comum");
  assert.equal(figurinhaDe("Bom dia, motoristas!"), null);
});

test("só emojis (1 a 3) aparecem grandes; texto, números e muitos emojis não", () => {
  for (const t of ["👍", "😂😂", "🚛💨", "⚠️", "👍🏽", "🇧🇷", "❤️ 🔥"]) assert.ok(soEmojis(t), t);
  for (const t of ["ok 👍", "A014", "123", "#", "👍👍👍👍", "", "   "]) assert.ok(!soEmojis(t), t);
});

test("listas sem repetição e dentro do limite da mensagem", () => {
  assert.equal(new Set(EMOJIS).size, EMOJIS.length);
  assert.equal(new Set(FIGURINHAS.map(textoDaFigurinha)).size, FIGURINHAS.length);
  assert.ok(FIGURINHAS.every((f) => textoDaFigurinha(f).length <= 500));
});
