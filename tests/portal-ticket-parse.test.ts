import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dataDoPortal,
  ehAbaDoTicket,
  extrairFormularioDeTicket,
  hojeEmBrasilia,
  interpretarTickets,
  juntarLancamentos,
  lerQuantDoTicket,
  lerValorDoTicket,
  mascararNumeros,
  montarPedidoDeTicket,
  semanaDeHoje,
  type FormularioDeTicket,
  type LancamentoDoTicket,
  type TicketsDaTela,
} from "../src/lib/portal-ticket-parse";
import { telaTicket, telaTickets, valorDoPontoFalso, type LancamentoFalso, type TicketFalso } from "./portal-fixture";

/**
 * A ABA “TICKET” DO PORTAL (a “2ª Via de Ticket”) — só a interpretação.
 *
 * É de onde sai o “Saldo de Ganhos” do app: viagens, valor bruto e comissão
 * da semana. Vira dinheiro na tela do motorista, então o que não está completo
 * e coerente é RECUSADO — nunca vira “nenhuma viagem” nem uma soma pela metade.
 *
 * Sem rede e sem banco. Todos os dados são inventados. A tela imita a que o
 * dono do app enviou em foto: as listas PONTO e SEMANA com o botão “Gerar” e,
 * no resultado, o período, o botão “Gerar PDF” e o quadro “Lançamentos” (PONTO
 * · QUANT · VALOR · SERVIÇO · DATA · HORA). O HTML de verdade nunca foi visto,
 * por isso o quadro é testado em três formas.
 */

const SEMANAS = ["09/11/2026 - 16/11/2026", "02/11/2026 - 09/11/2026", "26/10/2026 - 02/11/2026"];
const SEMANA = { inicio: "2026-11-09", fim: "2026-11-16" };
const VIAGENS: LancamentoFalso[] = [
  { quant: "29.920", valor: "17.29", servico: "FRETE ATE 5 KM", data: "09/11/2026", hora: "21:00" },
  { quant: "32.140", valor: "17.29", servico: "FRETE ATE 5 KM", data: "10/11/2026", hora: "03:40" },
  { quant: "30.000", valor: "21.12", servico: "FRETE DE 5 A 10 KM", data: "10/11/2026", hora: "14:05" },
];
const conta = (extra: Partial<TicketFalso> = {}): TicketFalso => ({
  pontos: ["A701", "A777", "B702"],
  semanas: SEMANAS,
  lancamentos: { "1|0": VIAGENS },
  ...extra,
});
const formulario = (html: string): FormularioDeTicket => {
  const f = extrairFormularioDeTicket(html);
  assert.ok(!("motivo" in f), "motivo" in f ? `formulário recusado: ${f.motivo}` : "");
  return f as FormularioDeTicket;
};
const recusaDoFormulario = (html: string) => {
  const f = extrairFormularioDeTicket(html);
  assert.ok("motivo" in f, "o formulário devia ter sido recusado");
  return f as { motivo: string; estrutura: string[] };
};
const ler = (html: string, codigo = "A777", semana = SEMANA) => interpretarTickets(html, { codigo, ...semana });
const boa = (r: TicketsDaTela) => {
  assert.ok(r.ok, r.ok ? "" : `leitura recusada: ${r.motivo}`);
  return r as Extract<TicketsDaTela, { ok: true }>;
};
const motivo = (r: TicketsDaTela) => {
  assert.ok(!r.ok, "a leitura devia ter sido recusada");
  return (r as Extract<TicketsDaTela, { ok: false }>).motivo;
};
const amostra = (r: TicketsDaTela) => (r as Extract<TicketsDaTela, { ok: false }>).amostra;
/** Troca um trecho da tela (e confere que ele existia). */
const trocar = (html: string, de: string, para: string) => {
  assert.ok(html.includes(de), `a tela de teste não tem “${de}”`);
  return html.replace(de, para);
};

/* ------------------------------------------------------------- formulário */

test("só a aba “Ticket” do menu é a do ticket", () => {
  assert.ok(ehAbaDoTicket("Ticket"));
  assert.ok(ehAbaDoTicket(" tickets "));
  for (const outra of ["Fila", "Status", "Ponto", "Gerar PDF", "2ª via", "Ticket PDF"]) assert.equal(ehAbaDoTicket(outra), false, outra);
});

