import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  LIMIARES,
  assinaturaDoDia,
  configRadar,
  detectarMudancas,
  montarInstantaneo,
  normalizarTexto,
  parsearPainelSimport,
  resetarTickRadar,
  textoMudancaPadrao,
  tickRadar,
  type InstantaneoClima,
  type PainelSimport,
} from "../src/lib/clima-monitor";
import type { Previsao } from "@/lib/tempo";

/**
 * RADAR DA PREVISÃO — monitoramento constante do tempo (SIMPORT®/APPA).
 *
 * O painel da APPA é lido pelo servidor com fallback automático (API → HTML →
 * navegador → OCR → Composio): o Composio devolver vazio não para o radar. Os
 * testes da leitura em si estão em tests/appa-leitor.test.ts e os eventos do
 * painel normalizado (chuva forte, tempestade, alertas…) em tests/appa-radar.test.ts.
 *
 * Os primeiros testes são puros (configuração, leitura do painel da Simport,
 * comparação de instantâneos e texto do aviso) e rodam sempre: não acessam a
 * rede nem o banco.
 *
 * O teste de ponta a ponta (radar → chat → Push) roda SOMENTE num PostgreSQL
 * local descartável fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_exemplo \
 *   ./node_modules/.bin/tsx --test tests/clima-monitor.test.ts
 * A Simport e o Composio são simulados (fetch substituído) e o Push nunca sai
 * de verdade.
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

/* ------------------------------------------------------------- fixações */

/** Texto (markdown) do painel SIMPORT® da APPA, no formato que o Composio devolve. */
const PAINEL = `## 17°C

Sensação térmica: 18°C

0.0 nós

SSE

90%

Umidade

1016

Pressão

**Sex (02/10)**: Há possibilidade de chuva fraca durante a madrugada. No restante do dia, o céu permanece encoberto, com nova possibilidade de chuva fraca entre o final da tarde e a noite.

**Sáb (03/10)**: O dia apresenta céu encoberto e previsão de chuvas fracas e intermitentes, especialmente durante a madrugada e a manhã. Os ventos apresentam direção variável, de SW/E, com intensidade fraca a moderada.

## Previsões Detalhadas

### Previsão de Chuvas

Hora

Condição

Precipit.

Probabil.

23:00

0.2 mm

72%

01:00

< 0.1 mm

31%

05:00

0 mm

0%

09:00

< 0.1 mm

16%

13:00

0.1 mm

47%

Próximas 24 horas

### Previsão de Ventos

Hora

Velocidade

Direção

23:00

3 nós

SSW

05:00

3 nós

WSW

09:00

7 nós

E

13:00

7 nós

ENE

Próximas 24 horas

Direção do vento durante o dia

23:00

SSW

05:00

WSW

11:00

E

17:00

E

### Mapa de Localizações

Paranaguá

17°C

Antonina

17°C

+–

⇧

i

Paranaguá

Lat: -25.52, Lon: -48.52

### Dados Oceanográficos

#### Previsão de Marés

Paranaguá

02:001.2mAlta

05:100.5mBaixa

08:401.5mAlta

11:400.9mBaixa

### Fases da Lua

🌔

Minguante Gibosa55.53% iluminação

Nascer do Sol

04:54

Pôr do Sol

17:15`;

/** Painel igual ao anterior, mas com a previsão revisada (chuva e vento maiores). */
const PAINEL_MUDADO = PAINEL.replace("0.1 mm\n\n47%", "6.4 mm\n\n92%").replace("7 nós\n\nENE", "28 nós\n\nENE");

