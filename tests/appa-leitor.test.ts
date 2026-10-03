import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fmtNum, htmlParaTexto, repararOcr, semHtml, similaridade } from "../src/lib/appa/texto";
import {
  detectarAtualizacao,
  leituraCompleta,
  leituraUtilOcr,
  mmDoOcr,
  parsearPainelSimport,
} from "../src/lib/appa/painel";
import { analisarTextos, nivelChuva, normalizarLeitura } from "../src/lib/appa/analise";
import { metodosLigados, configLeitor } from "../src/lib/appa/config";
import {
  ErroMetodo,
  ORDEM_METODOS,
  leituraPublica,
  type MetodoLeitura,
  type PainelSimport,
  type SaidaMetodo,
} from "../src/lib/appa/tipos";
import {
  cardinal,
  definirTokenDescoberto,
  lerViaApi,
  painelDeDadosSimport,
  resetarSondaPressao,
  tokenEmUso,
} from "../src/lib/appa/metodos/api";
import { descobrirTokens, extrairAgoraDeJson, extrairJsonsEmbutidos, lerViaHtml } from "../src/lib/appa/metodos/html";
import { lerViaOcr } from "../src/lib/appa/metodos/ocr";
import {
  candidatosDeNavegador,
  capturarPagina,
  dadosSimportDeRespostas,
  lerViaNavegador,
  type CapturaNavegador,
  type PaginaLike,
  type RespostaLike,
} from "../src/lib/appa/metodos/navegador";
import { formatarLinhaLog, lerPainelAppa, type ExecutorMetodo } from "../src/lib/appa/leitor";

/**
 * LEITURA DO PAINEL DA APPA — vários métodos com fallback automático.
 *
 * Tudo aqui é puro (sem rede, sem banco e sem navegador de verdade): o fetch é
 * simulado e o navegador é uma página falsa. O teste com Chromium e OCR reais
 * está em tests/appa-navegador.test.ts (roda só onde existe um Chromium).
 *
 *   ./node_modules/.bin/tsx --test tests/appa-leitor.test.ts
 */
process.env.APPA_LOG = "0";
// Os testes valem com qualquer ambiente: nada de herdar métodos desligados ou prazos do terminal.
for (const v of ["APPA_METODOS", "APPA_NAVEGADOR", "APPA_ORCAMENTO_SEG", "APPA_TIMEOUT_API_SEG", "APPA_BROWSER_WS", "APPA_CHROMIUM_PATH", "APPA_SCREENSHOT_URL"]) {
  delete process.env[v];
}

const fixo = (nome: string) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), "utf8");
/** Texto do painel real (markdown que um leitor de páginas devolve), de 03/10/2026. */
const PAINEL_REAL = fixo("appa-painel-real.md");
/** O mesmo painel lido por OCR de uma captura de tela (saída real do Tesseract, modos 4 e 6). */
const OCR_PSM4 = fixo("appa-ocr-psm4.txt");
const OCR_PSM6 = fixo("appa-ocr-psm6.txt");

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
/** 03/10/2026 08:20 em Brasília. */
const AGORA = Date.parse("2026-10-03T11:20:00Z");

/* ============================================================ texto e OCR */

test("texto: HTML vira uma célula por linha, sem script, estilo nem noscript", () => {
  const t = htmlParaTexto(
    `<html><head><title>x</title><style>.a{}</style></head><body><noscript>Ative o JavaScript</noscript>
     <h3>Previsão de Chuvas</h3><table><tr><td>08:00</td><td>0&nbsp;mm</td><td>0%</td></tr></table>
     <p><strong>Atenção</strong>: tempo <b>instável</b></p><script>var a = 1;</script></body></html>`,
  );
  assert.deepEqual(t.split("\n"), ["Previsão de Chuvas", "08:00", "0 mm", "0%", "Atenção: tempo instável"]);
  assert.equal(semHtml("<strong>Atenção</strong>: O tempo&nbsp;muda &amp; piora"), "Atenção: O tempo muda & piora");
});

test("texto: semelhança por palavras ignora formatação (o OCR nunca erra igual ao HTML)", () => {
  const a = "O tempo permanece instável durante a madrugada, com possibilidade de tempestades.";
  const b = "O tempo permanece instavel durante a madrugada com possibilidade de tempestades";
  assert.ok(similaridade(a, b) > 0.95);
  assert.ok(similaridade(a, "Dia de sol e céu limpo em todo o litoral paranaense") < 0.2);
  assert.equal(fmtNum(6.4), "6,4");
  assert.equal(fmtNum(3, 1), "3");
});

test("OCR: repara grau, zero lido como O, nós mal lido e ponto decimal que some", () => {
  // "30onós" era "3.0 nós": o ponto vira "o" e cola na unidade (o parser devolve 3.0 pelo formato do cartão).
  assert.equal(repararOcr("19ºC 30onós 86% 1017"), "19°C 30 nós 86% 1017");
  assert.equal(repararOcr("22:00 O nós ESE"), "22:00 0 nós ESE");
  assert.equal(repararOcr("O8:00 O.2 mm 7O%"), "08:00 0.2 mm 70%");
  assert.equal(repararOcr("10:00 <0.1 mm 3%"), "10:00 < 0.1 mm 3%");
  // Texto corrido (boletim) não leva os reparos de unidade: "5 nos dias" continua igual.
  const corrido = "Há previsão de chuva em 5 nos próximos dias para o litoral do estado e para a região do porto.";
  assert.equal(repararOcr(corrido), corrido);
  // "64 mm" numa hora é ponto decimal perdido ("6.4"): errar para menos é o lado seguro.
  assert.equal(mmDoOcr("64"), 6.4);
  assert.equal(mmDoOcr("6.4"), 6.4);
  assert.equal(mmDoOcr("0"), 0);
});

/* ============================================================ parser */

test("parser: lê o painel real da APPA (cartão do topo, boletins, chuva, vento, marés e sol)", () => {
  const p = parsearPainelSimport(PAINEL_REAL);
  assert.ok(p);
  assert.deepEqual(p.agora, { temperatura: 19, sensacao: 21, umidade: 86, ventoNos: 3, direcao: "W", pressao: 1017 });
  assert.equal(p.chuva.length, 12);
  assert.deepEqual(p.chuva[0], { hora: "08:00", mm: 0, prob: 0 });
  assert.deepEqual(p.chuva[4], { hora: "16:00", mm: 0.1, prob: 31 }, '"< 0.1 mm" vale 0,1');
  assert.equal(p.vento.length, 12);
  assert.deepEqual(p.vento[3], { hora: "14:00", nos: 7, direcao: "E" });
  assert.equal(p.mares.length, 4);
  assert.deepEqual([p.nascerSol, p.porSol], ["04:53", "17:15"]);
  assert.equal(p.boletim.length, 2);
  assert.match(p.boletim[1].texto, /^Atenção: O tempo permanece instável/);
  assert.match(p.boletim[1].texto, /possibilidade de tempestades com atividade elétrica/);
});

