import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  LIMIARES,
  PROB_ENTRA_CHUVA,
  PROB_SAI_CHUVA,
  TIPOS_RELEVANTES,
  assinaturaDoDia,
  configRadar,
  detectarMudancas,
  evidenciaChuva,
  evidenciaSemChuva,
  montarInstantaneo,
  mudancaDeTransicaoChuva,
  mudancasRelevantes,
  normalizarTexto,
  parseRegistroEstadoChuva,
  parsearPainelSimport,
  proximoEstadoChuva,
  resetarTickRadar,
  textoMudancaPadrao,
  tickRadar,
  type EstadoChuva,
  type InstantaneoClima,
  type Mudanca,
  type PainelSimport,
  type TipoMudanca,
} from "../src/lib/clima-monitor";
import type { Previsao } from "@/lib/tempo";

/**
 * RADAR DA PREVISÃO — monitoramento constante do tempo via Composio.
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

test("radar: configuração padrão (5 min, painel 5 min, sensibilidade média)", () => {
  const c = configRadar({} as Record<string, string>);
  assert.equal(c.ativo, true);
  assert.equal(c.sensibilidade, "media");
  assert.equal(c.intervaloMs, 5 * 60_000);
  // O painel da APPA é relido no MESMO passo do radar (5 min), com fallback
  // automático entre API/JSON, HTML, navegador headless, OCR e Composio.
  assert.equal(c.painelMs, 5 * 60_000);
  // Cota de notificações: o radar fala pouco — 45 min entre avisos, no máximo
  // 2 por hora e 8 por dia; mudança grave tem piso curto de 15 min.
  assert.equal(c.avisoMinMs, 45 * 60_000);
  assert.equal(c.maxPorHora, 2);
  assert.equal(c.maxPorDia, 8);
  assert.equal(c.minGraveMs, 15 * 60_000);

  assert.equal(configRadar({ CLIMA_MONITOR_ATIVO: "0" } as Record<string, string>).ativo, false);
  assert.equal(configRadar({ CLIMA_MONITOR_MIN: "2" } as Record<string, string>).intervaloMs, 120_000);
  assert.equal(configRadar({ CLIMA_MONITOR_SENSIBILIDADE: "alta" } as Record<string, string>).sensibilidade, "alta");
  assert.equal(configRadar({ CLIMA_MONITOR_MAX_DIA: "4" } as Record<string, string>).maxPorDia, 4);
  // Valores zerados ou inválidos não derrubam o radar: valem os padrões.
  assert.equal(configRadar({ CLIMA_MONITOR_MIN: "0" } as Record<string, string>).intervaloMs, 300_000);
});

test("radar: só chuva, vento, condição, alerta e boletim acordam o celular", () => {
  const m = (tipo: TipoMudanca): Mudanca => ({
    tipo,
    origem: "api",
    rotulo: tipo,
    antes: "a",
    agora: "b",
    frase: `${tipo} mudou`,
    grave: false,
    assinatura: `teste:${tipo}`,
    peso: 1,
  });
  // Temperatura, maré, horário do sol e medição: registro, sem notificação.
  assert.equal(mudancasRelevantes([m("temperatura"), m("mare"), m("sol"), m("medicao")]).length, 0);
  // Basta UMA mudança que importa para o ciclo virar aviso.
  const mistas = mudancasRelevantes([m("temperatura"), m("chuva"), m("medicao")]);
  assert.deepEqual(mistas.map((x) => x.tipo), ["chuva"]);
  for (const tipo of ["chuva", "vento", "condicao", "alerta", "boletim"] as TipoMudanca[]) {
    assert.ok(TIPOS_RELEVANTES.has(tipo), `${tipo} é relevante`);
  }
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

test("radar: painel da APPA entrega o formato único (e o método que leu)", () => {
  const p = parsearPainelSimport(PAINEL);
  assert.ok(p);
  const i = montarInstantaneo(null, p, Date.now(), null, "ocr");
  assert.equal(i.painel?.metodo, "ocr");
  assert.equal(i.painel?.leitura?.fonte, "APPA");
  assert.equal(i.painel?.leitura?.status, "sucesso");
  assert.equal(i.painel?.leitura?.metodo_leitura, "ocr");
  assert.ok(typeof i.painel?.leitura?.chuva === "string" && i.painel.leitura.chuva.length > 10);
  assert.ok(typeof i.painel?.leitura?.vento === "string");
  assert.ok(i.painel?.condicao && i.painel.condicao.length > 3);
  assert.ok((i.painel?.gravidade ?? 0) >= 4);
  assert.ok(Array.isArray(i.painel?.alertas));
});

test("radar: novo alerta meteorológico no painel vira aviso (grave no tempo ruim)", () => {
  const base = parsearPainelSimport(PAINEL);
  assert.ok(base);
  const semAlerta = { ...base, alertas: [] };
  const antes = montarInstantaneo(null, semAlerta, Date.now(), null, "api");
  const depois = montarInstantaneo(
    null,
    { ...base, alertas: ["Tempestade com rajadas de vento no porto a partir das 13h"] },
    Date.now() + 60_000,
    null,
    "playwright",
  );
  const m = detectarMudancas(antes, depois, "media");
  const alerta = m.find((x) => x.tipo === "alerta");
  assert.ok(alerta, "alerta novo detectado");
  assert.equal(alerta.origem, "painel");
  assert.equal(alerta.grave, true, "tempestade é grave (notificação fica na tela)");
  assert.match(alerta.assinatura, /^alerta:/);
  assert.match(alerta.frase, /alerta meteorológico/i);
  // O mesmo alerta na leitura seguinte não repete nada.
  assert.equal(detectarMudancas(depois, depois, "alta").filter((x) => x.tipo === "alerta").length, 0);
});

test("radar: a condição do painel (chuva → chuva forte) também avisa", () => {
  const base = parsearPainelSimport(PAINEL);
  assert.ok(base);
  const leve = { ...base, alertas: [], chuva: [{ hora: "14:00", mm: 0.2, prob: 30 }] };
  const forte = { ...base, alertas: [], chuva: [{ hora: "14:00", mm: 6.4, prob: 92 }] };
  const antes = montarInstantaneo(null, leve, Date.now(), null, "html");
  const depois = montarInstantaneo(null, forte, Date.now() + 60_000, null, "html");
  const m = detectarMudancas(antes, depois, "media");
  const condicao = m.find((x) => x.tipo === "condicao");
  assert.ok(condicao, "mudança de condição detectada no painel");
  assert.equal(condicao.origem, "painel");
  assert.equal(condicao.grave, true);
  assert.match(condicao.assinatura, /^painelCondicao:/);
  assert.ok(m.some((x) => x.tipo === "chuva"), "chuva forte também aparece");
});

test("radar: mudança do horário da chuva no painel também avisa", () => {
  const base = parsearPainelSimport(PAINEL);
  assert.ok(base);
  const comChuva = (hora: string) => ({
    ...base,
    alertas: [],
    chuva: [{ hora, mm: 1.2, prob: 80 }],
  });
  const antes = montarInstantaneo(null, comChuva("14:00"), Date.now(), null, "api");
  const depois = montarInstantaneo(null, comChuva("20:00"), Date.now() + 60_000, null, "api");
  assert.equal(antes.painel?.inicioChuva, "14:00");
  assert.equal(depois.painel?.inicioChuva, "20:00");
  const m = detectarMudancas(antes, depois, "media");
  const horario = m.find((x) => x.assinatura.startsWith("painelHoraChuva:"));
  assert.ok(horario, "mudança de horário da chuva detectada");
  assert.equal(horario.origem, "painel");
  assert.match(horario.frase, /14:00/);
  assert.match(horario.frase, /20:00/);
  // O mesmo horário nas duas leituras não gera aviso.
  const igual = montarInstantaneo(null, comChuva("20:00"), Date.now() + 120_000, null, "api");
  assert.equal(detectarMudancas(depois, igual, "alta").filter((x) => x.tipo === "chuva").length, 0);
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

test("radar: texto do aviso usa só dados reais e cabe numa notificação", () => {
  const antes = instantaneo({ chance: 10, rajada: 18 });
  const depois = instantaneo({ chance: 75, rajada: 52, mm: 6.5, gravidade: 5 }, Date.now() + 60_000);
  const m = detectarMudancas(antes, depois, "media");
  const t = textoMudancaPadrao(m, previsao({ chance: 75, rajada: 52, mm: 6.5, gravidade: 5 }));
  assert.match(t, /previsão do porto mudou/i);
  assert.match(t, /75%/);
  assert.ok(t.length <= 480, "cabe no corpo da notificação");
  assert.match(t, /SIMPORT/);
  // Mudança de vento escolhe o emoji de vento quando é o único assunto.
  const soVento = detectarMudancas(instantaneo({ rajada: 18 }), instantaneo({ rajada: 52 }, Date.now() + 1000), "media");
  assert.match(textoMudancaPadrao(soVento, null), /💨/);
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

/* --------------------------------------------- situação da chuva (estado) */

