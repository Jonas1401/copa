import assert from "node:assert/strict";
import { after, test } from "node:test";
import { paginaAppa, paginaSinprapar } from "./navios-fixture";
import {
  etbDeltaMin,
  eventosFertilizantes,
  parseEtb,
  resumoEvento,
  textoLotePadrao,
  textoPadrao,
  type EventoNavio,
} from "../src/lib/navios-aviso";
import type { NavioLineup } from "../src/lib/navios";

/**
 * Avisos de navios de fertilizantes de ponta a ponta (cron → chat → Push).
 * Só roda num PostgreSQL local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/navios-aviso.test.ts
 * Não acessa APPA/SINPRAPAR/Open-Meteo (fetch substituído) nem envia Push real.
 */
const uri = process.env.TEST_DATABASE_URL;
const local = (() => {
  if (!uri || process.env.DATABASE_URL !== uri) return false;
  try { const u = new URL(uri); return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/fila_push_test_"); } catch { return false; }
})();

/** Navio de fertilizante para os testes puros do lote (sem rede). */
function navioTeste(extra: Partial<NavioLineup> = {}): NavioLineup {
  return {
    programacao: "2",
    secao: "PROGRAMADOS",
    porto: "Paranaguá",
    berco: "211",
    nome: "LEO. K",
    imo: "2",
    dwt: "30000",
    sentido: "Imp",
    mercadoria: "MAP",
    toneladas: 70000,
    saldoToneladas: null,
    chegada: "",
    eta: "",
    etb: "05/10 08:00",
    atracacao: "",
    agencia: "",
    operador: "",
    ...extra,
  };
}

test("navios: lote de novidades no mesmo ciclo vira UMA mensagem", () => {
  const eventos: EventoNavio[] = [
    { chave: "P:2:211", tipo: "programado", navio: navioTeste(), manobra: null },
    {
      chave: "A:3",
      tipo: "atracado",
      navio: navioTeste({
        programacao: "3",
        secao: "ATRACADOS",
        nome: "ZY IDOL",
        mercadoria: "UREIA",
        toneladas: 32219,
        saldoToneladas: 12000,
      }),
      manobra: null,
    },
  ];
  const texto = textoLotePadrao(eventos, [{ hora: "2026-10-05T03:20", tipo: "preamar", alturaM: 1.4 }]);
  assert.match(texto, /2 novidades/);
  assert.match(texto, /LEO\. K.*berço 211/);
  assert.match(texto, /ZY IDOL.*atracou.*berço 211/);
  assert.match(texto, /preamar por volta das 03:20/);
  assert.ok(texto.length <= 480, "cabe no corpo da notificação");

  // Sem maré, sai sem a dica — e um evento sozinho não vira "lote".
  const semMare = textoLotePadrao(eventos);
  assert.match(semMare, /ZY IDOL/);
  assert.doesNotMatch(semMare, /preamar/);
  assert.doesNotMatch(textoLotePadrao([eventos[0]]), /novidades/);

  // Linhas curtas de cada tipo de evento (sem inventar número nenhum).
  const despachado = resumoEvento({
    chave: "S:3",
    tipo: "saiu",
    navio: navioTeste({ nome: "ZY IDOL", mercadoria: "UREIA" }),
    manobra: null,
  });
  assert.match(despachado, /ZY IDOL foi despachado e deixou Paranaguá/);
});

test("navios: parseEtb entende o horário previsto (com e sem ano)", () => {
  const agora = new Date("2026-10-04T12:00:00Z");
  // Sem ano: assume o ano atual quando o horário está à frente.
  assert.equal(parseEtb("05/10 08:00", agora)?.toISOString(), "2026-10-05T08:00:00.000Z");
  // Sem ano e muito no passado: vira o próximo ano (dezembro → janeiro).
  assert.equal(parseEtb("02/01 08:00", agora)?.toISOString(), "2027-01-02T08:00:00.000Z");
  // Ano explícito (curto ou longo) manda no resultado.
  assert.equal(parseEtb("05/10/26 08:00", agora)?.toISOString(), "2026-10-05T08:00:00.000Z");
  assert.equal(parseEtb("05/10/2026 08:00", agora)?.toISOString(), "2026-10-05T08:00:00.000Z");
  assert.equal(parseEtb("05/10 08h30", agora)?.toISOString(), "2026-10-05T08:30:00.000Z");
  // Horário que não dá para entender não vira data nenhuma.
  assert.equal(parseEtb("", agora), null);
  assert.equal(parseEtb("a definir", agora), null);
  assert.equal(parseEtb(null, agora), null);
  assert.equal(parseEtb("40/13 25:99", agora), null);
});

test("navios: o limite da mudança de ETB é configurável (padrão 120 min)", () => {
  assert.equal(etbDeltaMin({} as Record<string, string>), 120);
  assert.equal(etbDeltaMin({ NAVIOS_ETB_DELTA_MIN: "60" } as Record<string, string>), 60);
  assert.equal(etbDeltaMin({ NAVIOS_ETB_DELTA_MIN: "abc" } as Record<string, string>), 120);
});

test("navios: o ETB vira evento candidato só para navio anunciado com berço definido", () => {
  const comEtb = eventosFertilizantes([navioTeste()], []);
  assert.ok(comEtb.some((e) => e.tipo === "programado"), "programado continua existindo");
  const etb = comEtb.find((e) => e.tipo === "etb");
  assert.ok(etb, "navio programado com berço e ETB ganha o evento de previsão");
  assert.equal(etb?.chave, "E:2:05/10 08:00", "a chave carrega o valor do ETB");

  // Sem ETB legível, sem evento de ETB (só o programado).
  const semEtb = eventosFertilizantes([navioTeste({ etb: "" })], []);
  assert.equal(semEtb.some((e) => e.tipo === "etb"), false);

  // Já atracado: o ETB não interessa mais.
  const atracado = eventosFertilizantes([navioTeste({ secao: "ATRACADOS" })], []);
  assert.equal(atracado.some((e) => e.tipo === "etb"), false);
  assert.ok(atracado.some((e) => e.tipo === "atracado"));
});

test("navios: reprogramação grande do ETB avisa de novo; deriva pequena não", () => {
  const ev: EventoNavio = {
    chave: "E:2:06/10 20:00",
    tipo: "etb",
    navio: navioTeste({ etb: "06/10 20:00" }),
    manobra: null,
    etbAnterior: "05/10 08:00",
  };
  const resumo = resumoEvento(ev);
  assert.match(resumo, /LEO\. K/);
  assert.match(resumo, /reprogramada de 05\/10 08:00 para 06\/10 20:00/);
  assert.match(resumo, /berço 211/);

  const texto = textoPadrao(ev, []);
  assert.match(texto, /previsão de atracação/);
  assert.match(texto, /era 05\/10 08:00 e agora é 06\/10 20:00/);

  // No lote, a reprogramação entra como mais uma linha da mesma mensagem.
  const lote = textoLotePadrao([ev], []);
  assert.match(lote, /reprogramada/);
  assert.ok(lote.length <= 480, "cabe no corpo da notificação");
});

test("navios: 1ª leitura não avisa; novo programado avisa 1 vez no chat e por Push; carga comum ignorada", { skip: !local }, async () => {
  const { db } = await import("../src/db");
  const { chatMensagens, motoristas, subscriptions, naviosAvisos, configuracao } = await import("../src/db/schema");
  const { inArray } = await import("drizzle-orm");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { limparCacheNavios } = await import("../src/lib/navios");
  const { verificarNaviosFertilizantes, NOME_NAVIOS } = await import("../src/lib/navios-aviso");
  const { checarCota } = await import("../src/lib/notificacoes-cota");
  const webpush = (await import("web-push")).default;
  process.env.COMPOSIO_API_KEY = "";
  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey; process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  const pushes: string[] = [];
  Object.defineProperty(webpush, "sendNotification", { configurable: true, value: async (_s: unknown, c: string) => { pushes.push(JSON.parse(c).title); return { statusCode: 201 }; } });

  let appa = paginaAppa({ ATRACADOS: [{ "Programação": "1", "Berço": "114", "Embarcação": "ZY IDOL", IMO: "1", Mercadoria: "UREIA", Previsto: "32.219,000 Tons." }] });
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("appaweb")) return new Response(appa);
    if (url.includes("sinprapar")) return new Response(paginaSinprapar([{ data: "01/10", hora: "02:00", navio: "LEO. K", manobra: "AT: F93/AZ211", calado: "11,40", imo: "2", situacao: "A CONFIRMAR" }]));
    if (url.includes("open-meteo")) return Response.json({ hourly: { time: ["2099-10-01T00:00", "2099-10-01T01:00", "2099-10-01T02:00"], sea_level_height_msl: [0.1, 0.7, 0.2] } });
    if (url.includes("composio")) throw new Error("sem composio no teste");
    return fetchReal(input, init);
  };
  try {
    await garantirTabelas();
    // O banco de teste é reaproveitado entre execuções: comece com o estado
    // dos navios, do chat e da cota limpo (o teste pressupõe a 1ª leitura).
    await db.delete(naviosAvisos);
    await db.delete(chatMensagens);
    await db.delete(configuracao).where(
      inArray(configuracao.chave, ["navios_semeado", "navios_ultima_verificacao", "notificacoes_cota"]),
    );
    await db.delete(subscriptions);
    const [m] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: m.id });

    // 1ª leitura: o navio que JÁ estava atracado não gera aviso antigo.
    const r1 = await verificarNaviosFertilizantes({ forcar: true });
    assert.match(r1.motivo, /primeira leitura: 1 evento/);
    assert.equal((await db.select().from(chatMensagens)).length, 0);
    assert.equal(pushes.length, 0);

    // Surge um navio de MAP programado (berço definido) e um de açúcar.
    appa = paginaAppa({
      ATRACADOS: [{ "Programação": "1", "Berço": "114", "Embarcação": "ZY IDOL", IMO: "1", Mercadoria: "UREIA", Previsto: "32.219,000 Tons." }],
      PROGRAMADOS: [
        { "Programação": "2", "Berço": "211", "Embarcação": "LEO. K", IMO: "2", Mercadoria: "MAP", Previsto: "70.000,000 Tons." },
        { "Programação": "9", "Berço": "204", "Embarcação": "OCEAN AZALEA", IMO: "9", Mercadoria: "AÇÚCAR", Previsto: "60.000,000 Tons." },
      ],
    });
    limparCacheNavios();
    const r2 = await verificarNaviosFertilizantes({ forcar: true });
    assert.deepEqual(r2.avisados, ["programado:LEO. K"]);
    const msgs = await db.select().from(chatMensagens);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].nome, NOME_NAVIOS);
    assert.match(msgs[0].texto, /LEO\. K.*berço 211.*map \(70\.000 t\)/);
    assert.deepEqual(pushes, [NOME_NAVIOS], "Push com o nome do aviso");

    // Mesma situação no próximo ciclo: não repete. Intervalo de 5 min respeitado.
    limparCacheNavios();
    assert.equal((await verificarNaviosFertilizantes({ forcar: true })).avisados.length, 0);
    assert.equal((await verificarNaviosFertilizantes()).motivo, "aguardando intervalo");
    assert.equal((await db.select().from(chatMensagens)).length, 1);
    assert.equal((await db.select().from(naviosAvisos)).length, 2);

    // DOIS navios de fertilizantes com novidade no MESMO ciclo: sai UMA
    // mensagem (e UM Push) com os dois — e a cota do assunto é registrada.
    appa = paginaAppa({
      ATRACADOS: [{ "Programação": "1", "Berço": "114", "Embarcação": "ZY IDOL", IMO: "1", Mercadoria: "UREIA", Previsto: "32.219,000 Tons." }],
      PROGRAMADOS: [
        { "Programação": "2", "Berço": "211", "Embarcação": "LEO. K", IMO: "2", Mercadoria: "MAP", Previsto: "70.000,000 Tons." },
        { "Programação": "4", "Berço": "212", "Embarcação": "OCEAN PEARL", IMO: "4", Mercadoria: "UREIA", Previsto: "55.000,000 Tons." },
        { "Programação": "5", "Berço": "213", "Embarcação": "ATLANTIC BAY", IMO: "5", Mercadoria: "KCL", Previsto: "40.000,000 Tons." },
      ],
    });
    limparCacheNavios();
    const r4 = await verificarNaviosFertilizantes({ forcar: true });
    assert.deepEqual(r4.avisados, ["programado:OCEAN PEARL", "programado:ATLANTIC BAY"]);
    const emLote = await db.select().from(chatMensagens);
    assert.equal(emLote.length, 2, "um lote = uma mensagem");
    assert.equal(emLote[1].nome, NOME_NAVIOS);
    assert.match(emLote[1].texto, /2 novidades/);
    assert.match(emLote[1].texto, /OCEAN PEARL/);
    assert.match(emLote[1].texto, /ATLANTIC BAY/);
    assert.deepEqual(pushes, [NOME_NAVIOS, NOME_NAVIOS], "um lote = um Push");

    // A cota do assunto ficou registrada: o próximo aviso não sai colado.
    assert.equal((await checarCota("navios")).liberado, false, "cota de navios registrada");
  } finally {
    globalThis.fetch = fetchReal;
  }
});

