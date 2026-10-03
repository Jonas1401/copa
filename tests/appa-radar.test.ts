import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizarLeitura } from "../src/lib/appa/analise";
import { parsearPainelSimport } from "../src/lib/appa/painel";
import type { MetodoLeitura, PainelSimport, Sinais } from "../src/lib/appa/tipos";
import {
  completarReferencia,
  condicaoDaMudanca,
  confirmarPorOcr,
  detectarMudancas,
  diagnosticoValido,
  emojiDoAlerta,
  instanteDaHora,
  montarInstantaneo,
  notificacaoDoAlerta,
  painelGuardado,
  statusDoPainel,
  textoAlertaMeteorologico,
  textoMudancaPadrao,
  type DiagnosticoPainel,
  type InstantaneoClima,
  type Mudanca,
} from "../src/lib/clima-monitor";

/**
 * RADAR DA PREVISÃO — o que muda quando a leitura do painel é NORMALIZADA:
 * início de chuva, chuva mais forte, chuva forte, tempestade, alerta novo,
 * horário previsto diferente e o texto "ALERTA METEOROLÓGICO". E o que NÃO pode
 * acontecer: aviso repetido, falso alarme por trocar de método de leitura.
 *
 *   ./node_modules/.bin/tsx --test tests/appa-radar.test.ts
 */
process.env.APPA_LOG = "0";

const PAINEL_REAL = readFileSync(new URL("./fixtures/appa-painel-real.md", import.meta.url), "utf8");
/** 03/10/2026 08:20 em Brasília. */
const EM = Date.parse("2026-10-03T11:20:00Z");

const base = (): PainelSimport => parsearPainelSimport(PAINEL_REAL)!;
const comChuva = (p: PainelSimport, hora: string, mm: number, prob = 80): PainelSimport => ({
  ...p,
  chuva: p.chuva.map((c) => (c.hora === hora ? { ...c, mm, prob } : c)),
});
const comBoletim = (p: PainelSimport, dia: string, texto: string): PainelSimport => ({
  ...p,
  boletim: p.boletim.map((b) => (b.dia === dia ? { ...b, texto } : b)),
});

const snap = (painel: PainelSimport, metodo: MetodoLeitura = "api", em = EM, sinais?: Sinais): InstantaneoClima =>
  montarInstantaneo(null, normalizarLeitura({ painel, metodo, em: new Date(em), sinais }), em);

const tipos = (m: Mudanca[]) => m.map((x) => `${x.tipo}:${x.rotulo}`);
const achar = (m: Mudanca[], rotulo: RegExp) => m.find((x) => rotulo.test(x.rotulo));

/* ================================================== eventos do painel */

test("radar: começou a chover (início de chuva) e a intensidade subiu", () => {
  const antes = snap(base());
  assert.equal(antes.painel?.chuva?.chovendo, false);

  const inicio = detectarMudancas(antes, snap(comChuva(base(), "08:00", 0.4, 70), "api", EM + 300_000), "media");
  const m = achar(inicio, /Início de chuva/);
  assert.ok(m, `início de chuva detectado: ${tipos(inicio)}`);
  assert.equal(m.condicao, "chuva");
  assert.equal(m.grave, false);
  assert.equal(m.origem, "painel");

  // Chuva fraca em andamento → moderada: "intensidade subiu".
  const fraca = snap(comChuva(base(), "08:00", 0.4, 70));
  const mais = detectarMudancas(fraca, snap(comChuva(base(), "08:00", 2.5, 90), "api", EM + 300_000), "media");
  const nivel = achar(mais, /Intensidade da chuva/);
  assert.ok(nivel, `intensidade detectada: ${tipos(mais)}`);
  assert.match(nivel.frase, /subiu de chuva fraca para chuva moderada/);
  assert.equal(nivel.condicao, "chuva moderada");
  // Sensibilidade baixa só se importa com chuva moderada ou pior.
  assert.equal(achar(detectarMudancas(snap(base()), snap(comChuva(base(), "10:00", 0.4), "api", EM + 1000), "baixa"), /Intensidade/), undefined);
});