test("parser: o mesmo painel lido por OCR (linha de tabela numa linha só) dá os mesmos números", () => {
  for (const texto of [OCR_PSM4, OCR_PSM6]) {
    const p = parsearPainelSimport(texto, { ocr: true });
    assert.ok(p, "OCR lido");
    assert.equal(p.agora.temperatura, 19);
    assert.equal(p.agora.sensacao, 21);
    assert.equal(p.agora.umidade, 86);
    assert.equal(p.agora.pressao, 1017);
    assert.equal(p.agora.ventoNos, 3, '"30onós" era "3.0 nós"');
    assert.equal(p.chuva.length, 12);
    assert.deepEqual(p.chuva[3], { hora: "14:00", mm: 6.4, prob: 92 });
    assert.equal(p.vento.length, 12);
    assert.equal(p.vento[7].nos, 0, '"O nós" era "0 nós"');
    assert.equal(p.mares.length, 4);
    assert.equal(p.nascerSol, "04:53");
    // O boletim quebra em várias linhas na imagem: o parágrafo inteiro tem de voltar (com a tempestade).
    assert.equal(p.boletim.length, 2);
    assert.match(p.boletim[1].texto, /de tempestades com atividade elétrica/);
    assert.ok(leituraUtilOcr(p));
  }
});

test("parser: valores impossíveis (erro de OCR/layout) são descartados e lixo não vira leitura", () => {
  const p = parsearPainelSimport(
    `19°C\nSensação térmica: 21°C\n3.0 nós\nW\n186%\nUmidade\n1017\nPressão\nPrevisão de Chuvas\nHora\n08:00\n0 mm\n0%\n10:00\n999 mm\n3%\n12:00\n0 mm\n180%\nPrevisão de Ventos\n08:00\n3 nós\nW`,
  );
  assert.ok(p);
  assert.equal(p.agora.umidade, null, "186% não existe");
  assert.deepEqual(p.chuva.map((c) => c.hora), ["08:00"], "999 mm e 180% descartados");
  assert.equal(parsearPainelSimport(""), null);
  assert.equal(parsearPainelSimport("Carregando…"), null);
  assert.equal(parsearPainelSimport("erro 500 ".repeat(20)), null);
  assert.equal(leituraCompleta(parsearPainelSimport(PAINEL_REAL)), true);
});

test("parser: data e hora da atualização, quando o painel informa", () => {
  const iso = detectarAtualizacao("Dados atualizados em 03/10/2026 08:45", new Date(AGORA));
  assert.equal(iso, "2026-10-03T11:45:00.000Z");
  assert.equal(detectarAtualizacao("Última atualização às 14:05", new Date(AGORA)), "2026-10-03T17:05:00.000Z");
  assert.equal(detectarAtualizacao("sem data nenhuma aqui", new Date(AGORA)), null);
});

/* ============================================================ normalização */

test("normalização: formato único (fonte, chuva, chuva_forte, tempestade, vento, umidade, pressão, alertas…)", () => {
  const p = parsearPainelSimport(PAINEL_REAL)!;
  const l = normalizarLeitura({ painel: p, metodo: "html", em: new Date(AGORA) });
  assert.equal(l.fonte, "APPA");
  assert.equal(l.timestamp_leitura, new Date(AGORA).toISOString());
  assert.equal(l.metodo_leitura, "html");
  assert.equal(l.status, "sucesso");
  assert.equal(l.temperatura, "19°C");
  assert.equal(l.sensacao_termica, "21°C");
  assert.equal(l.umidade, "86%");
  assert.equal(l.pressao, "1017 hPa");
  assert.equal(l.vento, "3 nós W (6 km/h) · máx. 7 nós às 14:00");
  assert.equal(l.chuva_forte, "não");
  assert.match(l.tempestade ?? "", /^sim · 04\/10, madrugada e manhã · .*tempestades/);
  assert.equal(l.alertas.length, 1);
  assert.match(l.alertas[0], /^04\/10: Atenção: O tempo permanece instável/);
  assert.match(l.chuva ?? "", /sem chuva significativa/);

  // A tela e a API mostram a leitura sem os detalhes internos.
  const publica = leituraPublica(l);
  assert.ok(!("detalhes" in publica));
  assert.deepEqual(
    Object.keys(publica).sort(),
    [
      "alertas", "atualizado_em", "chuva", "chuva_forte", "fonte", "metodo_leitura", "pressao",
      "sensacao_termica", "status", "tempestade", "temperatura", "timestamp_leitura", "umidade", "vento",
    ].sort(),
  );
});

test("normalização: chuva forte pela tabela (mm), pelo ícone do modelo e pelo texto do boletim", () => {
  assert.equal(nivelChuva(0.1), 0);
  assert.equal(nivelChuva(0.2), 1);
  assert.equal(nivelChuva(1), 2);
  assert.equal(nivelChuva(4), 3);

  const base: PainelSimport = {
    boletim: [], chuva: [], vento: [], mares: [], nascerSol: null, porSol: null,
    agora: { temperatura: 20, sensacao: 20, umidade: 80, ventoNos: 4, direcao: "S", pressao: 1015 },
  };
  const tabela = normalizarLeitura({
    painel: {
      ...base,
      chuva: [{ hora: "12:00", mm: 0, prob: 5 }, { hora: "13:00", mm: 0.3, prob: 50 }, { hora: "14:00", mm: 6.4, prob: 92 }],
    },
    metodo: "api",
  });
  assert.equal(tabela.chuva_forte, "sim · 6,4 mm às 14:00");
  assert.match(tabela.chuva ?? "", /^chuva forte prevista a partir das 13:00/);
  assert.equal(tabela.detalhes.chuva.horaForte, "14:00");

  const icone = normalizarLeitura({
    painel: { ...base, chuva: [{ hora: "15:00", mm: 0.5, prob: 60 }] },
    metodo: "api",
    sinais: { chuvaForteHoras: ["15:00"], tempestadeHoras: ["16:00"] },
  });
  assert.match(icone.chuva_forte ?? "", /^sim · 15:00/);
  assert.match(icone.tempestade ?? "", /^sim · 16:00/);

  const texto = normalizarLeitura({
    painel: { ...base, boletim: [{ dia: "05/10", texto: "Há previsão de chuvas fortes no litoral durante a tarde." }] },
    metodo: "html",
  });
  assert.match(texto.chuva_forte ?? "", /^sim · 05\/10, tarde · /);
  assert.equal(texto.alertas.length, 1);

  const chovendo = normalizarLeitura({
    painel: { ...base, chuva: [{ hora: "08:00", mm: 0, prob: 10 }] },
    metodo: "api",
    sinais: { chuvaAgoraMm: 1.4 },
  });
  assert.equal(chovendo.chuva, "chuva moderada agora");
  assert.equal(chovendo.detalhes.chuva.chovendoAgora, true);
});