test("o formulário da tela enviada: lista de pontos, lista de semanas e o Gerar", () => {
  const f = formulario(telaTicket(conta()));
  assert.equal(f.method, "post");
  assert.equal(f.action, "ticket_lista.php");
  assert.equal(f.campoPonto, "id_ponto");
  assert.equal(f.campoSemana, "semana");
  assert.deepEqual(
    f.pontos,
    [0, 1, 2].map((i) => ({ valor: valorDoPontoFalso(i), codigo: ["A701", "A777", "B702"][i] })),
  );
  assert.deepEqual(
    f.semanas.map((s) => [s.valor, s.inicio, s.fim, s.selecionada]),
    [
      ["2026-11-09", "2026-11-09", "2026-11-16", true],
      ["2026-11-02", "2026-11-02", "2026-11-09", false],
      ["2026-10-26", "2026-10-26", "2026-11-02", false],
    ],
  );
  assert.deepEqual(f.ocultos, []);
  assert.equal(f.botao, null);
  assert.equal(montarPedidoDeTicket(f, f.pontos[1].valor, f.semanas[0].valor), "id_ponto=502&semana=2026-11-09");
});

test("nomes de campo, método, código escondido e botão com nome são os da própria tela", () => {
  const f = formulario(
    telaTicket(conta({ metodo: "GET", acao: "tickets.php", campoPonto: "ponto", campoSemana: "periodo", botaoComNome: true, marcada: 1 }), "tq7x"),
  );
  assert.equal(f.method, "get");
  assert.equal(f.action, "tickets.php");
  assert.deepEqual(f.ocultos, [{ nome: "_token", valor: "tq7x" }]);
  assert.deepEqual(f.botao, { nome: "gerar", valor: "1" });
  assert.deepEqual(
    f.semanas.map((s) => s.selecionada),
    [false, true, false],
  );
  assert.equal(montarPedidoDeTicket(f, "503", "2026-11-02"), "_token=tq7x&ponto=503&periodo=2026-11-02&gerar=1");
});

test("a lista de pontos pode repetir o código, e cada opção guarda o próprio valor", () => {
  const f = formulario(telaTicket(conta({ pontos: ["A701", "A777", "A777", "B702", "M703"] })));
  assert.deepEqual(
    f.pontos.filter((p) => p.codigo === "A777").map((p) => p.valor),
    ["502", "503"],
  );
  assert.equal(f.pontos.length, 5);
});

test("opção “Selecione…” (vazia ou com zero) e texto além do código não atrapalham", () => {
  const html = trocar(
    telaTicket(conta()),
    '<option value="501" selected>A701</option>',
    '<option value="">Selecione o ponto</option><option value="501">A701 - CARRETA</option>',
  );
  const f = formulario(html);
  assert.deepEqual(
    f.pontos.map((p) => p.codigo),
    ["A701", "A777", "B702"],
  );
  const comZero = trocar(telaTicket(conta()), '<option value="501" selected>A701</option>', '<option value="0">Escolha...</option><option value="501">A701</option>');
  assert.equal(formulario(comZero).pontos.length, 3);
});

test("sem nenhuma semana marcada, vale a primeira (como no navegador)", () => {
  const html = telaTicket(conta()).replace(/ selected/g, "");
  assert.deepEqual(
    formulario(html).semanas.map((s) => s.selecionada),
    [true, false, false],
  );
});

test("formulário que não é só a consulta é recusado, com a estrutura (sem valores) no diagnóstico", () => {
  // Campo para digitar.
  const comTexto = recusaDoFormulario(telaTicket(conta({ comCampoDeTexto: true })));
  assert.match(comTexto.motivo, /campos além das duas listas/);
  assert.ok(comTexto.estrutura.some((l) => /POST ticket_lista\.php/.test(l) && /id_ponto \[pontos, 3\]/.test(l) && /semana \[semanas, 3\]/.test(l)), comTexto.estrutura.join(" | "));
  // Nada do que a estrutura mostra é um valor da conta.
  assert.ok(!comTexto.estrutura.join(" ").includes("A777"));
  assert.ok(!comTexto.estrutura.join(" ").includes("09/11"));

  // As listas fora de um formulário (a tela enviaria por JavaScript).
  const solto = recusaDoFormulario(telaTicket(conta({ semFormulario: true })));
  assert.match(solto.motivo, /fora de um formulário/);

  // Endereço com cara de ação, ou de PDF.
  assert.match(recusaDoFormulario(telaTicket(conta({ acao: "ticket_pdf.php" }))).motivo, /cara de ação/);
  assert.match(recusaDoFormulario(telaTicket(conta({ acao: "excluir_ticket.php" }))).motivo, /cara de ação/);

  // Formulário que abre em outra aba: é o do PDF.
  const outraAba = trocar(telaTicket(conta()), '<form class="card"', '<form target="_blank" class="card"');
  assert.match(recusaDoFormulario(outraAba).motivo, /outra aba/);

  // Só com o botão do PDF.
  const soPdf = trocar(telaTicket(conta()), '<button type="submit">Gerar</button>', '<button type="submit">Gerar PDF</button>');
  assert.match(recusaDoFormulario(soPdf).motivo, /botão do PDF/);

  // Fala de dispensa.
  const dispensa = trocar(telaTicket(conta()), "<h2>Selecione o período</h2>", "<h2>Motivo da dispensa</h2>");
  assert.match(recusaDoFormulario(dispensa).motivo, /ação/);

  // Campo escondido que nomeia uma ação.
  const oculto = trocar(telaTicket(conta()), "<h2>Selecione o período</h2>", '<input type="hidden" name="acao" value="excluir">');
  assert.match(recusaDoFormulario(oculto).motivo, /campo escondido/);

  // Uma lista a mais.
  const tres = trocar(telaTicket(conta()), '<label for="s">', '<select name="tipo"><option value="1">Todos</option></select><label for="s">');
  assert.match(recusaDoFormulario(tres).motivo, /não tem só a lista de pontos e a de semanas/);

  // Tela sem nada disso.
  const nada = recusaDoFormulario("<html><body><h1>Portal</h1><p>Em manutenção.</p></body></html>");
  assert.match(nada.motivo, /não achei na tela do Ticket o formulário/);
  assert.deepEqual(nada.estrutura, ["nenhum formulário na tela"]);
});