/* ----------------------------------------------------------- instantâneo */
function previsao(opcoes: { chance?: number; rajada?: number; mm?: number; gravidade?: number } = {}): Previsao {
  const chance = opcoes.chance ?? 10;
  const rajada = opcoes.rajada ?? 18;
  const mm = opcoes.mm ?? 0;
  const base = Math.floor(Date.now() / 1000);
  const horas = Array.from({ length: 30 }, (_, i) => ({
    ts: base + i * 3600,
    hora: `${String((i + new Date().getHours()) % 24).padStart(2, "0")}h`,
    dia: "2026-10-02",
    temperatura: 20 + (i % 6),
    sensacao: 20 + (i % 6),
    umidade: 80,
    chanceChuva: chance,
    chuvaMm: mm,
    ventoKmh: Math.round(rajada * 0.6),
    rajadaKmh: rajada,
    ventoGraus: 135,
    ventoDirecao: "SE",
    icone: (opcoes.gravidade === 5 ? "chuva" : "sol-nuvem") as Previsao["horas"][number]["icone"],
    descricao: opcoes.gravidade === 5 ? "Chuva" : "Parcialmente nublado",
  }));
  const dia = (max: number, min: number) => ({
    data: "2026-10-02",
    rotulo: "Hoje",
    dataCurta: "2 de outubro",
    max,
    min,
    chuvaMm: mm,
    chanceChuva: chance,
    icone: (opcoes.gravidade === 5 ? "chuva" : "sol-nuvem") as Previsao["dias"][number]["icone"],
    descricao: opcoes.gravidade === 5 ? "Chuva" : "Parcialmente nublado",
    fonte: "simport" as const,
    temHoras: true,
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
      rajadaKmh: rajada,
      ventoDirecao: "SE",
      ventoGraus: 135,
      chuva24h: 0,
      icone: "sol-nuvem",
      descricao: "Parcialmente nublado",
      hora: "06:00",
      fonte: "estacao",
    },
    alerta: { nivel: "tempo-bom", titulo: "Tempo firme", texto: "Sem chuva prevista." },
    boletim: [{ data: "2026-10-02", texto: "Sol com nuvens no porto.", tempoRuim: false }],
    horas,
    dias: [dia(26, 17), { ...dia(25, 16), data: "2026-10-03", rotulo: "Amanhã" }],
    nascerSol: "04:54",
    porSol: "17:15",
    atualizadoEm: new Date().toISOString(),
    fontes: { simport: true, estacao: true, openMeteo: true, composio: false },
  };
}

const instantaneo = (
  opcoes: { chance?: number; rajada?: number; mm?: number; gravidade?: number; painel?: PainelSimport | null } = {},
  em = Date.now(),
): InstantaneoClima =>
  montarInstantaneo(
    previsao({ chance: opcoes.chance, rajada: opcoes.rajada, mm: opcoes.mm, gravidade: opcoes.gravidade }),
    opcoes.painel ?? null,
    em,
  );

/* ------------------------------------------------------------ puros */

test("radar: configuração padrão (5 min, painel lido a cada ciclo, sensibilidade média)", () => {
  const c = configRadar({} as Record<string, string>);
  assert.equal(c.ativo, true);
  assert.equal(c.sensibilidade, "media");
  assert.equal(c.intervaloMs, 5 * 60_000);
  assert.equal(c.painelMs, 5 * 60_000, "o painel é relido a cada ciclo do radar");
  assert.equal(c.avisoMinMs, 20 * 60_000);
  assert.equal(c.maxPorHora, 3);

  assert.equal(configRadar({ CLIMA_MONITOR_ATIVO: "0" } as Record<string, string>).ativo, false);
  assert.equal(configRadar({ CLIMA_MONITOR_MIN: "2" } as Record<string, string>).intervaloMs, 120_000);
  assert.equal(configRadar({ CLIMA_MONITOR_SENSIBILIDADE: "alta" } as Record<string, string>).sensibilidade, "alta");
  // Valores zerados ou inválidos não derrubam o radar: valem os padrões.
  assert.equal(configRadar({ CLIMA_MONITOR_MIN: "0" } as Record<string, string>).intervaloMs, 300_000);
});

test("radar: lê o painel da Simport (boletim, chuva, vento, marés e sol)", () => {
  const p = parsearPainelSimport(PAINEL);
  assert.ok(p, "painel lido");
  assert.equal(p.agora.temperatura, 17);
  assert.equal(p.agora.sensacao, 18);
  assert.equal(p.agora.umidade, 90);
  assert.equal(p.agora.ventoNos, 0);
  assert.equal(p.agora.direcao, "SSE");
  assert.equal(p.agora.pressao, 1016);

  assert.equal(p.chuva.length, 5);
  assert.deepEqual(p.chuva[0], { hora: "23:00", mm: 0.2, prob: 72 });
  assert.equal(p.chuva[2].mm, 0);
  assert.equal(p.chuva[4].prob, 47);

  assert.equal(p.vento.length, 4);
  assert.equal(p.vento[0].nos, 3);
  assert.equal(p.vento[0].direcao, "SSW");
  assert.equal(p.vento[3].nos, 7);

  assert.equal(p.mares.length, 4);
  assert.deepEqual(p.mares[0], { hora: "02:00", altura: 1.2, tipo: "alta" });
  assert.deepEqual(p.mares[1], { hora: "05:10", altura: 0.5, tipo: "baixa" });

  assert.equal(p.nascerSol, "04:54");
  assert.equal(p.porSol, "17:15");

  assert.equal(p.boletim.length, 2);
  assert.equal(p.boletim[0].dia, "02/10");
  assert.match(p.boletim[0].texto, /possibilidade de chuva fraca/i);
  assert.equal(p.boletim[1].dia, "03/10");

  // Lixo ou resposta vazia do Composio não derruba o radar.
  assert.equal(parsearPainelSimport(""), null);
  assert.equal(parsearPainelSimport("erro 500"), null);
});

