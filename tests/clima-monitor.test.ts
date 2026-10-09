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

test("radar: mudanças continuam na memória sem publicar chat ou Push, inclusive com forcar", { skip: !local }, async () => {
  const { db } = await import("../src/db");
  const { chatMensagens, climaMudancas, configuracao } = await import("../src/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { verificarMudancasPrevisao } = await import("../src/lib/clima-monitor");
  const { lerMemoriaClima } = await import("../src/lib/ia-memoria-porto");
  const webpush = (await import("web-push")).default;
  const original = webpush.sendNotification, fetchReal = globalThis.fetch;
  process.env.COMPOSIO_API_KEY = "chave-ficticia-sem-rede";
  delete process.env.CLIMA_MONITOR_ATIVO;
  let painel = PAINEL, pushes = 0;
  Object.defineProperty(webpush, "sendNotification", { configurable: true, value: async () => { pushes++; return { statusCode: 201 }; } });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("COMPOSIO_SEARCH_FETCH_URL_CONTENT")) return Response.json({ successful: true, data: { results: [{ url: "https://weather-appa.app.simport.com.br/", text: painel }] } });
    if (url.includes("backend.composio.dev")) return Response.json({ successful: false, error: "sem medição no teste" });
    if (url.includes("weather-appa")) return new Response(painel);
    return Response.json([]); // rede simulada, sem serviços externos
  };
  try {
    await garantirTabelas();
    await db.delete(configuracao).where(inArray(configuracao.chave, ["clima_monitor_instantaneo", "clima_monitor_ultima", "clima_monitor_painel", "clima_monitor_semeado", "clima_estado_chuva"]));
    const chatAntes = (await db.select().from(chatMensagens)).length;
    const avisosAntes = (await db.select().from(climaMudancas)).length;
    for (const cenario of [{ chance: 10, rajada: 18, mm: 0 }, { chance: 92, rajada: 58, mm: 6.4 }, { chance: 95, rajada: 65, mm: 10 }]) {
      painel = cenario.chance > 50 ? PAINEL_MUDADO : PAINEL;
      const r = await verificarMudancasPrevisao({ forcar: true, previsao: previsao(cenario) });
      assert.equal(r.postou, false); assert.equal(r.rodou, true); assert.match(r.motivo, /avisos automáticos desativados/);
      assert.equal((await lerMemoriaClima())?.agora.rajadaKmh, cenario.rajada);
    }
    const [memoria] = await db.select().from(configuracao).where(eq(configuracao.chave, "clima_monitor_instantaneo"));
    assert.ok(memoria?.valor, "memória e diagnóstico do radar preservados");
    resetarTickRadar();
    assert.equal((await tickRadar())?.postou, false);
    assert.equal((await db.select().from(chatMensagens)).length, chatAntes);
    assert.equal((await db.select().from(climaMudancas)).length, avisosAntes);
    assert.equal(pushes, 0);
  } finally {
    globalThis.fetch = fetchReal;
    Object.defineProperty(webpush, "sendNotification", { configurable: true, value: original });
  }
});
after(async () => { if (local) { const { pool } = await import("../src/db"); await pool.end(); } });