test("com os dois botões no formulário, o nome que vai no pedido é o do Gerar — nunca o do PDF", () => {
  const html = trocar(
    telaTicket(conta()),
    '<button type="submit">Gerar</button>',
    '<button type="submit" name="pdf" value="1">Gerar PDF</button><button type="submit" name="tela" value="1">Gerar</button>',
  );
  const f = formulario(html);
  assert.deepEqual(f.botao, { nome: "tela", valor: "1" });
  assert.ok(!montarPedidoDeTicket(f, "502", "2026-11-09").includes("pdf"));
  // Botão que manda o formulário para outro endereço também é deixado de fora.
  const desviado = trocar(
    telaTicket(conta()),
    '<button type="submit">Gerar</button>',
    '<button type="submit" name="b" value="x" formaction="outro.php">Exportar</button><input type="submit" value="Gerar">',
  );
  assert.equal(formulario(desviado).botao, null);
});

test("semana que não é uma semana (data impossível, de trás para a frente, longa demais) não entra", () => {
  const f = formulario(
    telaTicket(conta({ semanas: ["09/11/2026 - 16/11/2026", "31/02/2026 - 07/03/2026", "16/11/2026 - 09/11/2026", "01/01/2026 - 31/12/2026"] })),
  );
  assert.deepEqual(
    f.semanas.map((s) => s.inicio),
    ["2026-11-09"],
  );
  assert.equal(dataDoPortal("29", "02", "2028"), "2028-02-29");
  assert.equal(dataDoPortal("29", "02", "2026"), null);
  assert.equal(dataDoPortal("00", "11", "2026"), null);
  assert.equal(dataDoPortal("09", "11", "1999"), null);
});

test("a semana de hoje: a que contém o dia; na segunda-feira que fecha uma e abre outra, a marcada pelo portal", () => {
  const f = formulario(telaTicket(conta()));
  assert.equal(semanaDeHoje(f.semanas, "2026-11-11")?.inicio, "2026-11-09");
  assert.equal(semanaDeHoje(f.semanas, "2026-11-05")?.inicio, "2026-11-02");
  // 09/11 está nas duas: vale a marcada (a primeira, nesta tela).
  assert.equal(semanaDeHoje(f.semanas, "2026-11-09")?.inicio, "2026-11-09");
  // …e, se o portal ainda marca a antiga, é a antiga.
  const antiga = formulario(telaTicket(conta({ marcada: 1 })));
  assert.equal(semanaDeHoje(antiga.semanas, "2026-11-09")?.inicio, "2026-11-02");
  // A marca não decide fora do dia: a semana marcada que não contém hoje não é usada.
  assert.equal(semanaDeHoje(antiga.semanas, "2026-11-11")?.inicio, "2026-11-09");
  // Sem marca entre as duas, a que começa mais tarde.
  const semMarca = f.semanas.map((s) => ({ ...s, selecionada: false }));
  assert.equal(semanaDeHoje(semMarca, "2026-11-09")?.inicio, "2026-11-09");
  // Dia fora de todas as semanas da lista: nenhuma (nunca a mais próxima).
  assert.equal(semanaDeHoje(f.semanas, "2026-11-17"), null);
  assert.equal(semanaDeHoje([], "2026-11-11"), null);
});