test("radar: detecta a mudança de chuva e vento entre dois instantâneos", () => {
  const antes = instantaneo({ chance: 10, rajada: 18, mm: 0 });
  const depois = instantaneo({ chance: 75, rajada: 52, mm: 6.5, gravidade: 5 }, Date.now() + 60_000);
  const m = detectarMudancas(antes, depois, "media");
  const tipos = m.map((x) => x.tipo);
  assert.ok(tipos.includes("chuva"), "mudança de chuva detectada");
  assert.ok(tipos.includes("vento"), "mudança de vento detectada");
  assert.ok(tipos.includes("condicao"), "mudança da condição do tempo detectada");
  // Chuva forte entrando é grave: a notificação fica na tela até o motorista tocar.
  assert.ok(m.some((x) => x.grave));
  const chuva = m.find((x) => x.tipo === "chuva");
  assert.ok(chuva?.frase.includes("10%"));
  assert.ok(chuva?.frase.includes("75%"));
  assert.match(chuva?.assinatura ?? "", /^chuvaProb6h:/);
});

test("radar: abaixo do limite da sensibilidade não avisa (antispam)", () => {
  const antes = instantaneo({ chance: 30, rajada: 20 });
  const depois = instantaneo({ chance: 45, rajada: 28 }, Date.now() + 60_000);
  assert.equal(detectarMudancas(antes, depois, "media").length, 0, "média ignora 15 pontos de chance");
  assert.ok(detectarMudancas(antes, depois, "alta").length > 0, "alta pega 15 pontos");
  assert.equal(detectarMudancas(antes, depois, "baixa").length, 0);
  // Nada mudou: nada a avisar.
  assert.equal(detectarMudancas(antes, antes, "alta").length, 0);
  // Sem o WRF da APPA nas duas leituras, não aparece mudança de "próximas 24 h".
  const semApi = (i: InstantaneoClima): InstantaneoClima => ({ ...i, api: null });
  const semWrf = detectarMudancas(semApi(antes), semApi(depois), "alta");
  assert.ok(!semWrf.some((m) => /próximas 24 h/.test(m.rotulo)), "sem WRF não há mudança horária");
});

test("radar: mudança no painel lido pelo Composio também vira aviso", () => {
  const p1 = parsearPainelSimport(PAINEL);
  const p2 = parsearPainelSimport(PAINEL_MUDADO);
  assert.ok(p1 && p2);
  const antes = montarInstantaneo(null, p1, Date.now());
  const depois = montarInstantaneo(null, p2, Date.now() + 60_000);
  assert.equal(antes.api, null, "sem API estruturada neste teste");
  const m = detectarMudancas(antes, depois, "media");
  assert.ok(m.length >= 1, "o painel sozinho sustenta o radar");
  assert.ok(m.every((x) => x.origem === "painel"));
  assert.ok(m.some((x) => x.tipo === "chuva"));
  assert.ok(m.some((x) => x.tipo === "vento"));
});

test("radar: boletim da APPA novo ou revisado entra no aviso", () => {
  const antes = montarInstantaneo(
    { ...previsao(), boletim: [{ data: "2026-10-02", texto: "Sol com nuvens.", tempoRuim: false }] },
    null,
  );
  const depois = montarInstantaneo(
    {
      ...previsao(),
      boletim: [{ data: "2026-10-02", texto: "Chuva forte e vento no porto.", tempoRuim: true }],
    },
    null,
    Date.now() + 60_000,
  );
  const m = detectarMudancas(antes, depois, "media");
  const boletins = m.filter((x) => x.tipo === "boletim");
  assert.ok(boletins.length >= 1, "revisão do boletim detectada");
  assert.ok(boletins.some((x) => x.grave), "tempo ruim é grave");
  assert.ok(
    boletins.some((x) => /^boletim:2026-10-02:/.test(x.assinatura)),
    "assinatura por dia do boletim",
  );
  assert.ok(
    boletins.some((x) => x.assinatura.startsWith("boletimRuim:")),
    "liga/desliga do alerta de tempo ruim",
  );
  // Um dia novo de boletim também avisa (assinatura própria).
  const novoDia = montarInstantaneo(
    {
      ...previsao(),
      boletim: [
        { data: "2026-10-02", texto: "Chuva forte e vento no porto.", tempoRuim: true },
        { data: "2026-10-03", texto: "Tempo firme pela manhã.", tempoRuim: false },
      ],
    },
    null,
    Date.now() + 120_000,
  );
  assert.ok(detectarMudancas(depois, novoDia, "media").some((x) => x.rotulo.includes("2026-10-03")));
});

