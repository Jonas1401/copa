import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ler = (arquivo: string) => readFileSync(arquivo, "utf8");

test("identidade e tela inicial do assistente são exclusivamente mecânicas", () => {
  const tela = ler("src/components/chat/AssistenteIA.tsx");
  const backend = ler("src/lib/ia.ts");
  for (const texto of [
    "Assistente Mecânico CopaLinks",
    "Identificar uma peça",
    "Problemas no caminhão",
    "Problemas no carro",
    "Elétrica automotiva",
    "Manutenção e reparos",
    "Luzes e códigos de falha",
    "Meu caminhão perdeu força. O que pode ser?",
    "Meu motor está esquentando. O que verificar?",
    "Minha bateria não está carregando.",
  ]) assert.ok(tela.includes(texto), `tela inicial sem: ${texto}`);
  assert.match(backend, /especializado exclusivamente em mecânica automotiva/i);
  assert.match(backend, /gravidade \(leve, moderada ou grave\)/i);
  assert.match(backend, /marca\/modelo\/ano\/motorização/i);
  assert.match(backend, /Não invente a identificação/i);
  assert.match(backend, /parar em local seguro/i);
  assert.doesNotMatch(tela, /Quais navios|tempo no porto|Como cadastro meu ponto|Navios no porto/);
});

test("envio de mensagem, histórico, fotografia e identidade escura continuam integrados", () => {
  const tela = ler("src/components/chat/AssistenteIA.tsx");
  const rota = ler("src/app/api/ia/chat/route.ts");
  const visao = ler("src/lib/ia-imagem.ts");
  assert.ok(tela.includes("/api/ia/chat?motoristaId="), "carrega histórico existente");
  assert.ok(tela.includes('method: "POST"'), "continua enviando mensagens");
  assert.ok(tela.includes('accept="image/*"'), "mantém o seletor de foto");
  assert.ok(rota.includes("analisarImagemIA(texto, foto, historico)"), "encaminha fotos à análise visual");
  assert.match(visao, /Assistente Mecânico CopaLinks, especializado exclusivamente em mecânica automotiva/);
  assert.ok(tela.includes("bg-fundo") && tela.includes("bg-[#071A28]"), "preserva o tema escuro existente");
});