test("o dia de hoje é o de Brasília, não o do servidor", () => {
  assert.equal(hojeEmBrasilia(new Date("2026-11-10T02:30:00Z")), "2026-11-09");
  assert.equal(hojeEmBrasilia(new Date("2026-11-10T03:00:00Z")), "2026-11-10");
  assert.equal(hojeEmBrasilia(new Date("2026-01-01T02:59:59Z")), "2025-12-31");
});

/* ------------------------------------------------------------ lançamentos */

test("a tela com viagens é lida inteira, nas três formas de quadro", () => {
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    const r = boa(ler(telaTickets(conta({ forma }), 1, 0)));
    assert.deepEqual(r.periodo, SEMANA, forma);
    assert.deepEqual(
      r.lancamentos,
      [
        { ponto: "A777", quant: 29.92, valor: 17.29, servico: "FRETE ATE 5 KM", data: "2026-11-09", hora: "21:00" },
        { ponto: "A777", quant: 32.14, valor: 17.29, servico: "FRETE ATE 5 KM", data: "2026-11-10", hora: "03:40" },
        { ponto: "A777", quant: 30, valor: 21.12, servico: "FRETE DE 5 A 10 KM", data: "2026-11-10", hora: "14:05" },
      ] satisfies LancamentoDoTicket[],
      forma,
    );
  }
});

test("a tela da foto — “Nenhum lançamento encontrado para este período.” — é zero viagem, nas três formas", () => {
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    const r = boa(ler(telaTickets(conta({ forma }), 0, 0), "A701"));
    assert.deepEqual(r.lancamentos, [], forma);
    assert.deepEqual(r.periodo, SEMANA, forma);
  }
});

test("as viagens saem da mais antiga para a mais nova, seja qual for a ordem da tela", () => {
  const aoContrario = conta({ lancamentos: { "1|0": [...VIAGENS].reverse() } });
  assert.deepEqual(
    boa(ler(telaTickets(aoContrario, 1, 0))).lancamentos.map((l) => `${l.data} ${l.hora}`),
    ["2026-11-09 21:00", "2026-11-10 03:40", "2026-11-10 14:05"],
  );
});

test("duas viagens iguais na mesma tela são duas viagens", () => {
  const dobro = conta({ lancamentos: { "1|0": [VIAGENS[0], VIAGENS[0]] } });
  assert.equal(boa(ler(telaTickets(dobro, 1, 0))).lancamentos.length, 2);
});

test("tabela vazia SEM o aviso nunca vira “nenhuma viagem”", () => {
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    const html = trocar(telaTickets(conta({ forma }), 0, 0), "Nenhum lançamento encontrado para este período.", "");
    assert.match(motivo(ler(html, "A701")), /nenhum lançamento nem o aviso/, forma);
  }
});

test("página que chegou pela metade é recusada (com e sem viagens)", () => {
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    assert.match(motivo(ler(telaTickets(conta({ forma, cortada: true }), 1, 0))), /cortada/, forma);
    assert.match(motivo(ler(telaTickets(conta({ forma, cortada: true }), 0, 0), "A701")), /cortada/, forma);
  }
  // Mesmo com o fim da página, uma linha pela metade não some: recusa.
  const html = trocar(telaTickets(conta({ forma: "linhas" }), 1, 0), "FRETE DE 5 A 10 KM 10/11/2026 14:05", "FRETE DE 5 A 10 KM");
  assert.match(motivo(ler(html)), /terminou no meio de um lançamento|não entendeu/);
});

test("linha de outro ponto recusa a tela inteira", () => {
  assert.match(motivo(ler(telaTickets(conta({ mostraPonto: "A701" }), 1, 0))), /é de outro ponto \(A701\), e o pedido era o A777/);
});

test("período diferente do pedido recusa — com viagens ou vazio", () => {
  // O portal ignorou a semana pedida e mostrou a anterior.
  const outra = conta({ mostraSemana: 1 });
  assert.match(motivo(ler(telaTickets(outra, 1, 0))), /período 02\/11 a 09\/11, e o pedido era 09\/11 a 16\/11/);
  assert.match(motivo(ler(telaTickets(outra, 0, 0), "A701")), /período 02\/11 a 09\/11/);
});

test("sem o período escrito, quem confere a semana é a data de cada linha", () => {
  const semPeriodo = conta({ semPeriodo: true });
  const r = boa(ler(telaTickets(semPeriodo, 1, 0)));
  assert.equal(r.periodo, null);
  assert.equal(r.lancamentos.length, 3);
  // As mesmas linhas, pedidas como se fossem de outra semana: recusa.
  assert.match(motivo(ler(telaTickets(semPeriodo, 1, 0), "A777", { inicio: "2026-11-16", fim: "2026-11-23" })), /fora da semana pedida \(16\/11 a 23\/11\)/);
});