test("radar: texto do aviso usa só dados reais, no formato ALERTA METEOROLÓGICO, e cabe numa notificação", () => {
  const antes = instantaneo({ chance: 10, rajada: 18 });
  const depois = instantaneo({ chance: 75, rajada: 52, mm: 6.5, gravidade: 5 }, Date.now() + 60_000);
  const m = detectarMudancas(antes, depois, "media");
  const t = textoMudancaPadrao(m, previsao({ chance: 75, rajada: 52, mm: 6.5, gravidade: 5 }));
  const linhas = t.split("\n");
  assert.equal(linhas[0], "🌧️ ALERTA METEOROLÓGICO");
  assert.equal(linhas[2], "Foi identificada uma mudança na previsão meteorológica da região do Porto de Paranaguá.");
  assert.match(t, /\nCondição: chuva \+ vento\n/, "a chuva e o vento mudaram juntos");
  assert.match(t, /\nHorário: \d{2}:00\n/, "o horário vem da hora da maior chance de chuva do modelo");
  assert.match(t, /75%/);
  assert.equal(linhas.at(-1), "Fonte: SIMPORT® / APPA");
  assert.ok(t.length <= 480, "cabe no corpo da notificação");
  // Mudança de vento escolhe o emoji de vento quando é o único assunto.
  const soVento = detectarMudancas(instantaneo({ rajada: 18 }), instantaneo({ rajada: 52 }, Date.now() + 1000), "media");
  assert.match(textoMudancaPadrao(soVento, null), /💨 ALERTA METEOROLÓGICO/);
  assert.match(textoMudancaPadrao(soVento, null), /Condição: vento/);
});

test("composio: extrai o texto da resposta e descreve quando vem vazio", async () => {
  const { descreverResposta, extrairTexto } = await import("../src/lib/composio");
  // Formatos diferentes que a mesma ferramenta pode devolver.
  assert.equal(extrairTexto({ text: "conteúdo" }), "conteúdo");
  assert.equal(extrairTexto({ content: "outro" }), "outro");
  assert.equal(extrairTexto({ markdown: "# t" }), "# t");
  assert.equal(extrairTexto({ url: "x", data: { text: "aninhado" } }), "aninhado");
  assert.equal(extrairTexto({ url: "x", text: "  " }), "");
  assert.equal(extrairTexto(null), "");
  // Resumo usado no diagnóstico do painel (sem segredo nenhum).
  assert.match(descreverResposta({ data: { results: [] } }), /results vazio/);
  assert.match(descreverResposta({ data: { results: [{ url: "x", text: "" }] } }), /results\[0\]/);
  assert.match(descreverResposta(undefined), /resposta vazia/);
});

test("radar: a medição PELO COMPOSIO (OpenWeather) também entra na comparação", () => {
  const cc = {
    temperatura: 21, sensacao: 21, umidade: 80, ventoKmh: 14, rajadaKmh: 24,
    ventoGraus: 135, nuvens: 40, codigo: 802, descricao: "nuvens dispersas",
    medidoEm: Math.floor(Date.now() / 1000),
  };
  const ccDepois = { ...cc, temperatura: 29, rajadaKmh: 62, umidade: 96, codigo: 501, descricao: "chuva moderada" };
  const antes = montarInstantaneo(null, null, Date.now(), cc);
  const depois = montarInstantaneo(null, null, Date.now() + 60_000, ccDepois);
  assert.equal(antes.composioAgora?.temperatura, 21);
  assert.equal(depois.composioAgora?.gravidade, 5, "código de chuva do OpenWeather");
  const m = detectarMudancas(antes, depois, "media");
  assert.ok(m.length >= 3, "temperatura, rajada e condição pelo Composio");
  assert.ok(m.every((x) => x.origem === "composio"));
  assert.ok(m.some((x) => x.rotulo.includes("Temperatura pelo Composio")));
  assert.ok(m.some((x) => x.grave), "rajada e chuva entrando são graves");
  // Sem o Composio nas duas leituras, nada muda.
  assert.equal(detectarMudancas(montarInstantaneo(null, null), montarInstantaneo(null, null), "alta").length, 0);
});

test("radar: a assinatura vale por bloco de 3 h (a mesma mudança pode voltar)", () => {
  const antes = instantaneo({ chance: 10 });
  const depois = instantaneo({ chance: 80 }, Date.now() + 60_000);
  const m = detectarMudancas(antes, depois, "media")[0];
  assert.ok(m);
  const manha = new Date("2026-10-02T09:00:00-03:00");
  const tarde = new Date("2026-10-02T15:00:00-03:00");
  assert.equal(assinaturaDoDia(m, manha), assinaturaDoDia(m, new Date("2026-10-02T10:30:00-03:00")));
  assert.notEqual(assinaturaDoDia(m, manha), assinaturaDoDia(m, tarde));
  assert.match(assinaturaDoDia(m, manha), /^2026-10-02:b\d+:/);
});

