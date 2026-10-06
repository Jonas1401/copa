import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Bolhas do chat dos motoristas com a experiência dos aplicativos de mensagem:
 * a bolha acompanha o conteúdo (nunca a largura inteira), o rodapé é enxuto e a
 * conversa fica mais curta na vertical. As funções do chat não mudam.
 */
const ler = () => readFileSync("src/components/chat/ChatMotoristas.tsx", "utf8");

test("a bolha acompanha o conteúdo e para em 80% da coluna de mensagens", () => {
  const s = ler();
  assert.ok(
    s.includes('const classesLargura = larguraBolha ? "" : "w-fit max-w-[80%]";'),
    "a bolha de texto perdeu o w-fit/max-w-[80%] (voltou a ocupar a largura inteira)",
  );
  assert.ok(
    s.includes('temImagem ? { width: "min(80%, 330px)" } : temAudio ? { width: "min(80%, 272px)" } : undefined;'),
    "foto e áudio precisam de largura própria, também limitada a 80%",
  );
  // A bolha não pode mais ser o item que estica a linha (flex-1).
  assert.ok(
    !/min-w-0 flex-1 rounded-\[/.test(s),
    "a bolha voltou a esticar (flex-1) em vez de acompanhar o conteúdo",
  );
});

test("padding enxuto (10–14 px) e canto arredondado de bolha moderna (20 px)", () => {
  const s = ler();
  assert.ok(
    s.includes('temMidia ? "px-2.5 pt-2.5 pb-2" : "px-3 pt-2.5 pb-2"'),
    "o padding da bolha saiu da faixa de 10–14 px",
  );
  assert.ok(!s.includes('rounded-[19px] border px-3.5 pt-2.5 pb-2'), "a bolha antiga de card ainda existe");
  assert.ok(s.includes("rounded-[20px] border"), "a bolha perdeu o border-radius de 20 px");
});

test("espaçamento curto entre bolhas: 5 px na mesma conversa, 8 px entre conversas", () => {
  const s = ler();
  assert.ok(
    s.includes('const recuo = novoDia ? "" : seguida ? "mt-[5px]" : "mt-2";'),
    "o espaçamento entre recados não é mais o curto (5 px / 8 px)",
  );
  // O empilhamento não pode mais somar o gap grande por cima do recuo.
  assert.ok(
    s.includes('className="mx-auto flex min-h-full w-full max-w-[728px] flex-col py-3.5 sm:py-5"'),
    "a lista voltou a somar gap entre as bolhas",
  );
});

test("mensagens recebidas e enviadas: avatar do lado certo e rodapé no canto", () => {
  const s = ler();
  // O envio espelha a linha (avatar à direita) e mantém o rodapé à direita.
  assert.ok(
    s.includes('<div className={`flex w-full items-end gap-2 ${meu ? "flex-row-reverse" : ""}`}>'),
    "a mensagem enviada deixou de ser espelhada com o avatar à direita",
  );
  const meta = s.slice(s.indexOf("function MetaMensagem"), s.indexOf("function PlayerAudio"));
  assert.ok(meta.includes("tabular"), "o horário perdeu o alinhamento tabular");
  assert.ok(meta.includes("<Check size={13}"), "sumiu a confirmação de envio");
  assert.ok(meta.includes('aria-label="Apagar minha mensagem"'), "sumiu o apagar da própria mensagem");
  assert.ok(
    /items-center justify-end gap-1\.5 text-\[10\.5px\]/.test(meta),
    "o rodapé da bolha saiu do canto inferior direito",
  );
  // O rodapé participa da linha do texto: bolha curta não ganha altura só por ele.
  assert.ok(
    s.includes('<div className="flex flex-wrap items-end gap-x-2">'),
    "o rodapé voltou a ocupar uma linha própria em todas as mensagens",
  );
  assert.ok(meta.includes("shrink-0"), "o rodapé pode ser apertado pelo texto");
});

test("mensagens curtas ficam compactas e as de emoji crescem com o emoji", () => {
  const s = ler();
  // Mensagem só de emojis: o rodapé desce em vez de esticar a bolha.
  assert.ok(
    s.includes('const soEmoji = !temMidia && tipo === "texto" && soEmojis(mensagem.texto);'),
    "as mensagens só de emojis perderam o tratamento próprio",
  );
  assert.ok(
    s.includes('<div className="flex flex-col items-end gap-0.5">'),
    "a bolha de emoji voltou a ser esticada para caber o rodapé",
  );
  // Emoji grande sem a caixa antiga de padding vertical.
  assert.ok(
    s.includes('return <div className="text-[40px] leading-[1.15] break-words">{texto.trim()}</div>;'),
    "o tamanho do emoji/entrelinha mudou",
  );
  // O nome só aparece na primeira bolha da sequência (como nos apps de mensagem).
  assert.ok(
    s.includes("{!seguida && <div className={`mb-1 font-display text-[12px]"),
    "o nome voltou a repetir em todas as bolhas",
  );
});

test("nada foi removido: áudio, emojis, anexos, IA, notificações e apagar continuam", () => {
  const s = ler();
  for (const recurso of [
    "function PlayerAudio",
    "rotuloVelocidade(velocidade)",
    "EMOJIS.map",
    "FIGURINHAS.map",
    "AcaoAnexo",
    "<AssistenteIA aberto={iaAberta}",
    "alternarSilencio",
    "mensagensNovas",
    "function ConteudoMensagem",
  ]) {
    assert.ok(s.includes(recurso), `o chat perdeu: ${recurso}`);
  }
});
