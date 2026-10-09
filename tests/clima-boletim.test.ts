import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TURNOS,
  boletimMerecePush,
  resumoBoletim,
  textoBoletimPadrao,
  turnoDoDia,
} from "../src/lib/clima-boletim";
import type { Previsao } from "@/lib/tempo";

/**
 * Boletim de previsão do tempo no chat (24 h por dia) e o alerta de tempo
 * ruim que assume o lugar dele.
 *
 * Os dois primeiros testes são puros (turno e texto) e rodam sempre.
 * O teste de ponta a ponta (cron → chat → Push) roda SOMENTE num PostgreSQL
 * local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/clima-boletim.test.ts
 * Não acessa Simport/Open-Meteo (a previsão é injetada) nem envia Push real.
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try {
    const u = new URL(uri);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_");
  } catch {
    return false;
  }
})();

/** Previsão de teste: tempo bom por padrão; `chuva`/`vento` para o alerta. */
function previsao(opcoes: { nivel?: Previsao["alerta"]["nivel"]; tempoRuim?: boolean; chanceChuva?: number } = {}): Previsao {
  const nivel = opcoes.nivel ?? "tempo-bom";
  const chance = opcoes.chanceChuva ?? 10;
  const hora = (h: number, temperatura: number, chanceChuva: number) => ({
    ts: Math.floor(Date.now() / 1000) + h * 3600,
    hora: `${String(h + 6).padStart(2, "0")}h`,
    dia: "2026-10-02",
    temperatura,
    sensacao: temperatura,
    umidade: 80,
    chanceChuva,
    chuvaMm: chanceChuva >= 60 ? 4.2 : 0,
    ventoKmh: 14,
    rajadaKmh: 24,
    ventoGraus: 135,
    ventoDirecao: "SE",
    icone: "sol-nuvem" as const,
    descricao: chanceChuva >= 60 ? "Chuva" : "Parcialmente nublado",
  });
  return {
    cidade: "Paranaguá",
    uf: "PR",
    agora: {
      temperatura: 21,
      sensacao: 21,
      umidade: 80,
      chanceChuva: chance,
      ventoKmh: 14,
      rajadaKmh: 24,
      ventoDirecao: "SE",
      ventoGraus: 135,
      chuva24h: 0,
      icone: "sol-nuvem",
      descricao: "Parcialmente nublado",
      hora: "06:00",
      fonte: "estacao",
    },
    alerta: {
      nivel,
      titulo: nivel === "chuva" ? "Chuva forte" : nivel === "vento" ? "Vento forte" : "Tempo firme",
      texto: nivel === "tempo-bom" ? "Nada de alerta no porto." : "Atenção redobrada no cais.",
    },
    boletim: [
      { data: "2026-10-02", texto: opcoes.tempoRuim ? "Chuva e vento no porto." : "Sol com nuvens.", tempoRuim: Boolean(opcoes.tempoRuim) },
    ],
    horas: [hora(1, 22, 70), hora(2, 23, 20), hora(3, 24, 10)],
    dias: [
      {
        data: "2026-10-02",
        rotulo: "Hoje",
        dataCurta: "2 de outubro",
        max: 26,
        min: 18,
        chuvaMm: chance >= 60 ? 4.2 : 0,
        chanceChuva: chance,
        icone: "sol-nuvem",
        descricao: "Parcialmente nublado",
        fonte: "simport",
        temHoras: true,
      },
      {
        data: "2026-10-03",
        rotulo: "Amanhã",
        dataCurta: "3 de outubro",
        max: 24,
        min: 17,
        chuvaMm: 0,
        chanceChuva: 5,
        icone: "sol",
        descricao: "Ensolarado",
        fonte: "simport",
        temHoras: true,
      },
    ],
    nascerSol: "06:12",
    porSol: "18:41",
    atualizadoEm: new Date().toISOString(),
    fontes: { simport: true, estacao: true, openMeteo: true, composio: false },
  };
}