test("radar: normaliza texto do boletim (espaço, caixa e pontuação)", () => {
  assert.equal(normalizarTexto("  Sol   com nuvens. "), "sol com nuvens");
  assert.equal(normalizarTexto("Chuva fraca"), normalizarTexto("chuva fraca"));
  // Limiares por sensibilidade: quanto mais alta, menor o limite.
  assert.ok(LIMIARES.alta.chuvaProb < LIMIARES.media.chuvaProb);
  assert.ok(LIMIARES.media.chuvaProb < LIMIARES.baixa.chuvaProb);
});

/* ------------------------------------------------- ponta a ponta (banco) */

const CASCA_SPA = `<!doctype html><html><head><title>SIMPORT® - Dashboard Meteoceanográfico</title>
<script type="module" src="/assets/index-x.js"></script></head><body><div id="root"></div></body></html>`;

type Cenario = { chance: number; rajada: number; mm: number; gravidade: number };

/**
 * Simula a internet do radar: API da Simport (previsão e painel), o site da
 * APPA (uma SPA vazia, como o de verdade para quem não roda JavaScript) e o
 * Composio. `ctrl` muda o comportamento no meio do teste.
 */
function instalarRede() {
  const ctrl = {
    cenario: { chance: 10, rajada: 18, mm: 0, gravidade: 0 } as Cenario,
    /** false = a API da Simport responde 503. */
    apiNoAr: true,
    /** O que o Composio devolve ao ler o painel: "vazio" é o caso real (results: []). */
    composio: "vazio" as "vazio" | "texto",
    painelTexto: PAINEL,
    chamadasComposioPainel: 0,
  };
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    // Composio: a leitura do painel volta vazia (ou com o texto) e o Gemini nunca responde.
    if (url.includes("backend.composio.dev")) {
      if (url.includes("COMPOSIO_SEARCH_FETCH_URL_CONTENT")) {
        ctrl.chamadasComposioPainel++;
        return Response.json({
          successful: true,
          data: { results: ctrl.composio === "texto" ? [{ url: "https://weather-appa.app.simport.com.br/", text: ctrl.painelTexto }] : [] },
        });
      }
      throw new Error("sem Gemini neste teste");
    }
    // O painel público: uma casca de SPA, sem os dados no HTML.
    if (url.startsWith("https://weather-appa.app.simport.com.br")) {
      return new Response(CASCA_SPA, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("wfa.app.simport.com.br")) return Response.json({ events: [] });
    if (url.includes("simport")) {
      if (!ctrl.apiNoAr) return new Response("Serviço indisponível", { status: 503 });
      const c = ctrl.cenario;
      const base = Math.floor(Date.now() / 1000) - 3600;
      const horas = Array.from({ length: 40 }, (_, i) => ({
        date: { sec: base + i * 3600 },
        ...(url.includes("chanceOfRain")
          ? {
              precipitation: c.mm,
              temperature: 21,
              relativeHumidity: 80,
              thermalSensation: 21,
              chanceOfRain: c.chance,
              icon: c.gravidade === 5 ? 1186 : 1003,
            }
          : {}),
        ...(url.includes("windGust")
          ? { windSpeed: Math.round((c.rajada / 1.852) * 0.6), windGust: Math.round(c.rajada / 1.852), windDirection: 135 }
          : {}),
        ...(url.includes("hourlyPrecipitation")
          ? { temperatureAverage: 21, thermalSensationAverage: 21, humidityAverage: 80, hourlyPrecipitation: 0 }
          : {}),
        ...(url.includes("windDirectionAverage") ? { windDirectionAverage: 135, windSpeedAverage: 7 } : {}),
      }));
      return Response.json(horas);
    }
    if (url.includes("open-meteo")) {
      const dias = Array.from({ length: 16 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10));
      return Response.json({
        daily: {
          time: dias,
          weather_code: dias.map(() => 2),
          temperature_2m_max: dias.map(() => 26),
          temperature_2m_min: dias.map(() => 17),
          precipitation_sum: dias.map(() => 0),
          precipitation_probability_max: dias.map(() => ctrl.cenario.chance),
          sunrise: dias.map(() => "2026-10-02T04:54"),
          sunset: dias.map(() => "2026-10-02T17:15"),
        },
      });
    }
    return fetchReal(input, init);
  };
  return { ctrl, restaurar: () => void (globalThis.fetch = fetchReal) };
}

