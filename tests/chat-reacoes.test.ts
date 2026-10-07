import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { REACOES_RAPIDAS, reacaoValida } from "../src/lib/reacoes";

/**
 * Curtidas com emoji nas mensagens do chat (estilo WhatsApp).
 * Parte 1 (pura) e parte 3 (tela) rodam sempre: `tsx --test tests/chat-reacoes.test.ts`.
 * Parte 2 (banco) só roda num PostgreSQL local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/chat-reacoes.test.ts
 */

// ------------------------------------------------------------ parte 1: regras
test("só 1 emoji vale como curtida; texto, número e 2+ emojis não", () => {
  for (const e of ["👍", "❤️", "😂", "👍🏽", "🇧🇷", "⚠️", "🚛"]) assert.ok(reacaoValida(e), e);
  for (const e of ["", "   ", "ok", "A014", "123", "👍👍", "🚛💨", "❤️ 🔥", "<3", "👍 x"]) {
    assert.ok(!reacaoValida(e), JSON.stringify(e));
  }
});

test("escolha rápida: 8 emojis únicos e válidos, começando no joinha", () => {
  assert.equal(REACOES_RAPIDAS.length, 8);
  assert.equal(new Set(REACOES_RAPIDAS).size, 8);
  assert.equal(REACOES_RAPIDAS[0], "👍");
  for (const e of REACOES_RAPIDAS) assert.ok(reacaoValida(e), e);
});

// ------------------------------------------------------------ parte 2: banco
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try {
    const u = new URL(uri);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_");
  } catch { return false; }
})();

test("curtir, trocar, descurtir e listar por mensagem", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
  const { chatMensagens, motoristas } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { alternarReacao, listarReacoes, removerReacoesDaMensagem } = await import("../src/lib/chat-reacoes");
  try {
    await garantirTabelas();
    const [ana] = await db.insert(motoristas).values({ nome: "Ana Reação" }).returning();
    const [beto] = await db.insert(motoristas).values({ nome: "Beto Reação" }).returning();
    const [msg] = await db.insert(chatMensagens).values({ motoristaId: ana.id, nome: ana.nome, texto: "Fila andando" }).returning();
    const [outra] = await db.insert(chatMensagens).values({ motoristaId: ana.id, nome: ana.nome, texto: "Outra" }).returning();

    // Ana curte com 👍.
    let r = await alternarReacao(msg.id, ana.id, "👍");
    assert.ok(!("erro" in r));
    if (!("erro" in r)) {
      assert.equal(r.minhaReacao, "👍");
      assert.deepEqual(r.reacoes.map((x) => x.emoji), ["👍"]);
    }

    // Beto curte com ❤️ na mesma mensagem: somam.
    r = await alternarReacao(msg.id, beto.id, "❤️");
    assert.ok(!("erro" in r));
    if (!("erro" in r)) {
      assert.equal(r.reacoes.length, 2);
      assert.deepEqual(r.reacoes.map((x) => x.nome).sort(), ["Ana Reação", "Beto Reação"]);
    }

    // Ana troca para 😂: continua 1 reação dela, agora 😂.
    r = await alternarReacao(msg.id, ana.id, "😂");
    assert.ok(!("erro" in r));
    if (!("erro" in r)) {
      assert.equal(r.minhaReacao, "😂");
      assert.equal(r.reacoes.length, 2);
    }

    // Ana repete o 😂: descurte (sai da lista, Beto continua).
    r = await alternarReacao(msg.id, ana.id, "😂");
    assert.ok(!("erro" in r));
    if (!("erro" in r)) {
      assert.equal(r.minhaReacao, null);
      assert.deepEqual(r.reacoes.map((x) => x.emoji), ["❤️"]);
    }

    // Listagem em lote: só a mensagem curtida volta com reação.
    await alternarReacao(outra.id, beto.id, "🔥");
    const mapa = await listarReacoes([msg.id, outra.id, 999999]);
    assert.deepEqual((mapa[msg.id] ?? []).map((x) => x.emoji), ["❤️"]);
    assert.deepEqual((mapa[outra.id] ?? []).map((x) => x.emoji), ["🔥"]);
    assert.equal(mapa[999999], undefined);
    assert.deepEqual(await listarReacoes([]), {});

    // Entradas inválidas não gravam nada.
    for (const invalida of [
      alternarReacao(msg.id, ana.id, "👍👍"),
      alternarReacao(msg.id, ana.id, "ola"),
      alternarReacao(999999, ana.id, "👍"),
      alternarReacao(msg.id, 999999, "👍"),
      alternarReacao(0, ana.id, "👍"),
    ]) {
      const resultado = await invalida;
      assert.ok("erro" in resultado, "devia recusar a reação inválida");
    }

    // Apagar a mensagem leva as curtidas junto.
    await removerReacoesDaMensagem(msg.id);
    const depois = await listarReacoes([msg.id]);
    assert.deepEqual(depois[msg.id] ?? [], []);
  } finally {
    await pool.end();
  }
});

// ------------------------------------------------------------ parte 3: tela
const tela = () => readFileSync("src/components/chat/ChatMotoristas.tsx", "utf8");

test("a bolha tem pílula de curtidas, seletor de emoji e lista de quem curtiu", () => {
  const s = tela();
  for (const recurso of [
    "function PilulaReacoes",
    "function SeletorReacao",
    "function DetalheReacoes",
    "REACOES_RAPIDAS.map",
    "async function reagir(mensagem: MensagemChat, emoji: string | null)",
    '"Curtir mensagem com emoji"',
    "data-botao-reacao",
    "data-reacao-area",
  ]) {
    assert.ok(s.includes(recurso), `a tela perdeu: ${recurso}`);
  }
});

test("toque duplo curte com joinha e o polling traz as curtidas novas", () => {
  const s = tela();
  assert.ok(s.includes('onDoubleClick={() => { if (motorista) void reagir(mensagem, "👍"); }}'), "sumiu o curtir com toque duplo");
  assert.ok(s.includes("`/api/chat/reacoes?ids=${visiveis.join"), "a tela não busca mais as curtidas no polling");
});

test("nada foi removido: bolhas, áudio, emojis, anexos, IA e silenciar continuam", () => {
  const s = tela();
  for (const recurso of [
    "function MetaMensagem",
    "function PlayerAudio",
    "function ConteudoMensagem",
    "EMOJIS.map",
    "FIGURINHAS.map",
    "AcaoAnexo",
    "<AssistenteIA aberto={iaAberta}",
    "alternarSilencio",
    "mensagensNovas",
  ]) {
    assert.ok(s.includes(recurso), `o chat perdeu: ${recurso}`);
  }
});