test("radar: evidência de chuva exige força (chance ≥ 50, volume, condição ou chovendo agora)", () => {
  // Dia seco: nenhuma fonte aponta chuva.
  assert.equal(evidenciaChuva(instantaneo({ chance: 10 })), false);
  assert.equal(evidenciaSemChuva(instantaneo({ chance: 10 })), true);
  // Chance na faixa de entra (≥ 50%) já é previsão de chuva.
  assert.equal(evidenciaChuva(instantaneo({ chance: PROB_ENTRA_CHUVA })), true);
  // Condição de chuva (gravidade 5) e volume também.
  assert.equal(evidenciaChuva(instantaneo({ chance: 0, gravidade: 5 })), true);
  assert.equal(evidenciaChuva(instantaneo({ chance: 0, mm: 2 })), true);
  // Chuva medida agora (descrição da estação) conta como evidência.
  const comChuvaAgora = instantaneo({ chance: 10 });
  comChuvaAgora.agora = { ...comChuvaAgora.agora!, descricao: "Chuva moderada" };
  assert.equal(evidenciaChuva(comChuvaAgora), true);
  assert.equal(evidenciaSemChuva(comChuvaAgora), false);
  // Medição do Composio chovendo (código 501 = chuva) também conta.
  const cc = {
    temperatura: 19, sensacao: 19, umidade: 95, ventoKmh: 10, rajadaKmh: 18,
    ventoGraus: 135, nuvens: 90, codigo: 501, descricao: "chuva moderada",
    medidoEm: Math.floor(Date.now() / 1000),
  };
  assert.equal(evidenciaChuva(montarInstantaneo(null, null, Date.now(), cc)), true);
});

