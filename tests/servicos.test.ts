import test from "node:test";
import assert from "node:assert/strict";
import { SERVICOS } from "../src/lib/servicos";

test("serviços da tela inicial não exibem os cards APPA e SINPRAPAR", () => {
  assert.deepEqual(SERVICOS.map((servico) => servico.id), [
    "login",
    "consulta-ponto",
    "frete",
    "contatos",
  ]);
});