test("radar: chuva forte prevista (grave) leva a hora e a condição para o aviso", () => {
  const antes = snap(base());
  const depois = snap(comChuva(base(), "14:00", 6.4, 92), "playwright", EM + 300_000);
  const m = detectarMudancas(antes, depois, "media");
  const forte = achar(m, /Chuva forte prevista/);
  assert.ok(forte);
  assert.equal(forte.grave, true);
  assert.equal(forte.condicao, "chuva forte");
  assert.equal(forte.horario, "14:00");
  assert.equal(m[0].tipo, "chuva", "a mais importante vem primeiro");
  // Não repete como "intensidade" a mesma mudança.
  assert.equal(achar(m, /Intensidade da chuva/), undefined);

  const texto = textoAlertaMeteorologico(m);
  assert.equal(
    texto,
    [
      "🌧️ ALERTA METEOROLÓGICO",
      "",
      "Foi identificada uma mudança na previsão meteorológica da região do Porto de Paranaguá.",
      "",
      "Condição: chuva forte",
      "Horário: 14:00",
      "Mudança: Chuva forte prevista para as 14:00",
      "",
      "Fonte: SIMPORT® / APPA",
    ].join("\n"),
  );
});

test("radar: tempestade no boletim e alerta novo são graves e dizem quando", () => {
  const antes = snap(
    comBoletim(base(), "04/10", "Dia de céu encoberto com chuvas fracas e intermitentes ao longo do dia, sem outros fenômenos."),
  );
  assert.equal(antes.painel?.textos?.tempestade, false);
  const depois = snap(base(), "html", EM + 300_000); // o boletim real fala em tempestades com atividade elétrica
  const m = detectarMudancas(antes, depois, "media");
  const t = achar(m, /Possibilidade de tempestade/);
  assert.ok(t, `tempestade detectada: ${tipos(m)}`);
  assert.equal(t.grave, true);
  assert.equal(t.tipo, "tempestade");
  assert.equal(t.condicao, "tempestade");
  assert.equal(t.horario, "04/10, madrugada e manhã");
  assert.equal(m[0].tipo, "tempestade");
  assert.equal(emojiDoAlerta(m), "⛈️");
  assert.match(textoAlertaMeteorologico(m), /^⛈️ ALERTA METEOROLÓGICO\n/);
  assert.match(textoAlertaMeteorologico(m), /Condição: tempestade/);
  assert.match(textoAlertaMeteorologico(m), /Horário: 04\/10, madrugada e manhã/);
  // O alerta do mesmo boletim não vira uma 2ª mensagem sobre a mesma tempestade.
  assert.equal(achar(m, /Novo alerta meteorológico/), undefined);

  // Alerta sem tempestade (ex.: "Atenção: ventos fortes"): entra como alerta novo, grave.
  const semAlerta = snap(comBoletim(base(), "03/10", "Céu encoberto com chuvas fracas e intermitentes durante a madrugada."));
  const comAlerta = snap(
    comBoletim(base(), "03/10", "Atenção: ventos fortes com rajadas durante a tarde, principalmente no litoral."),
    "api",
    EM + 300_000,
  );
  const a = achar(detectarMudancas(semAlerta, comAlerta, "media"), /Novo alerta meteorológico/);
  assert.ok(a);
  assert.equal(a.grave, true);
  assert.equal(a.condicao, "alerta meteorológico");
  assert.match(a.frase, /^novo alerta meteorológico: 03\/10: Atenção: ventos fortes/);
});

test("radar: horário previsto mudou (compara instantes, não a janela deslizante de 24 h)", () => {
  const antes = snap(comChuva(base(), "14:00", 0.5));
  assert.equal(antes.painel?.chuva?.horaInicio, "14:00");
  assert.equal(antes.painel?.chuva?.inicioMs, Date.parse("2026-10-03T17:00:00Z"));

  const depois = snap(comChuva(comChuva(base(), "14:00", 0), "20:00", 0.5), "api", EM + 600_000);
  const m = detectarMudancas(antes, depois, "media");
  const h = achar(m, /Horário previsto \(início da chuva\)/);
  assert.ok(h, `horário alterado: ${tipos(m)}`);
  assert.match(h.frase, /mudou de 14:00 para 20:00/);
  assert.equal(h.horario, "20:00");

  // A grade do painel é de 2 em 2 h: 2 h de diferença avisa na sensibilidade média/alta, não na baixa (3 h).
  const duasHoras = snap(comChuva(comChuva(base(), "14:00", 0), "16:00", 0.5), "api", EM + 600_000);
  assert.ok(achar(detectarMudancas(antes, duasHoras, "media"), /Horário previsto/));
  assert.equal(achar(detectarMudancas(antes, duasHoras, "baixa"), /Horário previsto/), undefined);

  // O tempo passou e a chuva "anterior" já aconteceu: o painel desliza e isso NÃO é horário alterado.
  const tarde = EM + 8 * 3_600_000; // 16:20
  const noite = snap(comChuva(base(), "18:00", 0.5), "api", tarde);
  assert.equal(achar(detectarMudancas(antes, noite, "media"), /Horário previsto/), undefined);

  assert.equal(instanteDaHora("14:00", EM), Date.parse("2026-10-03T17:00:00Z"));
  assert.equal(instanteDaHora("05:00", EM), Date.parse("2026-10-04T08:00:00Z"), "madrugada do dia seguinte");
  assert.equal(instanteDaHora("lixo", EM), null);
});