/** Banco de teste limpo + Push falso: devolve o que o radar mandou. */
async function prepararBanco() {
  const { db, pool } = await import("../src/db");
  const { chatMensagens, climaMudancas, configuracao, motoristas, subscriptions } = await import("../src/db/schema");
  const { inArray } = await import("drizzle-orm");
  const { garantirTabelas } = await import("../src/lib/estado");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  process.env.COMPOSIO_API_KEY = "chave-de-teste";
  process.env.APPA_LOG = "0";
  // O teste não tem Chromium: sem isso o navegador seria procurado em cada leitura.
  process.env.APPA_NAVEGADOR = "0";
  delete process.env.CLIMA_MONITOR_ATIVO;
  delete process.env.APPA_METODOS;

  const pushes: { titulo: string; corpo: string }[] = [];
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (_s: unknown, c: string) => {
      const j = JSON.parse(c);
      pushes.push({ titulo: j.title, corpo: j.body });
      return { statusCode: 201 };
    },
  });

  await garantirTabelas();
  await db.delete(climaMudancas);
  await db.delete(chatMensagens);
  // Zera o estado do radar (o banco de teste é reaproveitado entre execuções).
  await db.delete(configuracao).where(
    inArray(configuracao.chave, [
      "clima_monitor_instantaneo",
      "clima_monitor_ultima",
      "clima_monitor_painel",
      "clima_monitor_painel_diag",
      "clima_monitor_painel_erro",
      "clima_monitor_ocr_pendente",
      "clima_monitor_semeado",
    ]),
  );
  await db.delete(subscriptions);
  const [m] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
  await db.insert(subscriptions).values({ endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: m.id });
  return { db, pool, chatMensagens, climaMudancas, pushes };
}

// O pool é um só para o arquivo inteiro: fecha depois do último teste (`after`).
const limpar = async (_pool?: unknown) => {
  delete process.env.COMPOSIO_API_KEY;
  delete process.env.CLIMA_MONITOR_ATIVO;
  delete process.env.APPA_NAVEGADOR;
  delete process.env.APPA_METODOS;
};

after(async () => {
  if (!local) return;
  const { pool } = await import("../src/db");
  await pool.end();
});