test("navios: mudança significativa do ETB avisa 1 vez; deriva pequena não vira spam", { skip: !local }, async () => {
  const { db } = await import("../src/db");
  const { chatMensagens, motoristas, subscriptions, naviosAvisos, configuracao } = await import("../src/db/schema");
  const { inArray } = await import("drizzle-orm");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { limparCacheNavios } = await import("../src/lib/navios");
  const { verificarNaviosFertilizantes, NOME_NAVIOS } = await import("../src/lib/navios-aviso");
  const webpush = (await import("web-push")).default;
  process.env.COMPOSIO_API_KEY = "";
  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey; process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  const pushes: string[] = [];
  Object.defineProperty(webpush, "sendNotification", { configurable: true, value: async (_s: unknown, c: string) => { pushes.push(JSON.parse(c).title); return { statusCode: 201 }; } });

  const programa = (etb: string) => paginaAppa({
    PROGRAMADOS: [
      { "Programação": "2", "Berço": "211", "Embarcação": "LEO. K", IMO: "2", Mercadoria: "MAP", Previsto: "70.000,000 Tons.", ETB: etb },
    ],
  });
  let appa = programa("05/10 08:00");
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("appaweb")) return new Response(appa);
    if (url.includes("sinprapar")) return new Response(paginaSinprapar([]));
    if (url.includes("open-meteo")) return Response.json({ hourly: { time: ["2099-10-01T00:00", "2099-10-01T01:00"], sea_level_height_msl: [0.1, 0.7] } });
    if (url.includes("composio")) throw new Error("sem composio no teste");
    return fetchReal(input, init);
  };

  try {
    await garantirTabelas();
    await db.delete(naviosAvisos);
    await db.delete(chatMensagens);
    await db.delete(configuracao).where(
      inArray(configuracao.chave, ["navios_semeado", "navios_ultima_verificacao", "notificacoes_cota"]),
    );
    await db.delete(subscriptions);
    const [m] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: m.id });

    // 1) 1ª leitura: registra o navio E a previsão atual (referência), sem avisar.
    //    (Limpa o cache do line-up: o teste anterior pode ter deixado o dele.)
    limparCacheNavios();
    const r1 = await verificarNaviosFertilizantes({ forcar: true });
    assert.match(r1.motivo, /primeira leitura/i);
    assert.equal((await db.select().from(naviosAvisos)).length, 2, "P: programado + E: referência do ETB");
    assert.equal(pushes.length, 0);

    // 2) Tudo igual: nada novo (a mesma informação não repete).
    limparCacheNavios();
    assert.equal((await verificarNaviosFertilizantes({ forcar: true })).avisados.length, 0);

    // 3) ETB deriva 1h30 (< 2 h): mudança pequena NÃO avisa nem vira referência.
    appa = programa("05/10 09:30");
    limparCacheNavios();
    const r3 = await verificarNaviosFertilizantes({ forcar: true });
    assert.equal(r3.avisados.length, 0, `motivo: ${r3.motivo}`);
    assert.match(r3.motivo, /ETB sem mudança significativa/i);
    assert.equal((await db.select().from(naviosAvisos)).length, 2, "deriva pequena não altera a referência");
    assert.equal((await db.select().from(chatMensagens)).length, 0);

    // 4) ETB acumula 3 h de diferença contra a última previsão NOTIFICADA: avisa.
    appa = programa("05/10 11:00");
    limparCacheNavios();
    const r4 = await verificarNaviosFertilizantes({ forcar: true });
    assert.deepEqual(r4.avisados, ["etb:LEO. K"]);
    const msgs = await db.select().from(chatMensagens);
    assert.equal(msgs.length, 1, "uma mensagem para a reprogramação");
    assert.equal(msgs[0].nome, NOME_NAVIOS);
    assert.match(msgs[0].texto, /era 05\/10 08:00/);
    assert.match(msgs[0].texto, /agora é 05\/10 11:00/);
    assert.deepEqual(pushes, [NOME_NAVIOS], "Push da reprogramação");
    assert.equal((await db.select().from(naviosAvisos)).length, 3, "nova previsão vira a referência");

    // 5) Mesma previsão no ciclo seguinte: não repete.
    limparCacheNavios();
    assert.equal((await verificarNaviosFertilizantes({ forcar: true })).avisados.length, 0);

    // 6) Deriva de 1h30 contra a ÚLTIMA NOTIFICADA (11:00): continua calado.
    appa = programa("05/10 12:30");
    limparCacheNavios();
    const r6 = await verificarNaviosFertilizantes({ forcar: true });
    assert.equal(r6.avisados.length, 0, `motivo: ${r6.motivo}`);
    assert.equal((await db.select().from(naviosAvisos)).length, 3);
    assert.equal((await db.select().from(chatMensagens)).length, 1);

    // 7) Agora sim, 3 h contra a última notificada: avisa de novo (1 vez).
    appa = programa("05/10 14:00");
    limparCacheNavios();
    const r7 = await verificarNaviosFertilizantes({ forcar: true });
    assert.deepEqual(r7.avisados, ["etb:LEO. K"]);
    const msgs7 = await db.select().from(chatMensagens);
    assert.equal(msgs7.length, 2);
    assert.match(msgs7[1].texto, /era 05\/10 11:00/);
    assert.match(msgs7[1].texto, /agora é 05\/10 14:00/);
    assert.equal(pushes.length, 2);
  } finally {
    globalThis.fetch = fetchReal;
  }
});

// O banco de teste é compartilhado pelos testes de ponta a ponta do arquivo:
// o pool fecha UMA vez, depois de todos (fechar no meio derruba os próximos).
after(async () => {
  const { pool } = await import("../src/db");
  await pool.end().catch(() => null);
});
