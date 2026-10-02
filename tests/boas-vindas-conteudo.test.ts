import assert from "node:assert/strict";
import test from "node:test";
import { boasVindasPadrao, validarBoasVindasComposio } from "../src/lib/boas-vindas-conteudo";

test("mensagem padrão dá boas-vindas ao novo motorista", () => {
  const conteudo = boasVindasPadrao("Paulo Silva");
  assert.match(conteudo.chat, /Paulo/);
  assert.match(conteudo.chat, /CopaLinks/);
  assert.match(conteudo.corpoPush, /Paulo/);
  assert.ok(conteudo.tituloPush.length <= 60);
});

test("aceita conteúdo criativo do Composio para chat e Push", () => {
  const resposta = JSON.stringify({
    chat: "Fala, turma! O Paulo chegou ao CopaLinks — deixem um alô para ele se sentir em casa! 🚛",
    tituloPush: "👋 Reforço novo na boleia!",
    corpoPush: "Paulo já está com a gente. Abra o chat e mande um alô!",
  });
  const conteudo = validarBoasVindasComposio("Paulo Silva", resposta);
  assert.deepEqual(conteudo, {
    chat: "Fala, turma! O Paulo chegou ao CopaLinks — deixem um alô para ele se sentir em casa! 🚛",
    tituloPush: "👋 Reforço novo na boleia!",
    corpoPush: "Paulo já está com a gente. Abra o chat e mande um alô!",
  });
});

test("aceita uma frase simples, mas nunca perde o convite/nome no Push", () => {
  const conteudo = validarBoasVindasComposio(
    "Paulo Silva",
    "Turma, recebam o Paulo com um alô e ajudem ele a se sentir em casa! 🚛",
  );
  assert.ok(conteudo);
  assert.match(conteudo!.chat, /Paulo/);
  assert.match(conteudo!.corpoPush, /Paulo/);
});

test("recusa resposta vazia ou que esquece o novo integrante", () => {
  assert.equal(validarBoasVindasComposio("Paulo Silva", "Vamos dar boas-vindas à turma!"), null);
  assert.equal(validarBoasVindasComposio("Paulo Silva", ""), null);
});