test("radar: 1ª leitura só registra; mudança real avisa 1 vez no chat e por Push (painel lido pela API, Composio vazio)", { skip: !local }, async () => {
  const { verificarMudancasPrevisao, NOME_RADAR, statusRadarClima, tickRadar, resetarTickRadar } = await import("../src/lib/clima-monitor");
  const rede = instalarRede();
  const { db, pool, chatMensagens, climaMudancas, pushes } = await prepararBanco();
  const { ctrl } = rede;

  try {
    // 1) Primeira leitura: registra o que já existe, sem avisar nada antigo.
    const r1 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r1.postou, false);
    assert.match(r1.motivo, /primeira leitura/i);
    assert.equal(r1.painel?.metodo, "api", "o painel foi lido pela API, mesmo com o Composio devolvendo results vazio");
    assert.equal((await db.select().from(chatMensagens)).length, 0);
    assert.equal(pushes.length, 0);

    // 2) A APPA revisa a previsão: entra chuva forte e rajada alta.
    ctrl.cenario = { chance: 80, rajada: 55, mm: 6.5, gravidade: 5 };
    const r2 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r2.postou, true, `motivo: ${r2.motivo}`);
    assert.ok(r2.mudancas.length > 0);
    const msgs = await db.select().from(chatMensagens);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].nome, NOME_RADAR);
    // Formato do alerta: título, explicação, condição, horário e fonte.
    assert.match(msgs[0].texto, /^🌧️ ALERTA METEOROLÓGICO\n\nFoi identificada uma mudança na previsão meteorológica da região do Porto de Paranaguá\.\n\nCondição: chuva forte/);
    assert.match(msgs[0].texto, /\nHorário: \d{2}:\d{2}\n/);
    assert.match(msgs[0].texto, /\n\nFonte: SIMPORT® \/ APPA$/);
    // Web Push (chega com o app fechado): título do alerta, condição/horário/fonte no corpo.
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].titulo, "🌧️ ALERTA METEOROLÓGICO");
    assert.match(pushes[0].corpo, /Condição: chuva forte/);
    assert.match(pushes[0].corpo, /Horário: \d{2}:\d{2}/);
    assert.match(pushes[0].corpo, /Fonte: SIMPORT® \/ APPA/);
    assert.ok(pushes[0].corpo.length <= 220);
    assert.ok((await db.select().from(climaMudancas)).length > 0);

    // 2b) Sem forçar, o radar respeita o intervalo entre leituras (5 min).
    const r2b = await verificarMudancasPrevisao();
    assert.equal(r2b.rodou, false);
    assert.match(r2b.motivo, /aguardando intervalo/i);

    // 3) Mesma previsão no ciclo seguinte: nada muda, nada repete.
    const r3 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r3.postou, false);
    assert.match(r3.motivo, /sem mudança/i);
    assert.equal((await db.select().from(chatMensagens)).length, 1);
    assert.equal(pushes.length, 1);

    // 4) O alerta/boletim do clima já falou neste minuto: o radar cala a boca,
    //    mas avança a referência (não avisa de novo no ciclo seguinte).
    ctrl.cenario = { chance: 20, rajada: 18, mm: 0, gravidade: 0 };
    const r4 = await verificarMudancasPrevisao({ forcar: true, registrarSomente: true });
    assert.equal(r4.postou, false);
    assert.match(r4.motivo, /já avisou/i);
    assert.equal((await db.select().from(chatMensagens)).length, 1);

    // 5) Mudança nova de verdade (de 20% para 95%) volta a avisar.
    ctrl.cenario = { chance: 95, rajada: 70, mm: 12, gravidade: 5 };
    const r5 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r5.postou, true, `motivo: ${r5.motivo}`);
    assert.equal((await db.select().from(chatMensagens)).length, 2);
    assert.equal(pushes.length, 2);

    // 6) Status do radar para o painel do administrador.
    const s = await statusRadarClima();
    assert.equal(s.ativo, true);
    assert.equal(s.sensibilidade, "media");
    assert.ok(s.ultimaVerificacao);
    assert.equal(s.mudancas24h, (await db.select().from(climaMudancas)).length);
    assert.equal(s.fontes.simport, true);
    assert.equal(s.fontes.painel, true, "o painel da APPA alimentou o radar");
    assert.equal(s.fontes.composio, false);
    assert.ok(s.composio, "Composio configurado (chave de teste)");
    assert.ok(s.ultimaMudanca?.resumo);
    // A tela: "Painel APPA: conectado" + "Método de leitura: API" e nada de erro do Composio.
    assert.equal(s.painel.rotulo, "Painel APPA: conectado");
    assert.equal(s.painel.situacao, "conectado");
    assert.equal(s.painel.metodoRotulo, "API");
    assert.equal(s.painel.erro, null);
    assert.ok(s.painel.em);
    assert.equal(s.painel.leitura?.metodo_leitura, "api");
    assert.equal(s.painel.leitura?.fonte, "APPA");
    // Log de diagnóstico: uma linha por tentativa, com a hora entre colchetes.
    assert.ok(s.painel.log.length >= 5, "uma linha por ciclo");
    assert.match(s.painel.log[0], /^\[\d{2}:\d{2}:\d{2}\] APPA · #1 API · SUCESSO · /);
    assert.equal(ctrl.chamadasComposioPainel, 0, "com a API funcionando nem se pergunta ao Composio");

    // 6b) Batida leve do caminho do app aberto: a 1ª roda o ciclo, as seguintes
    // saem de graça (só uma comparação de horário, sem banco e sem rede).
    resetarTickRadar();
    const batida1 = await tickRadar();
    assert.ok(batida1, "a 1ª batida roda o ciclo do radar");
    assert.equal(batida1?.postou, false, "sem mudança nova (o cenário não mudou)");
    assert.equal(await tickRadar(), null, "a 2ª batida no mesmo minuto sai de graça");
    // Radar desligado: a batida não faz nada.
    process.env.CLIMA_MONITOR_ATIVO = "0";
    assert.equal(await tickRadar(), null);
    delete process.env.CLIMA_MONITOR_ATIVO;
    resetarTickRadar();
    assert.ok(await tickRadar(), "volta a rodar com o radar ligado");

    // 7) CLIMA_MONITOR_ATIVO=0 desliga o radar sem quebrar o cron.
    process.env.CLIMA_MONITOR_ATIVO = "0";
    const desligado = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(desligado.rodou, false);
    assert.match(desligado.motivo, /desligado/i);
    delete process.env.CLIMA_MONITOR_ATIVO;
  } finally {
    rede.restaurar();
    await limpar(pool);
  }
});