test("normalização: negação não vira alerta ('sem previsão de tempestades')", () => {
  const t = analisarTextos({
    boletim: [
      { dia: "06/10", texto: "Não há previsão de tempestades nem de chuva forte. O céu permanece nublado." },
      { dia: "07/10", texto: "Dia de sol com poucas nuvens e ventos fracos." },
    ],
    chuva: [], vento: [], mares: [], nascerSol: null, porSol: null,
    agora: { temperatura: null, sensacao: null, umidade: null, ventoNos: null, direcao: null, pressao: null },
  });
  assert.equal(t.tempestade.prevista, false);
  assert.equal(t.chuvaForte.prevista, false);
  assert.deepEqual(t.alertas, []);
});

/* ============================================================ método 1: API */

type Resposta = { corpo: unknown; status?: number };

/** Respostas da API da Simport para a hora simulada (WRF + estação + boletim). */
function apiSimport(opcoes: { chuvaForte?: boolean; estacaoVelha?: boolean; status?: number } = {}) {
  const base = sec("2026-10-03T09:00:00Z"); // 06:00 em Brasília
  const horas = Array.from({ length: 80 }, (_, i) => base + i * 3600);
  const wrf5 = horas.map((t) => {
    const h14 = t === sec("2026-10-03T17:00:00Z"); // 14:00 em Brasília
    return {
      date: { sec: t },
      precipitation: h14 && opcoes.chuvaForte ? 6.4 : 0.03,
      temperature: 19,
      relativeHumidity: 86,
      thermalSensation: 21,
      chanceOfRain: h14 && opcoes.chuvaForte ? 92 : 13,
      icon: h14 && opcoes.chuvaForte ? 1195 : 1006,
    };
  });
  const wrf1 = horas.map((t) => ({ date: { sec: t }, windSpeed: 3.2, windGust: 5, windDirection: 270 }));
  const ap50 = [{
    date: { sec: opcoes.estacaoVelha ? sec("2026-10-01T10:00:00Z") : sec("2026-10-03T11:15:00Z") },
    temperatureAverage: 19.2, thermalSensationAverage: 21.4, humidityAverage: 86, hourlyPrecipitation: 0,
  }];
  const ap10 = [{
    date: { sec: opcoes.estacaoVelha ? sec("2026-10-01T10:00:00Z") : sec("2026-10-03T11:15:00Z") },
    windSpeedAverage: 3, windDirectionAverage: 270,
  }];
  const evento = (data: string, pt: string, ruim = false) => ({
    startDate: { date: `${data} 00:00:00.000000` },
    description: { pt },
    status: { badWeather: ruim },
  });
  const eventos = [
    evento("2026-10-02", "Boletim de ontem, não deve aparecer."),
    evento("2026-10-03", "O dia apresenta céu encoberto e previsão de chuvas fracas e intermitentes."),
    evento("2026-10-04", "<strong>Atenção</strong>: O tempo permanece instável, com possibilidade de tempestades com atividade elétrica.", true),
  ];
  const servir = (url: string): Resposta => {
    if (opcoes.status) return { corpo: { message: "No API token provided." }, status: opcoes.status };
    if (url.includes("/api/calendar")) return { corpo: { events: eventos } };
    if (url.includes("dataGroupId=WRF5")) return { corpo: wrf5 };
    if (url.includes("dataGroupId=WRF1")) return { corpo: wrf1 };
    if (url.includes("dataGroupId=AP50")) return { corpo: url.includes("pressureAverage") ? [] : ap50 };
    if (url.includes("dataGroupId=AP10")) return { corpo: ap10 };
    return { corpo: {}, status: 404 };
  };
  return servir;
}

async function comFetch<T>(servir: (url: string, init?: RequestInit) => Resposta | Promise<Resposta>, fn: () => Promise<T>) {
  const real = globalThis.fetch;
  const chamadas: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    chamadas.push(url);
    const r = await servir(url, init);
    return new Response(typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), {
      status: r.status ?? 200,
      headers: { "content-type": typeof r.corpo === "string" ? "text/html; charset=utf-8" : "application/json" },
    });
  };
  try {
    return { resultado: await fn(), chamadas };
  } finally {
    globalThis.fetch = real;
  }
}

test("método API: monta as mesmas tabelas do painel (2 em 2 h), com a estação e o boletim limpo de HTML", async () => {
  resetarSondaPressao();
  const { resultado: r } = await comFetch(apiSimport({ chuvaForte: true }), () => lerViaApi({ agoraMs: AGORA }));
  const p = r.painel;
  assert.equal(p.chuva.length, 12);
  assert.equal(p.chuva[0].hora, "08:00");
  assert.equal(p.chuva[1].hora, "10:00");
  assert.deepEqual(p.chuva[3], { hora: "14:00", mm: 6.4, prob: 92 });
  assert.equal(p.chuva[0].mm, 0.1, '0,03 mm aparece como "< 0.1 mm" (0,1), como no painel');
  assert.equal(p.vento.length, 12);
  assert.deepEqual(p.vento[0], { hora: "08:00", nos: 3, direcao: "W" });
  assert.equal(p.agora.temperatura, 19.2, "estação do porto");
  assert.equal(p.agora.ventoNos, 3);
  assert.equal(p.agora.direcao, "W");
  assert.equal(p.boletim.length, 2, "o boletim de ontem fica de fora");
  assert.equal(p.boletim[1].dia, "04/10");
  assert.match(p.boletim[1].texto, /^Atenção: O tempo permanece instável/, "sem <strong>");
  assert.deepEqual(r.sinais?.chuvaForteHoras, ["14:00"]);
  assert.ok(r.sinais?.alertas?.some((a) => /04\/10: a APPA marcou tempo ruim/.test(a)));
  assert.equal(r.atualizadoEm, "2026-10-03T11:15:00.000Z", "hora da última medição da estação");
  assert.ok(leituraCompleta(p));
  assert.match(r.resumo, /chuva 12 · vento 12 · boletim 2/);
});