test("boletim: um turno por bloco de 6 h no horário de Brasília", () => {
  // 03:00Z = 00h em Brasília (UTC-3).
  const casos: [string, string][] = [
    ["2026-10-02T03:00:00Z", "madrugada"],
    ["2026-10-02T08:59:00Z", "madrugada"], // 05:59
    ["2026-10-02T09:00:00Z", "manhã"], // 06:00
    ["2026-10-02T14:59:00Z", "manhã"], // 11:59
    ["2026-10-02T15:00:00Z", "tarde"], // 12:00
    ["2026-10-02T20:59:00Z", "tarde"], // 17:59
    ["2026-10-02T21:00:00Z", "noite"], // 18:00
    ["2026-10-03T02:59:00Z", "noite"], // 23:59 do dia 02
  ];
  for (const [iso, esperado] of casos) {
    const t = turnoDoDia(new Date(iso));
    assert.equal(t.turno.nome, esperado, `${iso} deve ser ${esperado}`);
    assert.equal(t.chave.split(":")[1], esperado);
    // A chave carrega a data local: 03:00Z ainda é dia 02 em Brasília.
    if (iso.startsWith("2026-10-02")) assert.ok(t.chave.startsWith("2026-10-02:"), t.chave);
    if (iso.startsWith("2026-10-03T02")) assert.ok(t.chave.startsWith("2026-10-02:"), t.chave);
  }
  assert.equal(TURNOS.length, 4);
});

test("boletim: texto pronto usa só dados reais e cabe na notificação", () => {
  const t = TURNOS[1]; // manhã
  const texto = textoBoletimPadrao(previsao(), t);
  assert.match(texto, /^Bom dia!/);
  assert.match(texto, /21°C/);
  assert.match(texto, /máx 26°, mín 18°/);
  assert.match(texto, /APPA: Sol com nuvens\./);
  assert.ok(texto.length <= 480);

  // Tempo de chuva: a dica prática muda.
  const comChuva = textoBoletimPadrao(previsao({ nivel: "chuva", chanceChuva: 90 }), t);
  assert.match(comChuva, /chuva/i);
  assert.match(comChuva, /lona/i);
});

test("boletim: push só quando o turno traz novidade de verdade", () => {
  // Turno tranquilo e igual ao anterior: fica no chat, sem acordar o celular.
  const calmo = previsao();
  const resumoCalmo = resumoBoletim(calmo);
  assert.equal(boletimMerecePush(calmo, resumoCalmo), false);
  // Primeiro boletim (sem referência anterior): avisa, para o motorista
  // saber que o app está de olho no tempo.
  assert.equal(boletimMerecePush(calmo, null), true);

  // Chuva prevista (50% ou 1 mm), vento forte, frio/calor fora do normal e
  // boletim ruim da APPA merecem a notificação.
  assert.equal(boletimMerecePush(previsao({ chanceChuva: 80 }), resumoCalmo), true);
  assert.equal(boletimMerecePush(previsao({ tempoRuim: true }), resumoCalmo), true);
  const ventando = previsao();
  ventando.agora.rajadaKmh = 55;
  assert.equal(boletimMerecePush(ventando, resumoCalmo), true);
  const gelado = previsao();
  gelado.dias[0].min = 7;
  assert.equal(boletimMerecePush(gelado, resumoCalmo), true);

  // Previsão revisada de verdade (chuva de 10% → 60%): avisa mesmo que o
  // turno esteja calmo hoje.
  const virou = previsao({ chanceChuva: 60 });
  assert.equal(boletimMerecePush(virou, resumoCalmo), true);
  // Só a condição mudou (sol → nublado): também é novidade.
  const nublou = previsao();
  nublou.dias[0].descricao = "Nublado";
  assert.equal(boletimMerecePush(nublou, resumoCalmo), true);
});

test("clima: boletim e alerta ficam na memória, sem chat/Push inclusive com forcar", { skip: !local }, async () => {
  const { db, pool } = await import("@/db");
  const { chatMensagens } = await import("@/db/schema");
  const { garantirTabelas } = await import("@/lib/estado");
  const { verificarEPostarBoletimClima } = await import("@/lib/clima-boletim");
  const { verificarEPostarAlertaClima } = await import("@/lib/clima-alerta");
  const { lerMemoriaClima } = await import("@/lib/ia-memoria-porto");
  const webpush = (await import("web-push")).default;
  const original = webpush.sendNotification;
  let pushes = 0;
  Object.defineProperty(webpush, "sendNotification", { configurable: true, value: async () => { pushes++; return { statusCode: 201 }; } });
  try {
    await garantirTabelas();
    const antes = (await db.select().from(chatMensagens)).length;
    for (const forcar of [false, true]) {
      assert.equal((await verificarEPostarBoletimClima({ previsao: previsao(), forcar })).postou, false);
      const p = previsao({ nivel: "chuva", chanceChuva: 90, tempoRuim: true });
      assert.equal((await verificarEPostarAlertaClima({ previsao: p, forcar })).postou, false);
      assert.equal((await lerMemoriaClima())?.alerta.nivel, "chuva");
    }
    assert.equal((await db.select().from(chatMensagens)).length, antes);
    assert.equal(pushes, 0);
  } finally {
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: original });
    await pool.end();
  }
});