test("radar: histerese — entre 30% e 50% a situação não mexe (não pinga aviso)", () => {
  const indeciso = instantaneo({ chance: 40 });
  assert.equal(evidenciaChuva(indeciso), false, "40% ainda não é previsão de chuva");
  assert.equal(evidenciaSemChuva(indeciso), false, "40% ainda não é tempo firme");
  // Quem estava sem chuva continua sem chuva; quem estava chovendo continua.
  assert.equal(proximoEstadoChuva(indeciso, "sem-chuva"), "sem-chuva");
  assert.equal(proximoEstadoChuva(indeciso, "chuva"), "chuva");
  assert.ok(PROB_SAI_CHUVA < PROB_ENTRA_CHUVA, "as faixas formam uma banda morta");
});

test("radar: viradas de situação (sem-chuva → chuva e chuva → sem-chuva)", () => {
  const seco = instantaneo({ chance: 10 });
  const molhado = instantaneo({ chance: 80, gravidade: 5, mm: 3 });
  // Estava sem chuva e a previsão passou a indicar chuva → vira.
  assert.equal(proximoEstadoChuva(molhado, "sem-chuva"), "chuva");
  // Estava chovendo e a previsão indica que vai limpar → vira.
  assert.equal(proximoEstadoChuva(seco, "chuva"), "sem-chuva");
  // Situação persiste: continua chovendo ou continua seco → não vira.
  assert.equal(proximoEstadoChuva(molhado, "chuva"), "chuva");
  assert.equal(proximoEstadoChuva(seco, "sem-chuva"), "sem-chuva");
  // Primeira leitura adota o que as fontes dizem com clareza.
  assert.equal(proximoEstadoChuva(molhado, null), "chuva");
  assert.equal(proximoEstadoChuva(seco, null), "sem-chuva");
  assert.equal(proximoEstadoChuva(instantaneo({ chance: 40 }), null), null);
});

