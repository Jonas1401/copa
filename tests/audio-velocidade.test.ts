/**
 * Velocidade dos áudios do chat (1x, 1,5x e 2x).
 *
 * A regra é pura (src/lib/audio-velocidade.ts) e o teste confere também que o
 * player do chat realmente usa essa regra no <audio> — se alguém tirar o
 * playbackRate do PlayerAudio, o teste quebra.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  CHAVE_VELOCIDADE_AUDIO,
  VELOCIDADES_AUDIO,
  aplicarVelocidade,
  assinarVelocidade,
  ciclarVelocidade,
  proximaVelocidade,
  rotuloVelocidade,
  velocidadeAtual,
  velocidadeNoServidor,
  velocidadeValida,
  type VelocidadeAudio,
} from "../src/lib/audio-velocidade";

test("as velocidades oferecidas são 1x, 1,5x e 2x, com o rótulo em português", () => {
  assert.deepEqual([...VELOCIDADES_AUDIO], [1, 1.5, 2]);
  assert.equal(rotuloVelocidade(1), "1x");
  assert.equal(rotuloVelocidade(1.5), "1,5x");
  assert.equal(rotuloVelocidade(2), "2x");
  for (const velocidade of VELOCIDADES_AUDIO) {
    assert.match(rotuloVelocidade(velocidade), /^[12](,[05])?x$/, `rótulo esquisito em ${velocidade}`);
  }
});

test("o toque na etiqueta cicla 1x → 1,5x → 2x → 1x (e nunca sai da lista)", () => {
  assert.equal(proximaVelocidade(1), 1.5);
  assert.equal(proximaVelocidade(1.5), 2);
  assert.equal(proximaVelocidade(2), 1);
  let velocidade: VelocidadeAudio = 1;
  for (let i = 0; i < 9; i += 1) {
    velocidade = proximaVelocidade(velocidade);
    assert.ok(VELOCIDADES_AUDIO.includes(velocidade), `ciclo saiu da lista: ${velocidade}`);
  }
  assert.equal(velocidade, 1, "a cada 3 toques o ciclo volta ao começo (1x)");
});

test("valor inválido no aparelho não quebra o player: cai em 1x", () => {
  assert.equal(velocidadeValida("2"), 2);
  assert.equal(velocidadeValida("1,5"), 1.5);
  assert.equal(velocidadeValida(1.5), 1.5);
  for (const valor of [null, undefined, "", "rápido", 0, 3, -1, NaN, "1.75", {}]) {
    assert.equal(velocidadeValida(valor), 1, `valor ${String(valor)} deveria virar 1x`);
  }
});

test("a velocidade entra no <audio> (playbackRate + defaultPlaybackRate) sem perder o tom", () => {
  const elemento = { playbackRate: 1, defaultPlaybackRate: 1 } as { playbackRate: number; defaultPlaybackRate: number };
  for (const velocidade of VELOCIDADES_AUDIO) {
    aplicarVelocidade(elemento as unknown as HTMLMediaElement, velocidade);
    assert.equal(elemento.playbackRate, velocidade);
    assert.equal(elemento.defaultPlaybackRate, velocidade, "o próximo play tem de sair já na velocidade escolhida");
  }
  // Mesmo num aparelho que rejeite playbackRate, a chamada não pode estourar.
  const travado = Object.defineProperty({}, "playbackRate", {
    set() { throw new Error("sem suporte"); },
  });
  assert.doesNotThrow(() => aplicarVelocidade(travado as unknown as HTMLMediaElement, 2));
});

test("a escolha fica salva no aparelho e todos os players do chat trocam juntos", () => {
  const armazem = new Map<string, string>();
  const eventos = new Set<string>();
  const janela = {
    localStorage: {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => void armazem.set(chave, valor),
    },
    addEventListener: (tipo: string) => void eventos.add(tipo),
    removeEventListener: (tipo: string) => void eventos.delete(tipo),
  };
  const global = globalThis as { window?: unknown };
  global.window = janela;
  try {
    assert.equal(velocidadeNoServidor(), 1, "no servidor não há aparelho: 1x");
    assert.equal(velocidadeAtual(), 1, "aparelho novo começa em 1x");
    let avisos = 0;
    const desassinar = assinarVelocidade(() => { avisos += 1; });
    assert.ok(eventos.has("storage"), "sem escuta de mudança feita em outra aba");

    assert.equal(ciclarVelocidade(1), 1.5);
    assert.equal(armazem.get(CHAVE_VELOCIDADE_AUDIO), "1.5", "a velocidade não foi salva no aparelho");
    assert.equal(avisos, 1, "os outros players do chat não foram avisados da troca");
    assert.equal(velocidadeAtual(), 1.5, "o app esqueceu a velocidade escolhida");

    assert.equal(ciclarVelocidade(velocidadeAtual()), 2);
    assert.equal(ciclarVelocidade(2), 1);
    assert.equal(velocidadeAtual(), 1, "depois de 2x o ciclo volta para 1x");

    desassinar();
    assert.ok(!eventos.has("storage"), "a escuta de outra aba ficou pendurada no aparelho");
    ciclarVelocidade(1.5);
    assert.equal(avisos, 3, "player já desligado não pode mais ser avisado");
  } finally {
    delete global.window;
  }
});

test("o player do chat dos motoristas usa a etiqueta de velocidade do áudio", () => {
  const fonte = readFileSync("src/components/chat/ChatMotoristas.tsx", "utf8");
  assert.ok(fonte.includes("@/lib/audio-velocidade"), "PlayerAudio não usa a regra de velocidade");
  assert.ok(fonte.includes("aplicarVelocidade(elemento, velocidade)"), "PlayerAudio não aplica playbackRate no <audio>");
  assert.ok(fonte.includes("rotuloVelocidade(velocidade)"), "a etiqueta não mostra a velocidade atual");
  assert.ok(fonte.includes("ciclarVelocidade(velocidade)"), "a etiqueta não cicla as velocidades");
  // A escolha vale para os próximos áudios do chat: fica salva no aparelho.
  assert.ok(/useSyncExternalStore\(assinarVelocidade, velocidadeAtual, velocidadeNoServidor\)/.test(fonte), "o player não lê a velocidade lembrada no aparelho");
  const audio = fonte.slice(fonte.indexOf("function PlayerAudio"), fonte.indexOf("function ConteudoMensagem"));
  assert.ok(audio.includes("<audio"), "sumiu o elemento <audio> do player");
  assert.ok(
    audio.includes('elemento.addEventListener("play", garantirVelocidade)'),
    "a velocidade não é reaplicada ao tocar: o Safari ignora o playbackRate definido antes dos metadados",
  );
  assert.ok(/aria-label=\{`Velocidade do áudio/.test(audio), "a etiqueta de velocidade perdeu o rótulo de acessibilidade (leitor de tela)");
  assert.ok(!fonte.includes(CHAVE_VELOCIDADE_AUDIO), "a chave do aparelho vive só em src/lib/audio-velocidade.ts");
});