test("radar: sem mudança real, sem aviso (mesma leitura, maré, horário do sol e dia novo no boletim)", () => {
  const a = snap(base());
  assert.deepEqual(detectarMudancas(a, snap(base(), "api", EM + 300_000), "alta"), []);

  // Maré e sol só informam: aparecem na lista mas ficam marcados como secundários.
  const outroDia = base();
  const m = detectarMudancas(
    a,
    snap({ ...outroDia, mares: outroDia.mares.slice(1), nascerSol: "04:52", porSol: "17:16" }, "api", EM + 300_000),
    "alta",
  );
  assert.deepEqual(m.map((x) => x.tipo).sort(), ["mare", "sol"]);
  assert.ok(m.every((x) => x.secundaria), "maré e sol não disparam aviso sozinhas");

  // O sol vindo como "-" (método sem esse dado) não vira mudança.
  const semSol = detectarMudancas(a, snap({ ...base(), nascerSol: null, porSol: null, mares: [] }, "api", EM + 300_000), "alta");
  assert.equal(semSol.filter((x) => x.tipo === "sol" || x.tipo === "mare").length, 0);

  // Um dia que só entrou na janela do boletim não é "mudança de previsão" (a menos que seja grave).
  const com3 = { ...base(), boletim: [...base().boletim, { dia: "05/10", texto: "Céu parcialmente nublado, sem previsão de chuva significativa no litoral." }] };
  const aniversario = detectarMudancas(
    montarInstantaneo(null, normalizarLeitura({ painel: base(), metodo: "api", em: new Date(EM) }), EM),
    montarInstantaneo(null, normalizarLeitura({ painel: com3, metodo: "api", em: new Date(EM) }), EM + 300_000),
    "media",
  ).find((x) => x.tipo === "boletim");
  assert.ok(aniversario);
  assert.equal(aniversario.secundaria, true);
  const grave = { ...base(), boletim: [...base().boletim, { dia: "05/10", texto: "Atenção: chuvas fortes e rajadas de vento previstas para toda a tarde." }] };
  const novoGrave = detectarMudancas(
    snap(base()),
    snap(grave, "api", EM + 300_000),
    "media",
  ).find((x) => x.tipo === "boletim");
  assert.equal(novoGrave?.secundaria, false);
});

test("radar: trocar o método de leitura (API → OCR → HTML) não gera falso 'boletim revisado'", () => {
  const original = base();
  // O mesmo boletim lido por OCR: sem acento, sem vírgula, uma palavra trocada.
  const ocr = comBoletim(
    original,
    "04/10",
    "Atenção: O tempo permanece instavel durante a madrugada e a manhã com previsão de chuvas e possibilidade de tempestades com atividade eletrica. No decorrer da tarde a instabilidade diminui com aberturas de sol. A noite as chuvas voltam a se intensificar.",
  );
  const api = snap(original, "api");
  assert.equal(achar(detectarMudancas(api, snap(ocr, "ocr", EM + 300_000), "alta"), /Boletim da APPA/), undefined);
  assert.equal(achar(detectarMudancas(snap(ocr, "ocr"), snap(original, "html", EM + 300_000), "alta"), /Boletim da APPA/), undefined);

  // Mas um boletim REALMENTE revisado continua sendo avisado, em qualquer método.
  const revisado = comBoletim(original, "04/10", "O tempo melhora: céu aberto, sem chuva e ventos fracos ao longo de todo o dia, com temperatura em elevação.");
  assert.ok(achar(detectarMudancas(api, snap(revisado, "ocr", EM + 300_000), "alta"), /Boletim da APPA \(04\/10\)/));
  assert.ok(achar(detectarMudancas(api, snap(revisado, "html", EM + 300_000), "alta"), /Boletim da APPA \(04\/10\)/));

  // Painel lido com tabela e depois SÓ com o cartão do topo: os números das tabelas não viram "caiu para 0%".
  const soTopo: PainelSimport = { ...base(), chuva: [], vento: [], mares: [], boletim: [] };
  const m = detectarMudancas(snap(comChuva(base(), "14:00", 0.5, 80)), snap(soTopo, "api", EM + 300_000), "alta");
  assert.equal(m.filter((x) => x.origem === "painel").length, 0);
});