test("método API: estação velha não vira 'agora' (cai para o modelo) e erro de token vem detalhado", async () => {
  resetarSondaPressao();
  const velha = (await comFetch(apiSimport({ estacaoVelha: true }), () => lerViaApi({ agoraMs: AGORA }))).resultado;
  assert.equal(velha.painel.agora.temperatura, 19, "temperatura do modelo WRF, não a da estação de 2 dias atrás");
  assert.equal(velha.sinais?.chuvaAgoraMm, null);

  resetarSondaPressao();
  const erro = await comFetch(apiSimport({ status: 401 }), () => lerViaApi({ agoraMs: AGORA })).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(erro instanceof ErroMetodo);
  assert.match(erro.message, /recusou o token/);
  assert.match(erro.message, /HTTP 401/);
  assert.match(erro.message, /SIMPORT_AUTH_TOKEN/);
});

test("método API: token descoberto no site que deixa de valer é esquecido (volta ao do ambiente)", async () => {
  resetarSondaPressao();
  const doAmbiente = tokenEmUso();
  definirTokenDescoberto("ZZZZ-9999-8888-7777");
  assert.equal(tokenEmUso(), "ZZZZ-9999-8888-7777");
  await comFetch(apiSimport({ status: 401 }), () => lerViaApi({ agoraMs: AGORA })).catch(() => null);
  assert.equal(tokenEmUso(), doAmbiente, "recusado: no próximo ciclo volta a usar SIMPORT_AUTH_TOKEN");
});

test("método API: pressão sondada à parte; falha da sonda nunca derruba a leitura", async () => {
  resetarSondaPressao();
  const servir = apiSimport();
  const comPressao = (url: string): Resposta =>
    url.includes("pressureAverage") ? { corpo: [{ date: { sec: sec("2026-10-03T11:15:00Z") }, pressureAverage: 1013.4 }] } : servir(url);
  const ok = await comFetch(comPressao, () => lerViaApi({ agoraMs: AGORA }));
  assert.equal(ok.resultado.painel.agora.pressao, 1013.4);

  resetarSondaPressao();
  const semPressao = (url: string): Resposta => (url.includes("pressureAverage") ? { corpo: "erro", status: 400 } : servir(url));
  const r = await comFetch(semPressao, () => lerViaApi({ agoraMs: AGORA }));
  assert.equal(r.resultado.painel.agora.pressao, null);
  assert.ok(leituraCompleta(r.resultado.painel));
  // Sonda fracassada: espera algumas horas em vez de insistir a cada ciclo.
  const outra = await comFetch(servir, () => lerViaApi({ agoraMs: AGORA + 60_000 }));
  assert.ok(!outra.chamadas.some((u) => u.includes("pressureAverage")), "não insiste na sonda");
  assert.equal(cardinal(0), "N");
  assert.equal(cardinal(225), "SW");
  assert.equal(cardinal(null), "");
});

test("método API: as mesmas respostas, interceptadas pelo navegador, dão o mesmo painel", () => {
  const servir = apiSimport({ chuvaForte: true });
  const url = (grupo: string) => `https://appa.cs.simport.com.br/api/v2/data?regionId=57&dataGroupId=${grupo}`;
  const dados = dadosSimportDeRespostas([
    { url: url("WRF5"), corpo: servir(url("WRF5")).corpo },
    { url: url("WRF1"), corpo: servir(url("WRF1")).corpo },
    { url: url("AP50"), corpo: servir(url("AP50")).corpo },
    { url: url("AP10"), corpo: servir(url("AP10")).corpo },
    { url: "https://wfa.app.simport.com.br/api/calendar?clientId=appa", corpo: servir("/api/calendar").corpo },
    { url: "https://exemplo.com/outra-coisa.json", corpo: { a: 1 } },
  ]);
  assert.ok(dados);
  const { painel } = painelDeDadosSimport(dados, AGORA);
  assert.equal(painel.chuva.length, 12);
  assert.equal(painel.chuva[3].mm, 6.4);
  assert.equal(painel.boletim.length, 2);
  assert.equal(dadosSimportDeRespostas([{ url: "https://x.com/a", corpo: [] }]), null);
});

/* ============================================================ método 2: HTML */

const URL_PAINEL = "https://weather-appa.app.simport.com.br/";
const CASCA_SPA = `<!doctype html><html lang="pt-BR"><head><title>SIMPORT® - Dashboard Meteoceanográfico</title>
  <script type="module" crossorigin src="/assets/index-abc123.js"></script></head>
  <body><noscript>Você precisa ativar o JavaScript.</noscript><div id="root"></div></body></html>`;

test("método HTML: página montada por JavaScript → 'vazio' com o motivo, sem alarde", async () => {
  const { resultado } = await comFetch(
    (url) => (url.endsWith("/assets/index-abc123.js") ? { corpo: "console.log('sem token aqui')" } : { corpo: CASCA_SPA }),
    () => lerViaHtml({ url: URL_PAINEL, timeoutMs: 8000 }).then(() => null, (e: unknown) => e),
  );
  assert.ok(resultado instanceof ErroMetodo);
  assert.equal(resultado.tipo, "vazio");
  assert.match(resultado.message, /não traz os dados no HTML/);
  assert.match(resultado.message, /montado por JavaScript/);
});

test("método HTML: painel já renderizado no servidor é lido (texto, tabelas e boletim)", async () => {
  const html = `<html><body><h2>19°C</h2><div>Sensação térmica: 21°C</div><div>3.0 nós</div><div>W</div><div>86%</div><div>Umidade</div><div>1017</div><div>Pressão</div>
    <p><b>Dom (04/10)</b>: <strong>Atenção</strong>: tempo instável com possibilidade de tempestades com atividade elétrica.</p>
    <h3>Previsão de Chuvas</h3><table><tr><th>Hora</th><th>Precipit.</th><th>Probabil.</th></tr>
    <tr><td>08:00</td><td>0 mm</td><td>0%</td></tr><tr><td>10:00</td><td>6.4 mm</td><td>92%</td></tr></table>
    <h3>Previsão de Ventos</h3><table><tr><td>08:00</td><td>3 nós</td><td>W</td></tr><tr><td>10:00</td><td>7 nós</td><td>E</td></tr></table></body></html>`;
  const { resultado } = await comFetch(() => ({ corpo: html }), () => lerViaHtml({ url: URL_PAINEL, timeoutMs: 8000 }));
  assert.equal(resultado.painel.agora.temperatura, 19);
  assert.deepEqual(resultado.painel.chuva[1], { hora: "10:00", mm: 6.4, prob: 92 });
  assert.equal(resultado.painel.vento.length, 2);
  assert.match(resultado.painel.boletim[0].texto, /^Atenção: tempo instável/);
  assert.equal(resultado.metodoEfetivo, undefined);
});

