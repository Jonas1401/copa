import assert from "node:assert/strict";
import { test } from "node:test";
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
/** Ícone/descrição de teste conforme a gravidade pedida (0 sol … 7 temporal). */
function condicaoDaGravidade(g: number | undefined): { icone: Previsao["horas"][number]["icone"]; descricao: string } {
  if (g === 7) return { icone: "tempestade", descricao: "Trovoadas" };
  if (g === 6) return { icone: "chuva-forte", descricao: "Chuva forte" };
  if (g === 5) return { icone: "chuva", descricao: "Chuva" };
  if (g === 3) return { icone: "neblina", descricao: "Neblina" };
  return { icone: "sol-nuvem", descricao: "Parcialmente nublado" };
}

function previsao(opcoes: { chance?: number; rajada?: number; mm?: number; gravidade?: number } = {}): Previsao {
  const chance = opcoes.chance ?? 10;
  const rajada = opcoes.rajada ?? 18;
  const mm = opcoes.mm ?? 0;
  const cond = condicaoDaGravidade(opcoes.gravidade);
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
    icone: cond.icone,
    descricao: cond.descricao,
  }));
  const dia = (max: number, min: number) => ({
    data: "2026-10-02",
    rotulo: "Hoje",
    dataCurta: "2 de outubro",
    max,
    min,
    chuvaMm: mm,
    chanceChuva: chance,
    icone: cond.icone,
    descricao: cond.descricao,
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

test("radar: detecta a chuva entrando na previsão (vento e temperatura ficam de fora)", () => {
  const antes = instantaneo({ chance: 10, rajada: 18, mm: 0 });
  const depois = instantaneo({ chance: 75, rajada: 52, mm: 6.5, gravidade: 5 }, Date.now() + 60_000);
  const m = detectarMudancas(antes, depois, "media");
  const tipos = m.map((x) => x.tipo);
  assert.ok(tipos.includes("chuva"), "mudança de chuva detectada");
  assert.ok(tipos.includes("condicao"), "mudança da condição do tempo detectada");
  // O radar vigia SÓ a previsão de chuva/neblina/tempestade: vento, rajada e
  // temperatura mudaram junto (18 → 52 km/h) e NÃO viraram aviso.
  assert.ok(m.every((x) => x.origem === "api"), "só a previsão (WRF) entra no aviso");
  assert.ok(!m.some((x) => /vento|rajada|temperatura|máxima|mínima/i.test(x.rotulo)), "vento/temperatura de fora");
  // Chuva entrando é grave: a notificação fica na tela até o motorista tocar.
  assert.ok(m.some((x) => x.grave));
  const chuva = m.find((x) => x.tipo === "chuva");
  assert.ok(chuva?.frase.includes("10%"));
  assert.ok(chuva?.frase.includes("75%"));
  assert.match(chuva?.assinatura ?? "", /^chuvaProb6h:/);
});

test("radar: neblina forte e tempestade na previsão também viram aviso", () => {
  // Neblina forte entrando na previsão das próximas horas.
  const comNeblina = detectarMudancas(
    instantaneo({}),
    instantaneo({ gravidade: 3 }, Date.now() + 60_000),
    "media",
  );
  const neblina = comNeblina.find((x) => x.tipo === "condicao");
  assert.ok(neblina, "neblina na previsão vira aviso");
  assert.match(neblina.agora, /neblina/i);
  // Tempestade entrando na previsão (grave: fica na tela até tocar).
  const comTempestade = detectarMudancas(
    instantaneo({}),
    instantaneo({ gravidade: 7 }, Date.now() + 60_000),
    "media",
  );
  const tempestade = comTempestade.find((x) => x.tipo === "condicao");
  assert.ok(tempestade, "tempestade na previsão vira aviso");
  assert.equal(tempestade.grave, true);
});

test("radar: previsão de tempo bom (ou melhorando) NÃO vira mensagem nem notificação", () => {
  // Chance de chuva subindo, mas continua baixa (30% → 45%): tempo bom.
  const aindaBom = detectarMudancas(
    instantaneo({ chance: 30 }),
    instantaneo({ chance: 45 }, Date.now() + 60_000),
    "alta",
  );
  assert.equal(aindaBom.length, 0, "chance baixa não avisa em nenhuma sensibilidade");
  // A chuva SAIU da previsão (75% → 10%, condição volta a sol): silêncio.
  const melhorou = detectarMudancas(
    instantaneo({ chance: 75, mm: 6.5, gravidade: 5 }),
    instantaneo({ chance: 10, mm: 0 }, Date.now() + 60_000),
    "alta",
  );
  assert.equal(melhorou.length, 0, "a previsão melhorando não gera aviso");
  // Hoje/amanhã com a chance despencando (80% → 20%): tempo bom, sem aviso.
  const dias = detectarMudancas(
    instantaneo({ chance: 80, mm: 4 }),
    instantaneo({ chance: 20, mm: 0 }, Date.now() + 60_000),
    "media",
  );
  assert.equal(dias.filter((x) => /hoje|amanhã/i.test(x.rotulo)).length, 0, "próximos dias bons não avisam");
});

test("radar: abaixo do limite da sensibilidade não avisa (antispam)", () => {
  const antes = instantaneo({ chance: 55, rajada: 20 });
  const depois = instantaneo({ chance: 70, rajada: 28 }, Date.now() + 60_000);
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

test("radar: mudança de chuva no painel lido pelo Composio também vira aviso", () => {
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
  // O vento do painel mudou junto (7 → 28 nós) e NÃO vira aviso: o radar só
  // vigia chuva, neblina e tempestade na previsão.
  assert.ok(m.every((x) => x.tipo === "chuva"), "só chuva entra no aviso");
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

test("radar: alerta do painel que NÃO é chuva/neblina/tempestade fica em silêncio", () => {
  const base = parsearPainelSimport(PAINEL);
  assert.ok(base);
  const semAlerta = { ...base, alertas: [] };
  const antes = montarInstantaneo(null, semAlerta, Date.now(), null, "api");
  // Vendaval (só vento) e ressaca (só mar) não são vigiados pelo radar.
  const depois = montarInstantaneo(
    null,
    { ...base, alertas: ["Vendaval com rajadas de 60 km/h no pátio", "Ressaca com ondas de 3 m no canal"] },
    Date.now() + 60_000,
    null,
    "api",
  );
  const m = detectarMudancas(antes, depois, "alta");
  assert.equal(m.filter((x) => x.tipo === "alerta").length, 0, "alerta fora do escopo não avisa");
  // Neblina forte como alerta novo do painel: avisa.
  const comNeblina = montarInstantaneo(
    null,
    { ...base, alertas: ["Neblina forte reduz a visibilidade no acesso ao porto"] },
    Date.now() + 120_000,
    null,
    "api",
  );
  const alerta = detectarMudancas(antes, comNeblina, "alta").find((x) => x.tipo === "alerta");
  assert.ok(alerta, "neblina forte vira aviso");
  assert.match(alerta.agora, /neblina/i);
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
  // A chuva SAIU da previsão do painel (tempo bom): nada de aviso.
  const semChuva = { ...base, alertas: [], chuva: [] as { hora: string; mm: number; prob: number }[] };
  const limpo = montarInstantaneo(null, semChuva, Date.now() + 180_000, null, "api");
  assert.equal(limpo.painel?.inicioChuva, null, "sem chuva prevista no painel");
  assert.equal(
    detectarMudancas(depois, limpo, "alta").filter((x) => x.tipo === "chuva" || x.tipo === "condicao").length,
    0,
    "chuva saindo da previsão não vira mensagem",
  );
});

test("radar: boletim da APPA com chuva/neblina/tempestade entra no aviso (tempo bom, não)", () => {
  const antes = montarInstantaneo(
    { ...previsao(), boletim: [{ data: "2026-10-02", texto: "Sol com nuvens.", tempoRuim: false }] },
    null,
  );
  const depois = montarInstantaneo(
    {
      ...previsao(),
      boletim: [{ data: "2026-10-02", texto: "Chuva forte no porto.", tempoRuim: true }],
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
    "ligou o alerta de tempo ruim",
  );
  // Boletim revisado com TEMPO BOM (sol, sem chuva): não vira aviso.
  const ficouBom = montarInstantaneo(
    {
      ...previsao(),
      boletim: [{ data: "2026-10-02", texto: "Céu aberto e tempo firme no porto.", tempoRuim: false }],
    },
    null,
    Date.now() + 90_000,
  );
  assert.equal(
    detectarMudancas(depois, ficouBom, "media").filter((x) => x.tipo === "boletim").length,
    0,
    "boletim de tempo bom não gera mensagem",
  );
  // Um dia novo de boletim com tempo bom também NÃO avisa…
  const novoDiaBom = montarInstantaneo(
    {
      ...previsao(),
      boletim: [
        { data: "2026-10-02", texto: "Chuva forte no porto.", tempoRuim: true },
        { data: "2026-10-03", texto: "Tempo firme pela manhã.", tempoRuim: false },
      ],
    },
    null,
    Date.now() + 120_000,
  );
  assert.ok(
    !detectarMudancas(depois, novoDiaBom, "media").some((x) => x.rotulo.includes("2026-10-03")),
    "dia novo de tempo bom não avisa",
  );
  // …mas com previsão de chuva/neblina/tempestade, avisa (assinatura própria).
  const novoDiaRuim = montarInstantaneo(
    {
      ...previsao(),
      boletim: [
        { data: "2026-10-02", texto: "Chuva forte no porto.", tempoRuim: true },
        { data: "2026-10-03", texto: "Pancadas de chuva à tarde.", tempoRuim: true },
      ],
    },
    null,
    Date.now() + 120_000,
  );
  assert.ok(
    detectarMudancas(depois, novoDiaRuim, "media").some((x) => x.rotulo.includes("2026-10-03")),
    "dia novo com chuva avisa",
  );
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
  assert.match(t, /🌧️|⛈️/, "chuva na previsão sai com emoji de chuva");
  // Tempestade e neblina forte escolhem o próprio emoji.
  const tempestade = detectarMudancas(instantaneo({}), instantaneo({ gravidade: 7 }, Date.now() + 1000), "media");
  assert.match(textoMudancaPadrao(tempestade, null), /⛈️/);
  const neblina = detectarMudancas(instantaneo({}), instantaneo({ gravidade: 3 }, Date.now() + 1000), "media");
  assert.match(textoMudancaPadrao(neblina, null), /🌫️/);
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

test("radar: a medição do tempo ATUAL (Composio/estação) NÃO vira aviso — só a previsão", () => {
  // A leitura do Composio (OpenWeather) continua no instantâneo para o
  // diagnóstico do administrador…
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
  // …mas NÃO entra na comparação do radar: tempo atual não é previsão.
  // Começou a chover agora, esquentou, ventou — nada disso gera mensagem.
  assert.equal(detectarMudancas(antes, depois, "alta").length, 0, "medição atual não vira aviso");
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

test("radar: 1ª leitura só registra; mudança real avisa 1 vez no chat e por Push", { skip: !local }, async () => {
  const { db, pool } = await import("../src/db");
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

  // Cenário da previsão (mutável): chance de chuva, rajada e condição.
  let cenario = { chance: 10, rajada: 18, mm: 0, gravidade: 0 };
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
              temperature: 21,
              relativeHumidity: 80,
              thermalSensation: 21,
              chanceOfRain: cenario.chance,
              icon: cenario.gravidade === 5 ? 1186 : 1003,
            }
          : {}),
        ...(url.includes("windGust")
          ? { windSpeed: Math.round((cenario.rajada / 1.852) * 0.6), windGust: Math.round(cenario.rajada / 1.852), windDirection: 135 }
          : {}),
        ...(url.includes("hourlyPrecipitation")
          ? { temperatureAverage: 21, thermalSensationAverage: 21, humidityAverage: 80, hourlyPrecipitation: 0 }
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
    cenario = { chance: 80, rajada: 55, mm: 6.5, gravidade: 5 };
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

    // 4) A previsão FICOU BOA (a chuva saiu, o céu abriu): o radar NÃO manda
    //    mensagem no chat e NÃO dispara notificação — silêncio total.
    cenario = { chance: 10, rajada: 14, mm: 0, gravidade: 0 };
    const r4 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r4.postou, false, "tempo bom na previsão não posta");
    assert.match(r4.motivo, /sem mudança/i);
    assert.equal((await db.select().from(chatMensagens)).length, 1, "nada novo no chat");
    assert.equal(pushes.length, 1, "nada de notificação com tempo bom");

    // 4b) O alerta/boletim do clima já falou neste minuto e a previsão volta a
    //     trazer chuva: o radar cala a boca, mas avança a referência (não avisa
    //     de novo no ciclo seguinte).
    cenario = { chance: 90, rajada: 60, mm: 8, gravidade: 5 };
    const r4b = await verificarMudancasPrevisao({ forcar: true, registrarSomente: true });
    assert.equal(r4b.postou, false);
    assert.match(r4b.motivo, /já avisou/i);
    assert.equal((await db.select().from(chatMensagens)).length, 1);

    // 5) Mudança nova de tempo ruim de verdade (volume previsto 8 → 14 mm)
    //    volta a avisar.
    cenario = { chance: 97, rajada: 70, mm: 14, gravidade: 5 };
    const r5 = await verificarMudancasPrevisao({ forcar: true });
    assert.equal(r5.postou, true, `motivo: ${r5.motivo}`);
    assert.equal((await db.select().from(chatMensagens)).length, 2);
    assert.equal(pushes.length, 2);

    // 6) Status do radar para a tela Tempo e para o painel.
    const s = await statusRadarClima();
    assert.equal(s.ativo, true);
    assert.equal(s.sensibilidade, "media");
    assert.ok(s.ultimaVerificacao);
    assert.equal(s.mudancas24h, (await db.select().from(climaMudancas)).length);
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
    await pool.end();
  }
});