test("data fora da semana recusa mesmo com o período certo escrito; os dois dias da ponta valem", () => {
  const fora = conta({ lancamentos: { "1|0": [{ ...VIAGENS[0], data: "08/11/2026" }] } });
  assert.match(motivo(ler(telaTickets(fora, 1, 0))), /linha 1: a data \(08\/11\) está fora da semana pedida/);
  // …e o dia seguinte ao fim da semana também (a viagem é da semana que vem).
  const depois = conta({ lancamentos: { "1|0": [{ ...VIAGENS[0], data: "17/11/2026" }] } });
  assert.match(motivo(ler(telaTickets(depois, 1, 0))), /linha 1: a data \(17\/11\) está fora da semana pedida \(09\/11 a 16\/11\)/);
  const pontas = conta({
    lancamentos: { "1|0": [{ ...VIAGENS[0], data: "09/11/2026", hora: "00:00" }, { ...VIAGENS[1], data: "16/11/2026", hora: "23:59" }] },
  });
  assert.equal(boa(ler(telaTickets(pontas, 1, 0))).lancamentos.length, 2);
});

test("QUANT e VALOR: só os formatos conhecidos, e dentro do que um ticket traz", () => {
  // Toneladas com três casas (como no ticket), com vírgula, com duas casas, inteiras.
  assert.equal(lerQuantDoTicket("29.920"), 29.92);
  assert.equal(lerQuantDoTicket("29,920"), 29.92);
  assert.equal(lerQuantDoTicket("29.92"), 29.92);
  assert.equal(lerQuantDoTicket("29,9"), 29.9);
  assert.equal(lerQuantDoTicket("30"), 30);
  assert.equal(lerQuantDoTicket("29.920", "t"), 29.92);
  // Quilos, só quando a tela escreve “kg”.
  assert.equal(lerQuantDoTicket("29920", "kg"), 29.92);
  assert.equal(lerQuantDoTicket("29.920", "kg"), 29.92);
  assert.equal(lerQuantDoTicket("29920"), null);
  // “kg” com número pequeno são quilos mesmo: 950 kg é quase uma tonelada; 29,92 kg não é uma carga.
  assert.equal(lerQuantDoTicket("950", "kg"), 0.95);
  assert.equal(lerQuantDoTicket("29,92", "kg"), null);
  // Nunca adivinha: formato desconhecido, zero, ou fora do que uma carga pesa.
  for (const ruim of ["", "0", "0.000", "0.400", "80.001", "571.760", "29.920,00", "1.234.567", "29.9200", "-3", "abc"]) {
    assert.equal(lerQuantDoTicket(ruim), null, `quant “${ruim}”`);
  }
  assert.equal(lerQuantDoTicket("0.500"), 0.5);
  assert.equal(lerQuantDoTicket("80.000"), 80);

  assert.equal(lerValorDoTicket("17.29"), 17.29);
  assert.equal(lerValorDoTicket("17,29"), 17.29);
  assert.equal(lerValorDoTicket("17"), 17);
  assert.equal(lerValorDoTicket("17.2900"), 17.29);
  assert.equal(lerValorDoTicket("150"), 150);
  for (const ruim of ["", "0", "0.99", "150.01", "517.32", "1.729,00", "17.29.1", "R$", "-1"]) {
    assert.equal(lerValorDoTicket(ruim), null, `valor “${ruim}”`);
  }
});

test("linha com número fora do formato ou do limite recusa a tela — e o motivo não mostra o número", () => {
  const com = (viagem: Partial<LancamentoFalso>) => telaTickets(conta({ lancamentos: { "1|0": [VIAGENS[0], { ...VIAGENS[1], ...viagem }] } }), 1, 0);
  const casos: [Partial<LancamentoFalso>, RegExp, string][] = [
    [{ valor: "517.32" }, /linha 2: VALOR “999\.99” fora do esperado.*maior que 150 R\$\/t/, "517"],
    [{ valor: "0.00" }, /linha 2: VALOR “9\.99” fora do esperado.*zero/, "0.00"],
    [{ quant: "29920" }, /linha 2: QUANT “99999” fora do esperado.*maior que 80 t/, "29920"],
    [{ quant: "31.450,00" }, /linha 2: QUANT “99\.999,99” fora do esperado.*formato que a leitura não conhece/, "31.450"],
    [{ quant: "0.000" }, /linha 2: QUANT “9\.999” fora do esperado.*zero/, "0.000"],
    [{ quant: "571.760" }, /linha 2: QUANT “999\.999” fora do esperado.*maior que 80 t/, "571"],
    [{ quant: "0.300" }, /linha 2: QUANT “9\.999” fora do esperado.*menor que 0,5 t/, "0.300"],
  ];
  for (const [viagem, esperado, numero] of casos) {
    const r = ler(com(viagem));
    assert.match(motivo(r), esperado);
    assert.ok(!motivo(r).includes(numero), `o motivo mostra o número: ${motivo(r)}`);
    assert.ok(!amostra(r).join(" ").match(/[0-8]/), `a amostra mostra números: ${amostra(r).join(" | ")}`);
  }
  // Data e hora impossíveis.
  assert.match(motivo(ler(com({ data: "31/11/2026" }))), /linha 2: data que não existe/);
  assert.match(motivo(ler(com({ hora: "24:10" }))), /linha 2: hora que não existe/);
});