test("radar: para SAIR da chuva, TODAS as fontes precisam mostrar tempo firme", () => {
  // A API enxerga tempo limpo, mas a medição no porto segue chovendo.
  const i = instantaneo({ chance: 5 });
  i.agora = { ...i.agora!, descricao: "Chuva fraca" };
  assert.equal(evidenciaSemChuva(i), false);
  assert.equal(proximoEstadoChuva(i, "chuva"), "chuva", "ainda chovendo agora, não declara tempo limpo");
  // Sem nenhuma fonte de previsão, não dá para afirmar que vai limpar.
  const soMedicao = montarInstantaneo(null, null, Date.now(), null);
  assert.equal(evidenciaSemChuva(soMedicao), false);
});

test("radar: a mudança da virada carrega antes/depois, assinatura fixa e gravidade", () => {
  const seca = instantaneo({ chance: 10 });
  const molhada = instantaneo({ chance: 80, gravidade: 5, mm: 3 });
  const entra = mudancaDeTransicaoChuva("sem-chuva" as EstadoChuva, "chuva" as EstadoChuva, molhada);
  assert.equal(entra.tipo, "chuva");
  assert.match(entra.rotulo, /passou a indicar chuva/i);
  assert.equal(entra.grave, true, "chuva chegando é mudança grave (fica na tela)");
  assert.match(entra.assinatura, /^chuvaEstado:sem-chuva>chuva#/);
  assert.match(entra.frase, /estava sem chuva/);
  assert.ok(TIPOS_RELEVANTES.has(entra.tipo), "a virada acorda o celular");

  const sai = mudancaDeTransicaoChuva("chuva" as EstadoChuva, "sem-chuva" as EstadoChuva, seca);
  assert.match(sai.rotulo, /vai parar/i);
  assert.equal(sai.grave, false);
  assert.match(sai.assinatura, /^chuvaEstado:chuva>sem-chuva#/);
  assert.match(sai.frase, /estava chovendo/);
});

test("radar: texto pronto usa ☀️ quando a chuva vai parar e 🌧️ quando chega", () => {
  const seca = instantaneo({ chance: 10 });
  const molhada = instantaneo({ chance: 80, gravidade: 5, mm: 3 });
  const entra = mudancaDeTransicaoChuva("sem-chuva", "chuva", molhada);
  const sai = mudancaDeTransicaoChuva("chuva", "sem-chuva", seca);
  assert.match(textoMudancaPadrao([entra], null), /^🌧️/);
  assert.match(textoMudancaPadrao([sai], null), /^☀️/);
});

test("radar: registro persistido da situação da chuva (parse tolerante)", () => {
  const valido = JSON.stringify({ estado: "chuva", desde: 123, transicoes: 2, ultimaTransicaoEm: 456 });
  const r = parseRegistroEstadoChuva(valido);
  assert.equal(r?.estado, "chuva");
  assert.equal(r?.transicoes, 2);
  assert.equal(r?.ultimaTransicaoEm, 456);
  assert.equal(parseRegistroEstadoChuva(null), null);
  assert.equal(parseRegistroEstadoChuva("{"), null);
  assert.equal(parseRegistroEstadoChuva(JSON.stringify({ estado: "nublado", desde: 1 })), null);
  assert.equal(parseRegistroEstadoChuva(JSON.stringify({ estado: "chuva" })), null);
});

/* ------------------------------------------------- ponta a ponta (banco) */

test("radar: 1ª leitura só registra; mudança real avisa 1 vez no chat e por Push", { skip: !local }, async () => {
  const { db } = await import("../src/db");
  const { chatMensagens, climaMudancas, configuracao, motoristas, subscriptions } = await import("../src/db/schema");
  const { inArray } = await import("drizzle-orm");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { verificarMudancasPrevisao, NOME_RADAR, statusRadarClima, tickRadar, resetarTickRadar } = await import("../src/lib/clima-monitor");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  process.env.COMPOSIO_API_KEY = "chave-de-teste";
  delete process.env.CLIMA_MONITOR_ATIVO;

  const pushes: string[] = [];
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (_s: unknown, c: string) => {
      pushes.push(JSON.parse(c).title);
      return { statusCode: 201 };
    },
  });

  // Cenário da previsão (mutável): chance de chuva, rajada, volume, condição e
  // temperatura (a medição do porto e o máximo/mínimo do dia saem daqui).
  let cenario = { chance: 10, rajada: 18, mm: 0, gravidade: 0, temp: 21 };
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    // Painel da Simport lido PELO COMPOSIO (o slug da ferramenta vem na URL).
    if (url.includes("backend.composio.dev")) {
      if (url.includes("COMPOSIO_SEARCH_FETCH_URL_CONTENT")) {
        return Response.json({
          successful: true,
          data: { results: [{ url: "https://weather-appa.app.simport.com.br/", text: PAINEL }] },
        });
      }
      // Sem Gemini: o radar cai no texto pronto das regras.
      throw new Error("sem Gemini neste teste");
    }
    if (url.includes("wfa.app.simport.com.br")) return Response.json({ events: [] });
    if (url.includes("simport")) {
      const base = Math.floor(Date.now() / 1000) - 3600;
      const horas = Array.from({ length: 40 }, (_, i) => ({
        date: { sec: base + i * 3600 },
        ...(url.includes("chanceOfRain")
          ? {
              precipitation: cenario.mm,
              temperature: cenario.temp,
              relativeHumidity: 80,
              thermalSensation: cenario.temp,
              chanceOfRain: cenario.chance,
              icon: cenario.gravidade === 5 ? 1186 : 1003,
            }
          : {}),
        ...(url.includes("windGust")
          ? { windSpeed: Math.round((cenario.rajada / 1.852) * 0.6), windGust: Math.round(cenario.rajada / 1.852), windDirection: 135 }
          : {}),
        ...(url.includes("hourlyPrecipitation")
          ? { temperatureAverage: cenario.temp, thermalSensationAverage: cenario.temp, humidityAverage: 80, hourlyPrecipitation: 0 }
          : {}),
        ...(url.includes("windDirectionAverage")
          ? { windDirectionAverage: 135, windSpeedAverage: 7 }
          : {}),
      }));
      return Response.json(horas);
    }
    if (url.includes("open-meteo")) {
      const dias = Array.from({ length: 16 }, (_, i) => {
        const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
        return d;
      });
      return Response.json({
        daily: {
          time: dias,
          weather_code: dias.map(() => 2),
          temperature_2m_max: dias.map(() => 26),
          temperature_2m_min: dias.map(() => 17),
          precipitation_sum: dias.map(() => 0),
          precipitation_probability_max: dias.map(() => cenario.chance),
          sunrise: dias.map(() => "2026-10-02T04:54"),
          sunset: dias.map(() => "2026-10-02T17:15"),
        },
      });
    }
    return fetchReal(input, init);
  };

  try {
    await garantirTabelas();
    await db.delete(climaMudancas);
    await db.delete(chatMensagens);
    // Zera o estado do radar (o banco de teste é reaproveitado entre execuções).
    await db.delete(configuracao).where(
      inArray(configuracao.chave, [
        "clima_monitor_instantaneo",
        "clima_monitor_ultima",
        "clima_monitor_painel",
        "clima_monitor_semeado",
        "clima_estado_chuva",
        "notificacoes_cota",
      ]),
    );
    await db.delete(subscriptions);
    const [m] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: m.id });

    // 1) Primeira leitura: registra o que já existe, sem avisar nada antigo.
    const r1 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r1.postou, false);
    assert.match(r1.motivo, /primeira leitura/i);
    assert.equal((await db.select().from(chatMensagens)).length, 0);
    assert.equal(pushes.length, 0);

    // 2) A APPA revisa a previsão: entra chuva forte e rajada alta.
    cenario = { ...cenario, chance: 80, rajada: 55, mm: 6.5, gravidade: 5 };
    const r2 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r2.postou, true, `motivo: ${r2.motivo}`);
    assert.ok(r2.mudancas.length > 0);
    const msgs = await db.select().from(chatMensagens);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].nome, NOME_RADAR);
    assert.match(msgs[0].texto, /mudou|chuva/i);
    assert.deepEqual(pushes, [NOME_RADAR], "Push com o nome do radar");
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
    cenario = { ...cenario, chance: 20, rajada: 18, mm: 0, gravidade: 0 };
    const r4 = await verificarMudancasPrevisao({ forcar: true, registrarSomente: true });
    assert.equal(r4.postou, false);
    assert.match(r4.motivo, /já avisou/i);
    assert.equal((await db.select().from(chatMensagens)).length, 1);

    // 5) Mudança nova de verdade (de 20% para 95%) volta a avisar.
    cenario = { ...cenario, chance: 95, rajada: 70, mm: 12, gravidade: 5 };
    const r5 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r5.postou, true, `motivo: ${r5.motivo}`);
    assert.equal((await db.select().from(chatMensagens)).length, 2);
    assert.equal(pushes.length, 2);

    // 5b) Só a temperatura mudou (5°C a mais): não é notícia para quem está
    //     na estrada — o radar avança a referência sem acordar o celular.
    cenario = { ...cenario, temp: 26 };
    const r5b = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r5b.postou, false, `motivo: ${r5b.motivo}`);
    assert.match(r5b.motivo, /baixa relevância/i);
    assert.ok(r5b.mudancas.length > 0, "a mudança foi detectada e registrada");
    assert.equal((await db.select().from(chatMensagens)).length, 2, "sem mensagem nova");
    assert.equal(pushes.length, 2, "sem Push novo");

    // 6) Status do radar para a tela Tempo e para o painel.
    const s = await statusRadarClima();
    assert.equal(s.ativo, true);
    assert.equal(s.sensibilidade, "media");
    assert.ok(s.ultimaVerificacao);
    assert.equal(s.mudancas24h, (await db.select().from(climaMudancas)).length);
    assert.equal(s.avisoMinMin, 45, "cota: 45 min entre avisos");
    assert.equal(s.maxPorHora, 2, "cota: no máximo 2 avisos por hora");
    assert.equal(s.maxPorDia, 8, "cota: no máximo 8 avisos por dia");
    assert.equal(s.fontes.simport, true);
    assert.equal(s.fontes.painel, true, "o painel lido pelo Composio alimentou o radar");
    assert.equal(s.fontes.composio, false);
    assert.ok(s.composio, "Composio configurado (chave de teste)");
    assert.ok(s.ultimaMudanca?.resumo);
    // 6a) Painel da APPA: leitura feita por ALGUM método, com o log das
    //     tentativas — nada de "ainda não lido pelo Composio".
    assert.equal(s.painel.conectado, true, "painel APPA conectado");
    assert.equal(s.painel.erro, null, "sem erro quando algum método leu");
    assert.ok(s.painel.metodo, "método de leitura informado");
    assert.ok(s.painel.metodoRotulo && s.painel.metodoRotulo.length > 3);
    assert.ok(s.painel.em, "quando foi a última leitura boa");
    assert.equal(s.painel.leitura?.fonte, "APPA");
    assert.equal(s.painel.leitura?.status, "sucesso");
    assert.ok(s.painel.tentativas.length > 0, "log de diagnóstico com as tentativas");

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
    globalThis.fetch = fetchReal;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.CLIMA_MONITOR_ATIVO;
  }
});