test("método HTML: JSON incorporado (__NEXT_DATA__, application/json, window.X) é encontrado", () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"clima":{"temperature":21.5,"relativeHumidity":80,"pressure":1012}}}</script>
    <script type="application/ld+json">{"@type":"WebSite"}</script>
    <script>window.__ESTADO__ = {"umidade":70,"temperatura":22};</script><script>var x = function(){};</script>`;
  const jsons = extrairJsonsEmbutidos(html);
  assert.equal(jsons.length, 3);
  assert.deepEqual(extrairAgoraDeJson(jsons[0]), { temperatura: 21.5, sensacao: null, umidade: 80, pressao: 1012 });
  assert.ok(extrairAgoraDeJson(jsons[2]), "window.X = {...}");
  assert.equal(extrairAgoraDeJson({ nome: "x", valor: 3 }), null, "só vale com 2 ou mais campos plausíveis");
  assert.equal(extrairAgoraDeJson({ temperature: 999, humidity: 500 }), null, "valores impossíveis não contam");
});

test("método HTML: o token da Simport mudou → descobre o novo no código do site e lê a API (sai como 'api')", async () => {
  resetarSondaPressao();
  const servirApi = apiSimport({ chuvaForte: true });
  const TOKEN_NOVO = "AAAA-BBBB-CCCC-DDDD";
  const bundle = `const cabecalhos = {"AUTH-TOKEN":"${TOKEN_NOVO}","Content-Type":"application/json"};`;
  let tokensVistos: string[] = [];
  const { resultado } = await comFetch(
    (url, init) => {
      if (url === URL_PAINEL) return { corpo: CASCA_SPA };
      if (url.endsWith("/assets/index-abc123.js")) return { corpo: bundle };
      const h = new Headers(init?.headers);
      const token = h.get("AUTH-TOKEN") ?? new URL(url).searchParams.get("token") ?? "";
      tokensVistos.push(token);
      // Só o token novo vale: o antigo (do ambiente) é recusado.
      if (token !== TOKEN_NOVO) return { corpo: { message: "Invalid token" }, status: 401 };
      return servirApi(url);
    },
    () => lerViaHtml({ url: URL_PAINEL, timeoutMs: 15_000 }),
  );
  assert.equal(resultado.metodoEfetivo, "api");
  assert.match(resultado.resumo, /token novo descoberto/);
  assert.equal(resultado.painel.chuva.length > 0, true);
  assert.ok(tokensVistos.includes(TOKEN_NOVO));
  assert.deepEqual(descobrirTokens(`x "AUTH-TOKEN": "ZZZZ-1111-2222-3333" y 2CA5-BFD8-0F1C-597F`, "2CA5-BFD8-0F1C-597F"), ["ZZZZ-1111-2222-3333"]);
  // O token descoberto fica na memória: reseta para não vazar para os outros testes.
  definirTokenDescoberto(null);
});

/* ============================================================ método 3: navegador */

/** Página falsa: o painel só "aparece" depois de algumas verificações, como numa SPA de verdade. */
function paginaFalsa(opcoes: {
  texto: string;
  apareceNaVerificacao?: number;
  falhaNavegacoes?: number;
  respostas?: RespostaLike[];
  semScreenshot?: boolean;
}) {
  const log: string[] = [];
  let verificacoes = 0;
  let falhas = opcoes.falhaNavegacoes ?? 0;
  let ouvinte: ((r: RespostaLike) => void) | null = null;
  const pagina: PaginaLike = {
    async goto() {
      log.push("goto");
      if (falhas-- > 0) throw new Error("net::ERR_CONNECTION_RESET");
      for (const r of opcoes.respostas ?? []) ouvinte?.(r);
    },
    async reload() {
      log.push("reload");
    },
    async waitForLoadState(estado) {
      log.push(`espera:${estado}`);
      if (estado === "networkidle") throw new Error("a rede nunca fica ociosa");
    },
    async waitForFunction() {
      verificacoes++;
      log.push(`verifica#${verificacoes}`);
      if (verificacoes < (opcoes.apareceNaVerificacao ?? 1)) throw new Error("Timeout 10000ms exceeded");
      return true;
    },
    async evaluate<T>(expressao: string): Promise<T> {
      if (expressao.includes("scrollTo")) {
        log.push("rolou");
        return 3500 as T;
      }
      if (expressao.includes("innerText.length")) return opcoes.texto.length as T;
      return { texto: opcoes.texto, tabelas: [[["08:00", "0 mm", "0%"]]], cartoes: ["19°C"], titulos: ["Previsão de Chuvas"] } as T;
    },
    async screenshot() {
      log.push("screenshot");
      if (opcoes.semScreenshot) throw new Error("falhou");
      return Buffer.alloc(5000, 1);
    },
    async content() {
      return "<html></html>";
    },
    on(_evento, o) {
      ouvinte = o;
    },
  };
  return {
    log,
    abrir: async () => ({ pagina, descricao: "Chromium falso", fechar: async () => void log.push("fechou") }),
  };
}

test("navegador: espera o painel dinâmico, rola a página, captura texto, tabelas e screenshot, e sempre fecha", async () => {
  const f = paginaFalsa({ texto: PAINEL_REAL, apareceNaVerificacao: 2 });
  const cap = await capturarPagina({ url: URL_PAINEL, timeoutMs: 30_000, screenshot: true, abrir: f.abrir });
  assert.equal(cap.renderizou, true);
  assert.ok(cap.screenshot && cap.screenshot.length === 5000);
  assert.equal(cap.tabelas.length, 1);
  assert.equal(cap.navegador, "Chromium falso");
  assert.ok(f.log.includes("rolou"), "rolou a página para disparar componentes sob demanda");
  assert.ok(f.log.filter((l) => l.startsWith("verifica")).length >= 2, "esperou o conteúdo aparecer antes de desistir");
  assert.ok(f.log.includes("reload"), "recarregou quando o painel não apareceu na 1ª espera");
  assert.equal(f.log.at(-1), "fechou");
  assert.ok(cap.avisos.some((a) => /rede não ficou ociosa/.test(a)));
  const l = lerViaNavegador(cap, AGORA);
  assert.equal(l.painel.chuva.length, 12);
  assert.match(l.resumo, /texto renderizado/);
});

