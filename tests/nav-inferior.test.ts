import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const nav = readFileSync("src/components/inicio/NavInferior.tsx", "utf8");
const inicio = nav.slice(nav.indexOf("{/* ---------------------------------------------------------- Início */}"), nav.indexOf("{/* ------------------------------------------------------------ Chat */}"));
const navios = nav.slice(nav.indexOf("{/* -------------------------------------------------- Navios (cópia) */}"));

test("Início usa a casa do tamanho do navio e indica seleção em amarelo", () => {
  assert.match(inicio, /aria-current=\{ativoInicio \? "page" : undefined\}/);
  assert.match(inicio, /ativoInicio \? "text-ouro" : "text-aco hover:border-ciano\/50 hover:text-gelo"/);
  assert.match(inicio, /<House size=\{22\} strokeWidth=\{2\} \/>/);
  assert.match(navios, /<Ship size=\{22\} strokeWidth=\{2\} \/>/);
  assert.match(inicio, /text-\[12\.5px\] leading-tight font-semibold">Início/);
  assert.match(navios, /text-\[12\.5px\] leading-tight font-semibold">Navios/);
  assert.match(navios, /text-aco transition-colors hover:border-ciano\/50 hover:text-gelo/);
  assert.doesNotMatch(inicio, /bg-gelo/);
});