test("radar: fonte que a referência não tinha entra nela (e instantâneo antigo ganha os blocos novos)", () => {
  const atual = snap(base());
  // Referência de antes do painel normalizado: sem `chuva` e sem `textos`.
  const antigo = JSON.parse(JSON.stringify(atual)) as InstantaneoClima;
  delete antigo.painel!.chuva;
  delete antigo.painel!.textos;
  delete antigo.painel!.metodo;
  const r1 = completarReferencia(antigo, atual);
  assert.equal(r1.completou, true);
  assert.ok(r1.referencia.painel?.chuva);
  assert.ok(r1.referencia.painel?.textos);
  // Sem aviso nenhum só por ter completado a referência.
  assert.deepEqual(detectarMudancas(r1.referencia, atual, "alta"), []);

  // Referência sem painel nenhum (ele só passou a ser lido agora).
  const semPainel: InstantaneoClima = { ...atual, painel: null, boletim: null, fontes: { ...atual.fontes, painel: false } };
  const r2 = completarReferencia(semPainel, atual);
  assert.equal(r2.completou, true);
  assert.deepEqual(r2.referencia.painel, atual.painel);
  assert.equal(r2.referencia.fontes.painel, true);
  // Nada a completar: devolve igual.
  assert.equal(completarReferencia(atual, atual).completou, false);
});

/* ================================================== texto e notificação */

test("alerta: texto cabe na notificação e os títulos seguem o tipo do fenômeno", () => {
  const forte = detectarMudancas(snap(base()), snap(comChuva(base(), "14:00", 6.4, 92), "api", EM + 1000), "media");
  const n = notificacaoDoAlerta(forte);
  assert.equal(n.titulo, "🌧️ ALERTA METEOROLÓGICO");
  assert.equal(
    n.corpo,
    ["Mudança na previsão do Porto de Paranaguá.", "Condição: chuva forte", "Horário: 14:00", "Fonte: SIMPORT® / APPA"].join("\n"),
  );
  assert.ok(n.corpo.length <= 220, "o Android corta o corpo da notificação em ~220 caracteres");
  assert.ok(textoAlertaMeteorologico(forte).length <= 480);

  // Vento forte (API): emoji de vento e condição "vento".
  const vento = detectarMudancas(
    snap({ ...base(), vento: base().vento.map((v) => ({ ...v, nos: 3 })) }),
    snap({ ...base(), vento: base().vento.map((v) => ({ ...v, nos: 28 })) }, "api", EM + 1000),
    "media",
  );
  assert.equal(emojiDoAlerta(vento), "💨");
  assert.equal(condicaoDaMudanca(vento[0]), "vento");
  assert.equal(vento[0].grave, true);

  // O nome antigo continua existindo e devolve o mesmo formato.
  assert.equal(textoMudancaPadrao(forte, null), textoAlertaMeteorologico(forte));
  assert.match(textoMudancaPadrao(vento, null), /💨 ALERTA METEOROLÓGICO/);
  assert.match(textoMudancaPadrao(vento, null), /Fonte: SIMPORT® \/ APPA$/);
});

/* ================================================== status da tela */

const leituraDe = (metodo: MetodoLeitura) => normalizarLeitura({ painel: base(), metodo, em: new Date(EM) });
const diag = (extra: Partial<DiagnosticoPainel> = {}): DiagnosticoPainel => ({
  em: EM,
  status: "sucesso",
  metodo: "api",
  erro: null,
  duracaoMs: 800,
  tentativas: [],
  log: ["[08:20:01] APPA · #1 API · SUCESSO · 812 ms · chuva 12"],
  historico: [],
  ...extra,
});

test("tela: 'Painel APPA: conectado' (API) ou 'leitura realizada' (outros métodos) + método de leitura", () => {
  const api = statusDoPainel({ em: EM, leitura: leituraDe("api") }, diag());
  assert.equal(api.situacao, "conectado");
  assert.equal(api.rotulo, "Painel APPA: conectado");
  assert.equal(api.metodoRotulo, "API");
  assert.equal(api.erro, null);

  const nomes: [MetodoLeitura, string][] = [
    ["html", "HTML direto"],
    ["playwright", "Navegador automático"],
    ["ocr", "OCR"],
    ["composio", "Composio"],
  ];
  for (const [m, rotulo] of nomes) {
    const s = statusDoPainel({ em: EM, leitura: leituraDe(m) }, diag({ metodo: m }));
    assert.equal(s.situacao, "leitura-realizada", m);
    assert.equal(s.rotulo, "Painel APPA: leitura realizada");
    assert.equal(s.metodoRotulo, rotulo);
    assert.equal(s.erro, null);
  }
  // A leitura sai no formato normalizado, sem os detalhes internos.
  assert.equal(api.leitura?.fonte, "APPA");
  assert.ok(api.leitura && !("detalhes" in api.leitura));
  assert.equal(api.log.length, 1);
});

