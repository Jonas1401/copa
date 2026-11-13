import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  CHAVE_GANHOS_OCULTOS,
  lerGanhosOcultos,
  salvarGanhosOcultos,
} from "../src/lib/ocultar-ganhos";

function criarStorageMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

test("o olho ao lado do menu alterna os valores monetários da tela inicial e mantém a escolha salva", () => {
  const cabecalho = readFileSync("src/components/inicio/Cabecalho.tsx", "utf8");
  const inicio = readFileSync("src/components/MonitorApp.tsx", "utf8");
  const servicos = readFileSync("src/components/inicio/Servicos.tsx", "utf8");
  assert.match(cabecalho, /<MenuConta[\s\S]*?<button[\s\S]*?onClick=\{onAlternarGanhos\}/);
  assert.match(cabecalho, /Mostrar ganhos.*Esconder ganhos/);
  assert.match(cabecalho, /aria-pressed=\{ganhosOcultos\}/);
  assert.match(inicio, /setGanhosOcultos\(lerGanhosOcultos\(\)\)/);
  assert.match(inicio, /setGanhosOcultos\(\(ocultos\) => salvarGanhosOcultos\(!ocultos\)\)/);
  assert.match(inicio, /ganhosOcultos \? "\*\*\*\*\*" : saldo\.valor/);
  assert.match(inicio, /<Servicos[^>]*ganhosOcultos=\{ganhosOcultos\}/);
  assert.match(servicos, /ganhosOcultos \? "\*\*\*\*\*" : c\.bruto/);
  assert.match(servicos, /ganhosOcultos \? "\*\*\*\*\*" : c\.comissao/);
});

test("ao ocultar os ganhos e fechar o app, continua oculto até clicar no olho novamente", () => {
  const storage = criarStorageMemoria();

  // Por padrão, começa visível.
  assert.equal(lerGanhosOcultos(storage), false);

  // Motorista ativa o ícone de olho para ocultar os valores de ganhos.
  assert.equal(salvarGanhosOcultos(true, storage), true);
  assert.equal(storage.getItem(CHAVE_GANHOS_OCULTOS), "1");

  // Mesmo se fechar o aplicativo e abrir novamente, continua acionado (oculto).
  assert.equal(lerGanhosOcultos(storage), true);
  assert.equal(lerGanhosOcultos(storage), true);

  // Só desoculta quando o usuário clicar no ícone novamente para deixar visível.
  assert.equal(salvarGanhosOcultos(false, storage), false);
  assert.equal(storage.getItem(CHAVE_GANHOS_OCULTOS), null);
  assert.equal(lerGanhosOcultos(storage), false);
});