test("radar: situação da chuva — avisa só na virada, não repete enquanto persiste", { skip: !local }, async () => {
  const { db } = await import("../src/db");
  const { chatMensagens, climaMudancas, configuracao, motoristas, subscriptions } = await import("../src/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { verificarMudancasPrevisao } = await import("../src/lib/clima-monitor");
  const webpush = (await import("web-push")).default;

  const chaves = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  delete process.env.COMPOSIO_API_KEY;
  delete process.env.CLIMA_MONITOR_ATIVO;

  const pushes: string[] = [];
  Object.defineProperty(webpush, "sendNotification", {
    configurable: true,
    value: async (_s: unknown, c: string) => {
      pushes.push(JSON.parse(c).title);
      return { statusCode: 201 };
    },
  });

  // Sem rede: painel da APPA e afins ficam fora do ar — o radar trabalha só
  // com a previsão (SIMPORT) que o teste injeta.
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async () => new Response("indisponível", { status: 503 });

  const lerChuva = async () => {
    const [l] = await db.select().from(configuracao).where(eq(configuracao.chave, "clima_estado_chuva")).limit(1);
    return l ? (JSON.parse(l.valor) as { estado: string; transicoes: number }) : null;
  };

  try {
    await garantirTabelas();
    await db.delete(climaMudancas);
    await db.delete(chatMensagens);
    await db.delete(configuracao).where(
      inArray(configuracao.chave, [
        "clima_monitor_instantaneo",
        "clima_monitor_ultima",
        "clima_monitor_painel",
        "clima_monitor_painel_erro",
        "clima_monitor_semeado",
        "clima_estado_chuva",
        "notificacoes_cota",
      ]),
    );
    await db.delete(subscriptions);
    const [m] = await db.insert(motoristas).values({ nome: "Ana" }).returning();
    await db.insert(subscriptions).values({ endpoint: "https://push.teste/ana", p256dh: "x", auth: "y", motoristaId: m.id });

    // 1) ☀️ Estava sem chuva: a 1ª leitura só registra a situação (semeia).
    const r1 = await verificarMudancasPrevisao({ forcar: true, previsao: previsao({ chance: 10 }) });
    assert.equal(r1.postou, false);
    assert.match(r1.motivo, /primeira leitura/i);
    assert.equal((await lerChuva())?.estado, "sem-chuva", "situação inicial registrada sem avisar");

    // 2) 🌧️ A previsão passa a indicar chuva: UM alerta.
    const r2 = await verificarMudancasPrevisao({ forcar: true, previsao: previsao({ chance: 80, gravidade: 5, mm: 3, rajada: 55 }) });
    assert.equal(r2.postou, true, `motivo: ${r2.motivo}`);
    assert.match(r2.motivo, /chuva: sem-chuva → chuva/i);
    const msgs2 = await db.select().from(chatMensagens);
    assert.equal(msgs2.length, 1, "uma mensagem para a virada");
    assert.match(msgs2[0].texto, /estava sem chuva|passou a indicar chuva/i);
    assert.equal(pushes.length, 1, "Push da virada");
    assert.equal((await lerChuva())?.estado, "chuva", "situação notificada fica registrada");
    assert.equal((await lerChuva())?.transicoes, 1);
    const assinaturas2 = (await db.select().from(climaMudancas)).map((x) => x.assinatura);
    assert.ok(assinaturas2.some((a) => a.includes("chuvaEstado:sem-chuva>chuva")), "virada registrada no histórico");

    // 3) 🌧️ Continua chovendo e a previsão segue chuvosa (até piora): NÃO repete.
    const r3 = await verificarMudancasPrevisao({ forcar: true, previsao: previsao({ chance: 95, gravidade: 5, mm: 8, rajada: 55 }) });
    assert.equal(r3.postou, false, `motivo: ${r3.motivo}`);
    assert.equal((await db.select().from(chatMensagens)).length, 1, "sem mensagem repetida");
    assert.equal(pushes.length, 1, "sem Push repetido");
    assert.equal((await lerChuva())?.estado, "chuva");

    // 4) ☀️→🌧️ Oscilação DENTRO da banda (40%): a situação não mexe e a
    //    mudança numérica fica calada — proteção contra aviso pingado.
    const r4 = await verificarMudancasPrevisao({ forcar: true, previsao: previsao({ chance: 40, gravidade: 5, mm: 8, rajada: 55 }) });
    assert.equal(r4.postou, false, `motivo: ${r4.motivo}`);
    assert.equal((await lerChuva())?.estado, "chuva", "dentro da banda, o estado não mexe");
    assert.equal((await db.select().from(chatMensagens)).length, 1);

    // 5) ☀️ Estava chovendo e a previsão indica que vai limpar: UM alerta.
    const r5 = await verificarMudancasPrevisao({ forcar: true, previsao: previsao({ chance: 10 }) });
    assert.equal(r5.postou, true, `motivo: ${r5.motivo}`);
    assert.match(r5.motivo, /chuva: chuva → sem-chuva/i);
    const msgs5 = await db.select().from(chatMensagens);
    assert.equal(msgs5.length, 2, "uma mensagem para a segunda virada");
    assert.match(msgs5[1].texto, /estava chovendo|vai parar|tempo abre/i);
    assert.match(msgs5[1].texto, /☀️/);
    assert.equal(pushes.length, 2);
    assert.equal((await lerChuva())?.estado, "sem-chuva");
    assert.equal((await lerChuva())?.transicoes, 2);

    // 6) ☀️ Continua sem chuva: NÃO repete.
    const r6 = await verificarMudancasPrevisao({ forcar: true, previsao: previsao({ chance: 5 }) });
    assert.equal(r6.postou, false, `motivo: ${r6.motivo}`);
    assert.equal((await db.select().from(chatMensagens)).length, 2);
    assert.equal(pushes.length, 2);

    // 7) 🌧️ Nova virada de verdade (voltou a chover): volta a avisar.
    const r7 = await verificarMudancasPrevisao({ forcar: true, previsao: previsao({ chance: 85, gravidade: 5, mm: 5, rajada: 50 }) });
    assert.equal(r7.postou, true, `motivo: ${r7.motivo}`);
    assert.equal((await db.select().from(chatMensagens)).length, 3);
    assert.equal(pushes.length, 3);
    assert.equal((await lerChuva())?.estado, "chuva");
    const assinaturas7 = (await db.select().from(climaMudancas)).map((x) => x.assinatura);
    assert.ok(assinaturas7.filter((a) => a.includes("chuvaEstado:")).length >= 3, "cada virada fica registrada");

    // Cada virada fica registrada UMA vez no histórico (nada de assinatura repetida).
    const viradas = assinaturas7.filter((a) => a.includes("chuvaEstado:"));
    assert.equal(new Set(viradas).size, viradas.length, "nenhuma virada registrada duas vezes");
  } finally {
    globalThis.fetch = fetchReal;
    delete process.env.COMPOSIO_API_KEY;
  }
});

// O banco de teste é compartilhado pelos testes de ponta a ponta do arquivo:
// o pool fecha UMA vez, depois de todos (fechar no meio derruba os próximos).
after(async () => {
  const { pool } = await import("../src/db");
  await pool.end().catch(() => null);
});