test("unidade e “R$” escritos na célula são entendidos", () => {
  const r = boa(
    ler(
      telaTickets(
        conta({
          lancamentos: {
            "1|0": [
              { ...VIAGENS[0], quant: "29,920 t", valor: "R$ 17,29" },
              { ...VIAGENS[1], quant: "32140 kg", valor: "R$17.29" },
            ],
          },
        }),
        1,
        0,
      ),
    ),
  );
  assert.deepEqual(
    r.lancamentos.map((l) => [l.quant, l.valor]),
    [
      [29.92, 17.29],
      [32.14, 17.29],
    ],
  );
});

test("serviço em branco, com número ou com acento não quebra a linha", () => {
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    const r = boa(
      ler(
        telaTickets(
          conta({
            forma,
            lancamentos: {
              "1|0": [
                { ...VIAGENS[0], servico: "" },
                { ...VIAGENS[1], servico: "5 KM" },
                { ...VIAGENS[2], servico: "FRETE ATÉ 10 KM &amp; PÁTIO 2" },
              ],
            },
          }),
          1,
          0,
        ),
      ),
    );
    assert.deepEqual(
      r.lancamentos.map((l) => l.servico),
      ["", "5 KM", "FRETE ATÉ 10 KM & PÁTIO 2"],
      forma,
    );
  }
});

test("linha com cara de lançamento que a leitura não entendeu nunca é pulada", () => {
  const base = telaTickets(conta({ forma: "linhas" }), 1, 0);
  // Um número de ordem na frente do ponto.
  assert.match(motivo(ler(trocar(base, "A777 32.140", "2 A777 32.140"))), /linha com um ponto que a leitura não entendeu/);
  // Sem o código do ponto na frente.
  assert.match(motivo(ler(trocar(base, "A777 32.140", "32.140"))), /cara de lançamento, mas sem o ponto na frente/);
  // Na forma de células: a célula do ponto veio vazia.
  const celulas = telaTickets(conta({ forma: "celulas" }), 1, 0);
  assert.match(motivo(ler(trocar(celulas, "<div>A777</div><div>32.140</div>", "<div></div><div>32.140</div>"))), /cara de lançamento, mas sem o ponto na frente/);
  // Coluna a mais no meio da linha (um valor depois da hora).
  assert.match(motivo(ler(trocar(base, "10/11/2026 03:40", "10/11/2026 03:40 555.70"))), /não entendeu/);
});

test("linha de TABELA: seis células, cada uma no seu lugar — coluna a mais, a menos ou trocada recusa", () => {
  const base = telaTickets(conta({ forma: "tabela" }), 1, 0);
  const linha = "<td>A777</td><td>32.140</td><td>17.29</td><td>FRETE ATE 5 KM</td><td>10/11/2026</td><td>03:40</td>";
  // Uma célula a mais no fim (um botão por linha, por exemplo).
  assert.match(motivo(ler(trocar(base, linha, `${linha}<td>Ver</td>`))), /linha com 7 colunas \(o quadro tem 6\)/);
  // Uma célula a mais no meio: o número a mais nunca vira o VALOR.
  assert.match(
    motivo(ler(trocar(base, linha, "<td>A777</td><td>32.140</td><td>1</td><td>17.29</td><td>FRETE ATE 5 KM</td><td>10/11/2026</td><td>03:40</td>"))),
    /linha com 7 colunas/,
  );
  // Uma a menos (data e hora na mesma célula).
  assert.match(
    motivo(ler(trocar(base, linha, "<td>A777</td><td>32.140</td><td>17.29</td><td>FRETE ATE 5 KM</td><td>10/11/2026 03:40</td>"))),
    /linha com 5 colunas/,
  );
  // Seis células, mas QUANT e SERVIÇO trocados de lugar.
  const trocada = ler(trocar(base, linha, "<td>A777</td><td>FRETE ATE 5 KM</td><td>17.29</td><td>32.140</td><td>10/11/2026</td><td>03:40</td>"));
  assert.match(motivo(trocada), /coluna QUANT que a leitura não entendeu/);
  assert.ok(!motivo(trocada).match(/[0-8]/), motivo(trocada));
  // Célula vazia no fim da linha (coluna sem título) não conta.
  assert.equal(boa(ler(trocar(base, linha, `${linha}<td></td>`))).lancamentos.length, 3);
  // Serviço com um número solto continua sendo só o serviço.
  const comNumero = boa(ler(trocar(base, linha, linha.replace("FRETE ATE 5 KM", "555.70 FRETE"))));
  assert.deepEqual(
    comNumero.lancamentos.map((l) => [l.quant, l.valor, l.servico])[1],
    [32.14, 17.29, "555.70 FRETE"],
  );
});