test("tela: erro SÓ quando todos os métodos falharam; antes da 1ª leitura fica 'aguardando'", () => {
  const todos = statusDoPainel(
    { em: EM - 600_000, leitura: leituraDe("api") },
    diag({ status: "erro", metodo: null, erro: "Nenhum método conseguiu ler o painel da APPA — API: HTTP 503 | HTML direto: vazio" }),
  );
  assert.equal(todos.situacao, "erro");
  assert.equal(todos.rotulo, "Painel APPA: sem leitura");
  assert.match(todos.erro ?? "", /Nenhum método conseguiu/);
  assert.equal(todos.metodoRotulo, null);

  const nada = statusDoPainel(null, null);
  assert.equal(nada.situacao, "aguardando");
  assert.equal(nada.rotulo, "Painel APPA: aguardando a primeira leitura");
  assert.equal(nada.erro, null, "sem tentativa não há erro para mostrar");

  // Uma leitura parcial é leitura (não é erro), só marcada como parcial.
  const parcial = statusDoPainel({ em: EM, leitura: leituraDe("api") }, diag({ status: "parcial" }));
  assert.equal(parcial.parcial, true);
  assert.equal(parcial.erro, null);
  assert.notEqual(parcial.situacao, "erro");
});

test("armazenamento: aceita o formato antigo do Composio e ignora lixo", () => {
  const antigo = painelGuardado(JSON.stringify({ em: EM, dados: base() }));
  assert.ok(antigo);
  assert.equal(antigo.leitura.metodo_leitura, "composio", "o formato antigo era só do Composio");
  assert.equal(antigo.leitura.detalhes.painel.chuva.length, 12);

  const novo = painelGuardado(JSON.stringify({ em: EM, leitura: leituraDe("html") }));
  assert.equal(novo?.leitura.metodo_leitura, "html");
  assert.equal(painelGuardado("lixo"), null);
  assert.equal(painelGuardado(null), null);
  assert.equal(painelGuardado(JSON.stringify({ em: EM })), null);

  assert.equal(diagnosticoValido("{}"), null);
  assert.equal(diagnosticoValido(JSON.stringify(diag()))?.log.length, 1);
});

test("OCR erra dígito: mudança do painel lida por OCR só avisa se se repetir no ciclo seguinte", () => {
  const forte = detectarMudancas(snap(base(), "ocr"), snap(comChuva(base(), "14:00", 6.4, 92), "ocr", EM + 300_000), "media");
  assert.ok(forte.some((m) => m.origem === "painel" && m.grave));

  // 1º ciclo: fica pendente (nada avisa).
  const c1 = confirmarPorOcr(forte, "ocr", null);
  assert.equal(c1.liberadas.filter((m) => m.origem === "painel").length, 0);
  assert.ok(c1.pendente && c1.seguradas > 0);
  // 2º ciclo com a MESMA mudança: confirmada, avisa e limpa o pendente.
  const c2 = confirmarPorOcr(forte, "ocr", c1.pendente);
  assert.deepEqual(c2.liberadas, forte);
  assert.equal(c2.pendente, null);
  // Outra mudança no 2º ciclo (o dígito lido errado sumiu): nada avisa e a pendência troca.
  const outra = detectarMudancas(snap(base(), "ocr"), snap(comChuva(base(), "16:00", 5, 80), "ocr", EM + 600_000), "media");
  const c3 = confirmarPorOcr(outra, "ocr", c1.pendente);
  assert.notEqual(c3.pendente, c1.pendente);
  assert.equal(c3.liberadas.filter((m) => m.origem === "painel").length, 0);

  // Qualquer outro método (ou mudança que não é do painel) nunca espera.
  for (const m of ["api", "html", "playwright", "composio", null] as const) {
    assert.deepEqual(confirmarPorOcr(forte, m, null).liberadas, forte, String(m));
  }
  const daApi: Mudanca[] = forte.map((m) => ({ ...m, origem: "api" as const }));
  assert.deepEqual(confirmarPorOcr(daApi, "ocr", null).liberadas, daApi);
});