test("navegador: navegação que falha é repetida; nunca declara 'vazio' sem esperar o carregamento", async () => {
  const f = paginaFalsa({ texto: PAINEL_REAL, falhaNavegacoes: 1 });
  const cap = await capturarPagina({ url: URL_PAINEL, timeoutMs: 30_000, screenshot: false, abrir: f.abrir });
  assert.equal(f.log.filter((l) => l === "goto").length, 2);
  assert.equal(cap.screenshot, null);
  assert.ok(cap.avisos.some((a) => /tentativa 1 de abrir a página falhou/.test(a)));

  const sempre = paginaFalsa({ texto: "", falhaNavegacoes: 9 });
  await assert.rejects(
    () => capturarPagina({ url: URL_PAINEL, timeoutMs: 30_000, screenshot: false, abrir: sempre.abrir }),
    (e: unknown) => e instanceof ErroMetodo && /não conseguiu abrir a página/.test(e.message),
  );
  assert.equal(sempre.log.at(-1), "fechou", "fecha o navegador mesmo quando falha");

  // Página que carrega mas nunca mostra o painel: só então é "vazio" (depois de esperar e recarregar).
  const vazia = paginaFalsa({ texto: "Carregando…", apareceNaVerificacao: 99 });
  const capVazia = await capturarPagina({ url: URL_PAINEL, timeoutMs: 40_000, screenshot: true, abrir: vazia.abrir });
  assert.equal(capVazia.renderizou, false);
  assert.ok(vazia.log.includes("reload"));
  assert.throws(
    () => lerViaNavegador(capVazia, AGORA),
    (e: unknown) => e instanceof ErroMetodo && e.tipo === "vazio" && /mesmo após esperar/.test(e.message),
  );
});

test("navegador: respostas JSON (XHR) da página valem mais que o texto e completam o que ele não trouxe", async () => {
  const servir = apiSimport({ chuvaForte: true });
  const resp = (url: string): RespostaLike => ({
    url: () => url,
    status: () => 200,
    headers: () => ({ "content-type": "application/json" }),
    request: () => ({ resourceType: () => "fetch" }),
    json: async () => servir(url).corpo,
  });
  const enderecos = ["WRF5", "WRF1", "AP50", "AP10"].map((g) => `https://appa.cs.simport.com.br/api/v2/data?dataGroupId=${g}`);
  const imagem: RespostaLike = { ...resp("https://x.com/a.png"), request: () => ({ resourceType: () => "image" }) };
  // Texto da tela só com o cartão do topo (as tabelas ainda não montaram): o JSON completa.
  const f = paginaFalsa({
    texto: "19°C\nSensação térmica: 21°C\n3.0 nós\nW\n86%\nUmidade\n1017\nPressão\nOutras coisas da página que não importam aqui\nmais uma linha",
    respostas: [...enderecos.map(resp), resp("https://wfa.app.simport.com.br/api/calendar?x=1"), imagem],
  });
  const cap = await capturarPagina({ url: URL_PAINEL, timeoutMs: 30_000, screenshot: false, abrir: f.abrir });
  assert.equal(cap.json.length, 5, "só XHR/fetch em JSON");
  const l = lerViaNavegador(cap, AGORA);
  assert.equal(l.painel.agora.pressao, 1017, "do texto");
  assert.equal(l.painel.chuva[3].mm, 6.4, "do JSON da página");
  assert.deepEqual(l.sinais?.chuvaForteHoras, ["14:00"]);
  assert.match(l.resumo, /5 resposta\(s\) JSON da página/);
});

test("navegador: escolhe o Chromium na ordem remoto → caminho configurado → serverless → sistema → Playwright", () => {
  const nada = () => false;
  const base = candidatosDeNavegador({}, nada);
  assert.deepEqual(base.map((c) => c.tipo), ["playwright"], "sem nada configurado só sobra o do Playwright");

  const tudo = candidatosDeNavegador(
    { APPA_BROWSER_WS: "wss://chrome.exemplo/?token=x", APPA_CHROMIUM_PATH: "/opt/chrome/chrome", VERCEL: "1" },
    (p) => p === "/usr/bin/chromium",
  );
  assert.deepEqual(tudo.map((c) => c.tipo), ["ws", "exe", "sparticuz", "exe", "playwright"]);
  assert.equal(tudo[1].valor, "/opt/chrome/chrome");
  assert.equal(tudo[3].valor, "/usr/bin/chromium");
  assert.match(tudo[2].valor, /Sparticuz\/chromium\/releases\/download\/v153\.0\.0\/chromium-v153\.0\.0-pack\.x64\.tar$/);
  assert.equal(
    candidatosDeNavegador({ APPA_CHROMIUM_PACK_URL: "https://meu.cdn/pack.tar" }, nada).find((c) => c.tipo === "sparticuz")?.valor,
    "https://meu.cdn/pack.tar",
  );
});

/* ============================================================ método 4: OCR */

test("método OCR: lê a captura de tela, normaliza e exige evidência de sobra", async () => {
  const reconhecer = async (_png: Buffer, psm: "4" | "6") => (psm === "4" ? OCR_PSM4 : OCR_PSM6);
  const r = await lerViaOcr({ screenshot: Buffer.alloc(5000, 1), timeoutMs: 20_000, reconhecedor: { reconhecer } });
  assert.equal(r.painel.chuva.length, 12);
  assert.equal(r.painel.agora.pressao, 1017);
  assert.match(r.resumo, /lido por OCR/);
  assert.ok(leituraCompleta(r.painel));

  // Sem imagem: indisponível, com o motivo.
  await assert.rejects(
    () => lerViaOcr({ screenshot: null, timeoutMs: 5000, motivoSemImagem: "navegador indisponível" }),
    (e: unknown) => e instanceof ErroMetodo && e.tipo === "indisponivel" && /navegador indisponível/.test(e.message),
  );
  // Imagem sem o painel (OCR leu outra coisa): vazio.
  await assert.rejects(
    () =>
      lerViaOcr({
        screenshot: Buffer.alloc(5000, 1),
        timeoutMs: 20_000,
        reconhecedor: { reconhecer: async () => "Página não encontrada\nOops! Page not found\nVoltar para a página inicial\n".repeat(4) },
      }),
    (e: unknown) => e instanceof ErroMetodo && e.tipo === "vazio",
  );
});

/* ============================================================ orquestrador */

