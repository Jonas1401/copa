import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { FRASES, PRAZO_SESSAO_MS, TEMPO_MAXIMO_MS, TEMPO_MINIMO_MS, TEMPO_SAIDA_MS, deveSair, fraseDaVez, progressoCarregamento } from "../src/lib/carregamento";

test("progresso: sobe devagar, nunca passa de 92% sem estar pronto e vai a 100% quando pronto", () => {
  assert.equal(progressoCarregamento(0, false), 0);
  const a = progressoCarregamento(1000, false), b = progressoCarregamento(3000, false);
  assert.ok(a > 0 && b > a, "anda com o tempo");
  assert.ok(progressoCarregamento(600_000, false) <= 0.92);
  assert.equal(progressoCarregamento(10, true), 1);
  assert.equal(progressoCarregamento(Number.NaN, false), 0);
});

test("saída: espera o mínimo, sai quando pronto e nunca prende o app", () => {
  assert.equal(deveSair(100, true), false, "não pisca em internet rápida");
  assert.equal(deveSair(TEMPO_MINIMO_MS, true), true);
  assert.equal(deveSair(5000, false), false);
  assert.equal(deveSair(TEMPO_MAXIMO_MS, false), true, "trava de segurança");
});

test("frases trocam enquanto carrega e mostram Pronto! no fim", () => {
  assert.equal(fraseDaVez(0, false), FRASES[0]);
  assert.equal(fraseDaVez(1300, false), FRASES[1]);
  assert.equal(fraseDaVez(1300 * FRASES.length, false), FRASES[0]);
  assert.equal(fraseDaVez(500, true), "Pronto!");
});

test("prazo da sessão cabe dentro da trava da tela de carregamento", () => {
  // A abertura confirma o perfil antes do limite da splash: mesmo com a rede
  // travada, a animação nunca prende o app até os 10 s.
  assert.ok(PRAZO_SESSAO_MS > TEMPO_MINIMO_MS, "prazo curto demais: mataria a sessão em rede lenta normal");
  assert.ok(
    PRAZO_SESSAO_MS + TEMPO_SAIDA_MS < TEMPO_MAXIMO_MS,
    "prazo da sessão estourou a trava da splash: a animação prende na rede lenta",
  );
});

test("abertura: a confirmação do perfil não espera a leitura do estado", () => {
  // Regressão: o efeito da sessão esperava o /api/estado antes de confirmar o
  // perfil, e a splash (que só sai com o perfil pronto) prendia por segundos
  // mesmo com a página já desenhada pelo servidor.
  const s = readFileSync("src/components/MonitorApp.tsx", "utf8");
  const inicio = s.indexOf("Confere a identidade deste aparelho");
  const fim = s.indexOf("}, [guardarMotorista]);", inicio);
  assert.ok(inicio >= 0 && fim > inicio, "efeito da sessão não encontrado");
  const bloco = s.slice(inicio, fim);
  assert.ok(!bloco.includes("/api/estado"), "a sessão voltou a esperar o /api/estado: a splash prende na rede lenta");
  assert.ok(bloco.includes("PRAZO_SESSAO_MS"), "a sessão perdeu o prazo: rede travada prende a splash até 10 s");
});