test("duas linhas coladas numa só nunca viram um lançamento (o serviço não engole uma data)", () => {
  const base = telaTickets(conta({ forma: "linhas" }), 1, 0);
  const colada = trocar(
    base,
    '10/11/2026 03:40</div>\n<div class="linha">A777 30.000',
    "10/11/2026 03:40 A777 30.000",
  );
  assert.match(motivo(ler(colada)), /não entendeu|terminou no meio de um lançamento/);
  // Na forma de células, um ponto novo antes de a linha anterior fechar também recusa.
  const celulas = telaTickets(conta({ forma: "celulas" }), 1, 0);
  const semHora = trocar(celulas, "<div>10/11/2026</div><div>03:40</div>", "<div>10/11/2026</div>");
  assert.match(motivo(ler(semHora)), /linha de lançamento que a leitura não entendeu/);
});

test("aviso de vazio junto com viagens é recusado", () => {
  const html = trocar(telaTickets(conta({ forma: "linhas" }), 1, 0), '<div class="linha">A777 30.000', '<p>Nenhum lançamento encontrado para este período.</p><div class="linha">A777 30.000');
  assert.match(motivo(ler(html)), /lançamentos e também o aviso/);
});

test("o total da tela, quando existe, tem de bater com as linhas", () => {
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    assert.equal(boa(ler(telaTickets(conta({ forma, comTotal: true }), 1, 0))).lancamentos.length, 3, forma);
    assert.match(motivo(ler(telaTickets(conta({ forma, comTotal: true, totalErrado: true }), 1, 0))), /diz 4 viagem\(ns\) no total, mas trouxe 3 linha\(s\)/, forma);
  }
  // Toneladas do total diferentes da soma.
  const html = trocar(telaTickets(conta({ comTotal: true }), 1, 0), "92.060 TONS", "95.060 TONS");
  assert.match(motivo(ler(html)), /toneladas do total/);
  // “Total: 3” (só a contagem) também é conferido; um total em dinheiro não é contagem.
  const base = telaTickets(conta(), 1, 0);
  assert.equal(boa(ler(trocar(base, "</table>", "</table><p>Total: 3</p>"))).lancamentos.length, 3);
  assert.match(motivo(ler(trocar(base, "</table>", "</table><p>Total de lançamentos: 5</p>"))), /diz 5 viagem/);
  assert.equal(boa(ler(trocar(base, "</table>", "</table><p>Total: R$ 1.708,21</p>"))).lancamentos.length, 3);
  // Zero viagens com total zero.
  assert.deepEqual(boa(ler(telaTickets(conta({ comTotal: true }), 0, 0), "A701")).lancamentos, []);
});

test("tela com mais de uma página é recusada (a leitura só veria a primeira)", () => {
  const base = telaTickets(conta(), 1, 0);
  assert.match(motivo(ler(trocar(base, "</table>", "</table><p>Página 1 de 3</p>"))), /mais de uma página/);
  assert.match(motivo(ler(trocar(base, "</table>", '</table><a href="?p=2">Próxima</a>'))), /mais de uma página/);
  assert.equal(boa(ler(trocar(base, "</table>", "</table><p>Página 1 de 1</p>"))).lancamentos.length, 3);
});