const painelMinimo = (): PainelSimport => parsearPainelSimport(PAINEL_REAL)!;
const saida = (extra: Partial<SaidaMetodo> = {}): SaidaMetodo => ({ painel: painelMinimo(), resumo: "chuva 12 · vento 12", ...extra });
const falha = (msg: string, tipo: "falhou" | "vazio" | "indisponivel" = "falhou"): ExecutorMetodo => async () => {
  throw new ErroMetodo(msg, tipo);
};

test("fallback: a ordem é API → HTML → navegador → OCR → Composio e para no primeiro que funciona", async () => {
  assert.deepEqual([...ORDEM_METODOS], ["api", "html", "playwright", "ocr", "composio"]);
  const chamados: MetodoLeitura[] = [];
  const quem = (m: MetodoLeitura, ok: boolean): ExecutorMetodo => async () => {
    chamados.push(m);
    if (!ok) throw new ErroMetodo(`${m} falhou`, "vazio");
    return saida();
  };
  const r = await lerPainelAppa({
    // Passados fora de ordem de propósito: a ordem do fallback é sempre a mesma.
    executores: { composio: quem("composio", true), ocr: quem("ocr", true), playwright: quem("playwright", true), html: quem("html", false), api: quem("api", false) },
  });
  assert.deepEqual(chamados, ["api", "html", "playwright"]);
  assert.equal(r.status, "sucesso");
  assert.equal(r.metodo, "playwright");
  assert.equal(r.leitura?.metodo_leitura, "playwright");
  assert.deepEqual(r.tentativas.map((t) => [t.metodo, t.resultado]), [["api", "vazio"], ["html", "vazio"], ["playwright", "sucesso"]]);
  assert.equal(r.erro, null);
});

test("fallback: Composio vazio/erro/timeout nunca é falha — a leitura segue e o erro só aparece com TODOS falhando", async () => {
  // O caso do relatório: o Composio devolve results vazio, mas a API responde.
  const r1 = await lerPainelAppa({
    executores: {
      api: async () => saida(),
      composio: falha("Composio não devolveu texto das páginas (results vazio)", "vazio"),
    },
  });
  assert.equal(r1.status, "sucesso");
  assert.equal(r1.metodo, "api");
  assert.equal(r1.erro, null);
  assert.ok(!r1.tentativas.some((t) => t.metodo === "composio"), "nem chega a perguntar ao Composio");

  // API fora do ar e Composio vazio: o próximo método assume em silêncio.
  const r2 = await lerPainelAppa({
    executores: {
      api: falha("HTTP 503"),
      html: falha("página sem dados no HTML", "vazio"),
      playwright: falha("nenhum navegador disponível", "indisponivel"),
      ocr: falha("sem captura de tela", "indisponivel"),
      composio: falha("Composio não devolveu texto das páginas (results vazio)", "vazio"),
    },
    metodos: ["api", "html", "composio"],
  });
  assert.equal(r2.status, "erro", "só os métodos ligados contam; todos falharam");
  assert.equal(r2.leitura, null);

  // Composio funcionando como método adicional: vira a leitura "composio".
  const r3 = await lerPainelAppa({
    executores: {
      api: falha("HTTP 503"),
      html: falha("vazio", "vazio"),
      playwright: falha("sem navegador", "indisponivel"),
      ocr: falha("sem imagem", "indisponivel"),
      composio: async () => saida(),
    },
  });
  assert.equal(r3.status, "sucesso");
  assert.equal(r3.metodo, "composio");
  assert.equal(r3.leitura?.metodo_leitura, "composio");
});

