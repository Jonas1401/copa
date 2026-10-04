import assert from "node:assert/strict";
import { test } from "node:test";
import { TURNOS, textoBoletimPadrao, turnoDoDia } from "../src/lib/clima-boletim";
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
        chuvaMm: 4.2,
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

test("boletim: um turno por bloco (manhã 06h, noite 18h) no horário de Brasília — plano sem excesso v2", () => {
  // 03:00Z = 00h em Brasília (UTC-3). v2: só 2 turnos (06h manhã, 18h noite)
  const casos: [string, string][] = [
    ["2026-10-02T03:00:00Z", "noite"], // 00:00 -> ainda noite do dia anterior
    ["2026-10-02T08:59:00Z", "noite"], // 05:59 -> ainda noite
    ["2026-10-02T09:00:00Z", "manhã"], // 06:00
    ["2026-10-02T14:59:00Z", "manhã"], // 11:59
    ["2026-10-02T15:00:00Z", "manhã"], // 12:00 -> ainda manhã (tarde removida)
    ["2026-10-02T20:59:00Z", "manhã"], // 17:59 -> ainda manhã
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
  assert.equal(TURNOS.length, 2);
});

test("boletim: texto pronto usa só dados reais e cabe na notificação", () => {
  const t = TURNOS[0]; // manhã
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

test("boletim: sai 1 vez por turno no chat e por Push; alerta assume em tempo ruim", { skip: !local }, async () => {
  const { db, pool } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { chatMensagens, motoristas, subscriptions } = await import("@/db/schema");
  const { garantirTabelas } = await import("@/lib/estado");
  const { verificarEPostarBoletimClima, NOME_BOLETIM } = await import("@/lib/clima-boletim");
  const { verificarEPostarAlertaClima, NOME_CLIMA } = await import("@/lib/clima-alerta");
  const webpush = (await import("web-push")).default;
  process.env.COMPOSIO_API_KEY = ""; // sem IA: vale o texto pronto
  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  const pushes: string[] = [];
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (_s: unknown, c: string) => {
      pushes.push(JSON.parse(c).title);
      return { statusCode: 201 };
    },
  });

  try {
    await garantirTabelas();
    await db.execute(sql`truncate chat_mensagens, notificacoes, subscriptions restart identity`);
    await db.execute(sql`delete from motoristas`);
    await db.execute(sql`delete from configuracao where chave in ('clima_boletim_chat', 'clima_ultimo_aviso_chat')`);

    const [ana] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: ana.id });

    // 1) Boletim da vez: mensagem no chat + Push para o aparelho da Ana.
    const r1 = await verificarEPostarBoletimClima({ previsao: previsao() });
    assert.equal(r1.postou, true);
    const msgs = await db.select().from(chatMensagens);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].nome, NOME_BOLETIM);
    assert.match(msgs[0].texto, /21°C/);
    assert.deepEqual(pushes, [NOME_BOLETIM], "Push com o nome do agente");

    // 2) Mesmo turno: não repete (nem mensagem nem Push).
    const r2 = await verificarEPostarBoletimClima({ previsao: previsao() });
    assert.equal(r2.postou, false);
    assert.match(r2.motivo, /já publicado/);
    assert.equal((await db.select().from(chatMensagens)).length, 1);
    assert.equal(pushes.length, 1);

    // 3) Tempo ruim: o alerta entra no lugar do boletim, uma única vez.
    const a1 = await verificarEPostarAlertaClima({ previsao: previsao({ nivel: "chuva", chanceChuva: 90, tempoRuim: true }) });
    assert.equal(a1.postou, true);
    const a2 = await verificarEPostarAlertaClima({ previsao: previsao({ nivel: "chuva", chanceChuva: 90, tempoRuim: true }) });
    assert.equal(a2.postou, false);
    assert.equal(a2.motivo, "já avisado");
    const nomes = (await db.select().from(chatMensagens)).map((m) => m.nome);
    assert.deepEqual(nomes, [NOME_BOLETIM, NOME_CLIMA]);
    assert.deepEqual(pushes, [NOME_BOLETIM, NOME_CLIMA]);
  } finally {
    await db.execute(sql`truncate chat_mensagens, notificacoes, subscriptions restart identity`).catch(() => {});
    await db.execute(sql`delete from motoristas`).catch(() => {});
    await pool.end();
  }
});