test("tela que não é a de lançamentos é recusada, e a amostra mostra a forma do que veio (sem números)", () => {
  // O portal devolveu o formulário de novo.
  const r = ler(telaTicket(conta()));
  assert.match(motivo(r), /não achei na tela o quadro de lançamentos/);
  assert.ok(amostra(r).length > 0);
  // Cabeçalho com outra ordem de colunas: não é adivinhado.
  const html = trocar(telaTickets(conta(), 1, 0), "<th>QUANT</th><th>VALOR</th>", "<th>VALOR</th><th>QUANT</th>");
  const trocado = ler(html);
  assert.match(motivo(trocado), /não achei na tela o quadro de lançamentos/);
  assert.match(amostra(trocado)[0], /PONTO · VALOR · QUANT/);
  assert.ok(!amostra(trocado).join(" ").match(/[0-8]/), amostra(trocado).join(" | "));
  // Coluna a mais.
  assert.match(motivo(ler(trocar(telaTickets(conta(), 1, 0), "<th>HORA</th>", "<th>HORA</th><th>PLACA</th>"))), /não achei na tela o quadro/);
  // Página de erro.
  assert.match(motivo(ler("<html><body><h1>Erro</h1><p>Tente mais tarde.</p></body></html>")), /não achei na tela o quadro/);
});

test("mais de um período escrito antes do quadro: o que vem com a palavra “Período” é o que vale", () => {
  const base = telaTickets(conta(), 1, 0);
  // Outro intervalo solto no topo (um aviso qualquer) não confunde: o rotulado é o da consulta.
  const comAviso = trocar(base, "<h1>Tickets</h1>", "<h1>Tickets</h1><p>Fechamento 02/11/2026 - 09/11/2026 já disponível</p>");
  assert.deepEqual(boa(ler(comAviso)).periodo, SEMANA);
  // Dois períodos rotulados e diferentes: recusa.
  const dois = trocar(base, "<h1>Tickets</h1>", "<h1>Tickets</h1><p>Período 02/11/2026 - 09/11/2026</p>");
  assert.match(motivo(ler(dois)), /mais de um período/);
});

test("as semanas da lista (que não é texto da tela) nunca são lidas como o período", () => {
  // O resultado traz o formulário de novo no topo, com a lista de semanas.
  const formularioNoTopo = /<form[\s\S]*?<\/form>/.exec(telaTicket(conta({ marcada: 2 })))?.[0] ?? "";
  assert.ok(formularioNoTopo.includes("26/10/2026 - 02/11/2026"));
  const html = trocar(telaTickets(conta(), 1, 0), "<h1>Tickets</h1>", `<h1>Tickets</h1>${formularioNoTopo}`);
  assert.deepEqual(boa(ler(html)).periodo, SEMANA);
});

test("cabeçalho com “QTDE” / “Quantidade”, em minúsculas e com acento também é o quadro", () => {
  const base = telaTickets(conta(), 1, 0);
  assert.equal(boa(ler(trocar(base, "<th>QUANT</th>", "<th>Quantidade</th>"))).lancamentos.length, 3);
  assert.equal(boa(ler(trocar(base, "<th>QUANT</th>", "<th>Qtde.</th>"))).lancamentos.length, 3);
  assert.equal(boa(ler(trocar(base, "<th>SERVIÇO</th>", "<th>Servico</th>"))).lancamentos.length, 3);
});

test("mascarar: todo número vira 9 e o texto é cortado", () => {
  assert.equal(mascararNumeros("A777 29.920 17.29 FRETE ATE 5 KM 10/11/2026 03:40"), "A999 99.999 99.99 FRETE ATE 9 KM 99/99/9999 99:99");
  assert.equal(mascararNumeros("x".repeat(100)).length, 60);
});

/* ------------------------------------------------- o mesmo código duas vezes */

test("o mesmo ponto escrito duas vezes na lista: a viagem que aparece nas duas conta uma vez", () => {
  const v = (data: string, hora: string, quant = 29.92): LancamentoDoTicket => ({ ponto: "A777", quant, valor: 17.29, servico: "FRETE ATE 5 KM", data, hora });
  const a = [v("2026-11-09", "21:00"), v("2026-11-10", "03:40", 32.14)];
  // As duas opções trouxeram as mesmas linhas.
  assert.deepEqual(juntarLancamentos([a, a]), a);
  // Cada opção trouxe as suas.
  const b = [v("2026-11-11", "08:15", 31)];
  assert.deepEqual(
    juntarLancamentos([a, b]).map((l) => l.hora),
    ["21:00", "03:40", "08:15"],
  );
  // Uma parte em comum e uma parte só de uma.
  assert.equal(juntarLancamentos([a, [a[1], ...b]]).length, 3);
  // Repetida dentro da mesma opção continua repetida.
  assert.equal(juntarLancamentos([[a[0], a[0]], [a[0]]]).length, 2);
  assert.deepEqual(juntarLancamentos([]), []);
  assert.deepEqual(juntarLancamentos([[], []]), []);
});