test("fallback: se TODOS falham, o erro detalhado lista cada método e o log tem uma linha por tentativa", async () => {
  const linhas: string[] = [];
  const r = await lerPainelAppa({
    log: (l) => linhas.push(l),
    executores: {
      api: falha("a Simport recusou o token (HTTP 401)"),
      html: falha("a página não traz os dados no HTML", "vazio"),
      playwright: falha("nenhum navegador disponível", "indisponivel"),
      ocr: falha("sem captura de tela para o OCR", "indisponivel"),
      composio: falha("Composio não devolveu texto das páginas (results vazio)", "vazio"),
    },
  });
  assert.equal(r.status, "erro");
  assert.equal(r.metodo, null);
  assert.equal(r.leitura, null);
  assert.match(r.erro ?? "", /^Nenhum método conseguiu ler o painel da APPA/);
  for (const trecho of ["API: a Simport recusou o token", "HTML direto: a página não traz", "Navegador automático: nenhum navegador", "OCR: sem captura", "Composio: Composio não devolveu texto"]) {
    assert.ok((r.erro ?? "").includes(trecho), `erro cita "${trecho}"`);
  }
  assert.equal(r.tentativas.length, 5);
  assert.equal(linhas.length, 5, "uma linha de log por tentativa");
  assert.deepEqual(linhas, r.tentativas.map((t) => t.linha));
  // Formato: [HH:MM:SS] APPA · #N Método · RESULTADO · duração · detalhe
  assert.match(linhas[0], /^\[\d{2}:\d{2}:\d{2}\] APPA · #1 API · FALHOU · \d+ ms · a Simport recusou o token/);
  assert.match(linhas[2], /^\[\d{2}:\d{2}:\d{2}\] APPA · #3 Navegador automático · INDISPONÍVEL/);
  assert.match(linhas[4], /#5 Composio · VAZIO/);
  assert.match(
    formatarLinhaLog({ ordem: 2, metodo: "html", inicio: "2026-10-03T12:15:02.000Z", duracaoMs: 1234, resultado: "sucesso", detalhe: "chuva 12" }),
    /^\[09:15:02\] APPA · #2 HTML direto · SUCESSO · 1,2 s · chuva 12$/,
  );
});

test("fallback: método que trava é cortado no prazo e o próximo assume (nada trava o ciclo)", async () => {
  process.env.APPA_TIMEOUT_API_SEG = "2";
  try {
    const inicio = Date.now();
    const r = await lerPainelAppa({
      executores: {
        api: () => new Promise<SaidaMetodo>(() => undefined), // nunca responde
        html: async () => saida(),
      },
    });
    assert.equal(r.metodo, "html");
    assert.equal(r.tentativas[0].resultado, "falhou");
    assert.match(r.tentativas[0].detalhe, /tempo esgotado/);
    assert.ok(Date.now() - inicio < 6000, "cortou a API em ~2 s (+ folga), não esperou para sempre");
  } finally {
    delete process.env.APPA_TIMEOUT_API_SEG;
  }
});

test("fallback: orçamento do ciclo esgotado pula os métodos restantes e diz por quê", async () => {
  const r = await lerPainelAppa({
    orcamentoMs: 1000,
    executores: {
      api: async () => {
        await new Promise((res) => setTimeout(res, 1100));
        throw new ErroMetodo("lento demais", "falhou");
      },
      html: async () => saida(),
    },
  });
  assert.equal(r.status, "erro");
  const html = r.tentativas.find((t) => t.metodo === "html");
  assert.equal(html?.resultado, "pulado");
  assert.match(html?.detalhe ?? "", /orçamento de tempo/);
});

test("fallback: caminho leve (app aberto) só tenta API e HTML, sem fazer barulho no log", async () => {
  const chamados: string[] = [];
  const quem = (m: string): ExecutorMetodo => async () => {
    chamados.push(m);
    throw new ErroMetodo("sem dados", "vazio");
  };
  const r = await lerPainelAppa({
    leve: true,
    executores: { api: quem("api"), html: quem("html"), playwright: quem("playwright"), ocr: quem("ocr"), composio: quem("composio") },
  });
  assert.deepEqual(chamados, ["api", "html"]);
  assert.equal(r.tentativas.length, 2);
  assert.equal(r.status, "erro");
});

test("fallback: leitura parcial (só o tempo de agora) segue para os outros métodos e vale se nenhum trouxer a previsão", async () => {
  const soAgora: PainelSimport = { ...painelMinimo(), chuva: [], vento: [], boletim: [], mares: [] };
  const r = await lerPainelAppa({
    executores: {
      api: async () => saida({ painel: soAgora, resumo: "agora" }),
      html: falha("vazio", "vazio"),
      playwright: falha("sem navegador", "indisponivel"),
      ocr: falha("sem imagem", "indisponivel"),
      composio: falha("vazio", "vazio"),
    },
  });
  assert.equal(r.status, "parcial");
  assert.equal(r.metodo, "api");
  assert.equal(r.leitura?.status, "parcial");
  assert.equal(r.tentativas[0].resultado, "parcial");
  assert.equal(r.tentativas.length, 5, "tentou os outros métodos atrás da previsão completa");
  assert.equal(r.erro, null);

  // Se um método seguinte traz a previsão completa, ele é quem vale.
  const r2 = await lerPainelAppa({
    executores: { api: async () => saida({ painel: soAgora }), html: async () => saida() },
  });
  assert.equal(r2.status, "sucesso");
  assert.equal(r2.metodo, "html");
});

test("fallback: o navegador abre UMA vez e o OCR reaproveita a mesma captura de tela", async () => {
  // Texto que a página mostra mas o leitor de texto não reconhece (ex.: painel desenhado em gráfico).
  const f = paginaFalsa({ texto: "gráfico desenhado em canvas, sem texto que o leitor reconheça. ".repeat(4) });
  let aberturas = 0;
  let imagemLida = 0;
  const r = await lerPainelAppa({
    metodos: ["playwright", "ocr"],
    abrirNavegador: async () => {
      aberturas++;
      return f.abrir();
    },
    reconhecedorOcr: {
      reconhecer: async (png) => {
        imagemLida = png.length;
        return OCR_PSM4;
      },
    },
  });
  assert.equal(aberturas, 1, "um navegador só para os dois métodos");
  assert.ok(imagemLida > 0, "o OCR leu a imagem da captura do navegador");
  assert.deepEqual(r.tentativas.map((t) => [t.metodo, t.resultado]), [["playwright", "vazio"], ["ocr", "sucesso"]]);
  assert.equal(r.metodo, "ocr");
  assert.equal(r.leitura?.metodo_leitura, "ocr");
  assert.equal(r.leitura?.pressao, "1017 hPa");
  assert.match(r.tentativas[0].detalhe, /não mostrou dados do painel/);

  // Sem navegador (nenhum Chromium neste ambiente), o OCR diz por quê e o ciclo termina sem travar.
  const semNavegador = await lerPainelAppa({
    metodos: ["playwright", "ocr"],
    abrirNavegador: async () => {
      throw new ErroMetodo("nenhum navegador disponível — configure APPA_CHROMIUM_PATH", "indisponivel");
    },
  });
  assert.equal(semNavegador.status, "erro");
  assert.equal(semNavegador.tentativas[0].resultado, "indisponivel");
  assert.match(semNavegador.tentativas[1].detalhe, /sem captura de tela/);
  assert.match(semNavegador.tentativas[1].detalhe, /nenhum navegador disponível/);
});

test("configuração: métodos ligados, ordem fixa e prazos", () => {
  assert.deepEqual(metodosLigados({}), ["api", "html", "playwright", "ocr", "composio"]);
  assert.deepEqual(metodosLigados({ APPA_METODOS: "composio, api" }), ["api", "composio"], "a ordem do fallback não muda");
  assert.deepEqual(metodosLigados({ APPA_NAVEGADOR: "0" }), ["api", "html", "composio"]);
  assert.deepEqual(metodosLigados({ APPA_METODOS: "lixo" }), ["api", "html", "playwright", "ocr", "composio"]);
  const c = configLeitor({});
  assert.equal(c.timeouts.api, 10_000);
  assert.equal(c.orcamentoMs, 32_000);
  assert.equal(c.orcamentoLeveMs, 7_000);
  assert.ok(c.orcamentoLeveMs <= 10_000, "o caminho do app aberto não pode segurar a resposta");
  assert.equal(configLeitor({ APPA_ORCAMENTO_SEG: "20" }).orcamentoMs, 20_000);
  assert.equal(configLeitor({ APPA_TIMEOUT_API_SEG: "999" }).timeouts.api, 30_000, "valor absurdo é limitado");
});

test("o Composio não é mais o único responsável: o código não depende só dele", () => {
  const radar = readFileSync("src/lib/clima-monitor.ts", "utf8");
  assert.ok(!/painelSimportComposio/.test(radar), "o radar não chama mais o Composio direto para o painel");
  assert.ok(radar.includes("lerPainelAppa"), "o radar lê o painel pelo orquestrador de métodos");
  const cartao = readFileSync("src/components/admin/CartaoRadarPrevisaoAdmin.tsx", "utf8");
  assert.ok(!/ainda não lido pelo Composio/.test(cartao), "a mensagem antiga saiu da tela");
  assert.ok(!/lido pelo Composio em/.test(cartao));
  assert.ok(!/O Composio não conseguiu ler o painel/.test(cartao), "falha do Composio não aparece como falha do painel");
  assert.match(cartao, /Método de leitura/);
  assert.match(cartao, /Log de diagnóstico/);
});