test("radar: API da Simport fora do ar → o painel é lido pelo Composio (método adicional) e o radar segue", { skip: !local }, async () => {
  const { verificarMudancasPrevisao, statusRadarClima, lerPainelAgora } = await import("../src/lib/clima-monitor");
  const rede = instalarRede();
  const { db, pool, chatMensagens, pushes } = await prepararBanco();
  const { ctrl } = rede;
  ctrl.apiNoAr = false;
  ctrl.composio = "texto";

  try {
    const r1 = await verificarMudancasPrevisao({ forcar: true });
    assert.match(r1.motivo, /primeira leitura/i, `motivo: ${r1.motivo}`);
    assert.equal(r1.painel?.metodo, "composio");
    const s1 = await statusRadarClima();
    // O erro da API e do HTML ficam só no log: a tela mostra a leitura, não uma falha.
    assert.equal(s1.painel.situacao, "leitura-realizada");
    assert.equal(s1.painel.rotulo, "Painel APPA: leitura realizada");
    assert.equal(s1.painel.metodoRotulo, "Composio");
    assert.equal(s1.painel.erro, null);
    assert.ok(s1.painel.log.some((l) => /#1 API · (FALHOU|VAZIO)/.test(l)), "o log registra a tentativa da API");
    assert.ok(s1.painel.log.some((l) => /#2 HTML direto · VAZIO/.test(l)), "e a do HTML, que veio vazio (SPA)");
    // (neste teste o navegador/OCR estão desligados, então o Composio é o 3º da fila)
    assert.ok(s1.painel.log.some((l) => /#3 Composio · SUCESSO/.test(l)));

    // O painel muda (chuva e vento maiores): o radar avisa no chat e por Push, lendo só pelo Composio.
    ctrl.painelTexto = PAINEL_MUDADO;
    const r2 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r2.postou, true, `motivo: ${r2.motivo}`);
    const msgs = await db.select().from(chatMensagens);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].texto, /ALERTA METEOROLÓGICO/);
    assert.equal(pushes.length, 1);

    // "Ler painel agora" (diagnóstico do administrador): lê, registra e não avisa ninguém.
    const antes = (await db.select().from(chatMensagens)).length;
    const lido = await lerPainelAgora();
    assert.equal(lido.status, "sucesso");
    assert.equal(lido.metodo, "composio");
    assert.equal((await db.select().from(chatMensagens)).length, antes);

    // O app aberto (caminho leve: só API e HTML) não consegue ler com a API fora do ar. Isso NÃO é
    // "todos os métodos falharam" (navegador, OCR e Composio nem foram tentados): a tela não vira erro.
    const { configuracao } = await import("../src/db/schema");
    const { inArray } = await import("drizzle-orm");
    const { tickRadar, resetarTickRadar } = await import("../src/lib/clima-monitor");
    await db.delete(configuracao).where(inArray(configuracao.chave, ["clima_monitor_ultima", "clima_monitor_painel"]));
    const logAntes = (await statusRadarClima()).painel.log.length;
    resetarTickRadar();
    await tickRadar();
    const s3 = await statusRadarClima();
    assert.ok(s3.painel.log.length > logAntes, "o log registra a tentativa leve");
    assert.notEqual(s3.painel.situacao, "erro", "falha do caminho leve não é erro do painel");
    assert.equal(s3.painel.erro, null);
    assert.equal(s3.painel.metodoRotulo, "Composio", "continua valendo a última leitura completa");
  } finally {
    rede.restaurar();
    await limpar(pool);
  }
});

test("radar: TODOS os métodos falham → a tela mostra o erro detalhado, mas o radar continua com a previsão", { skip: !local }, async () => {
  const { verificarMudancasPrevisao, statusRadarClima } = await import("../src/lib/clima-monitor");
  const rede = instalarRede();
  const { pool, db, chatMensagens } = await prepararBanco();
  const { ctrl } = rede;
  // Só o Composio ligado e ele devolve results vazio: exatamente o relato original.
  process.env.APPA_METODOS = "composio";
  ctrl.composio = "vazio";

  try {
    const r1 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r1.rodou, true);
    assert.match(r1.motivo, /primeira leitura/i, "a previsão pela API mantém o radar de pé");
    assert.equal(r1.painel?.status, "erro");
    const s = await statusRadarClima();
    assert.equal(s.painel.situacao, "erro", "todos os métodos ligados falharam");
    assert.equal(s.painel.rotulo, "Painel APPA: sem leitura");
    assert.match(s.painel.erro ?? "", /^Nenhum método conseguiu ler o painel da APPA/);
    assert.match(s.painel.erro ?? "", /Composio: /);
    assert.ok(s.painel.log.some((l) => /Composio · VAZIO/.test(l)));
    assert.equal(s.fontes.painel, false);

    // Mesmo sem o painel, a previsão continua avisando mudanças.
    ctrl.cenario = { chance: 85, rajada: 60, mm: 7, gravidade: 5 };
    const r2 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r2.postou, true, `motivo: ${r2.motivo}`);
    assert.equal((await db.select().from(chatMensagens)).length, 1);

    // Os outros métodos voltam a funcionar: a tela deixa de mostrar o erro no ciclo seguinte.
    delete process.env.APPA_METODOS;
    await verificarMudancasPrevisao({ forcar: true });
    const s2 = await statusRadarClima();
    assert.equal(s2.painel.situacao, "conectado");
    assert.equal(s2.painel.erro, null);
  } finally {
    rede.restaurar();
    await limpar(pool);
  }
});
