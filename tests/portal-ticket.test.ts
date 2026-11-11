import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_OPCOES_DO_MESMO_PONTO, MOTIVO_SEM_TEMPO, MOTIVO_SEM_TEMPO_PARA_COMECAR, lerPortalDoMotorista, lerTicketsComSessao, sessaoVazia } from "../src/lib/portal-copadubo";
import {
  BASE_FALSA,
  CPF_FALSO,
  SENHA_FALSA,
  criarPortalFalso,
  telaStatus,
  type LancamentoFalso,
  type OpcoesPortalFalso,
  type TicketFalso,
} from "./portal-fixture";

/**
 * A ABA “TICKET” DO PORTAL — a leitura (a parte de rede).
 *
 * Com a sessão que a olhada do Status deixou guardada, o leitor abre a “2ª Via
 * de Ticket”, escolhe o ponto e a semana de hoje e envia o “Gerar”. Aqui se
 * confere o que ele PEDE ao portal: só a tela do formulário e a consulta — sem
 * login, sem abrir o “Gerar PDF” e sem seguir link nenhum da tela de resultado.
 *
 * Sem banco: o portal é de mentira e todos os dados são inventados.
 */

process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
const CRED = { cpf: CPF_FALSO, senha: SENHA_FALSA };
const CARTAO = { codigo: "A777", situacao: "ATIVO", linhas: ["Ativado hoje, 19:50"], botao: "Entrar na dispensa" };
/** Quarta-feira, 11/11/2026, 10:00 em Brasília. */
const QUARTA = new Date("2026-11-11T13:00:00Z");
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
const portalCom = (tickets: TicketFalso | undefined, extra: Partial<OpcoesPortalFalso> = {}) =>
  criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, tickets, ...extra });

/** Entra uma vez (login + Status): a sessão fica com os cookies e o endereço da aba “Ticket”. */
async function sessaoAberta(portal: ReturnType<typeof criarPortalFalso>) {
  const sessao = sessaoVazia();
  const leitura = await lerPortalDoMotorista(CRED, null, { buscar: portal.buscar, codigo: "A777", codigos: ["A777"], sessao });
  assert.equal(leitura.ok, true, leitura.diagnostico.join(" | "));
  return sessao;
}
const pedidosDesde = (portal: ReturnType<typeof criarPortalFalso>, antes: number) => portal.pedidos.slice(antes).map((p) => `${p.metodo} ${p.caminho}`);
/** Nenhum peso e nenhum valor da tela pode aparecer no diagnóstico. */
const semValores = (diagnostico: string[]) => {
  const texto = diagnostico.join(" ");
  for (const numero of ["29.920", "32.140", "30.000", "17.29", "21.12", "29,92", "17,29"]) assert.ok(!texto.includes(numero), `o diagnóstico mostra ${numero}: ${texto}`);
};

test("a leitura do Status guarda o endereço da aba “Ticket” que o menu informa — e não a abre", async () => {
  const portal = portalCom(conta());
  const sessao = await sessaoAberta(portal);
  assert.equal(sessao.ticketUrl, `${BASE_FALSA}/moto/ticket`);
  assert.ok(!portal.caminhos().some((c) => /ticket/.test(c)), portal.caminhos().join(", "));
  assert.deepEqual(portal.consultasDeTicket, []);
});

test("com a sessão guardada: a tela do formulário e UM “Gerar” — sem login, sem PDF, sem ação", async () => {
  const portal = portalCom(conta());
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const logins = portal.logins;

  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.equal(lida.abriu, true);
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket", "POST moto/ticket_lista.php"]);
  assert.equal(portal.pedidos[portal.pedidos.length - 1].corpo, "id_ponto=502&semana=2026-11-09");
  assert.equal(lida.pedidos, 2);
  assert.equal(portal.logins, logins, "a leitura dos tickets nunca faz login");
  assert.deepEqual(portal.acoes, [], "nem o PDF nem ação nenhuma");
  assert.deepEqual(portal.foraDoSite, []);
  assert.deepEqual(portal.consultasDeTicket, ["A777 2026-11-09"]);
  assert.equal(portal.ticketsRecusados, 0);

  assert.deepEqual(lida.semana, SEMANA);
  assert.deepEqual(lida.falhas, {});
  assert.deepEqual(
    lida.pontos.A777?.map((l) => [l.ponto, l.quant, l.valor, l.servico, l.data, l.hora]),
    [
      ["A777", 29.92, 17.29, "FRETE ATE 5 KM", "2026-11-09", "21:00"],
      ["A777", 32.14, 17.29, "FRETE ATE 5 KM", "2026-11-10", "03:40"],
      ["A777", 30, 21.12, "FRETE DE 5 A 10 KM", "2026-11-10", "14:05"],
    ],
  );
  assert.deepEqual(lida.diagnostico, ["Ticket do A777 (semana 09/11 a 16/11): tela de lançamentos lida inteira."]);
  semValores(lida.diagnostico);
});

test("a tela da foto: ponto sem viagem na semana é lido como zero viagem (não como falha)", async () => {
  const portal = portalCom(conta());
  const sessao = await sessaoAberta(portal);
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A701"], agora: QUARTA });
  assert.deepEqual(lida.pontos, { A701: [] });
  assert.deepEqual(lida.falhas, {});
});

test("vários pontos: um “Gerar” para cada, na mesma visita; o que a conta não tem fica com o motivo", async () => {
  const portal = portalCom(conta({ lancamentos: { "1|0": VIAGENS, "2|0": [VIAGENS[0]] } }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777", "A999", "B702"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket", "POST moto/ticket_lista.php", "POST moto/ticket_lista.php"]);
  assert.deepEqual(portal.consultasDeTicket, ["A777 2026-11-09", "B702 2026-11-09"]);
  assert.equal(lida.pontos.A777?.length, 3);
  assert.equal(lida.pontos.B702?.length, 1);
  assert.equal(lida.pontos.B702?.[0].ponto, "B702");
  assert.deepEqual(Object.keys(lida.falhas), ["A999"]);
  assert.match(lida.falhas.A999, /a lista de pontos desta conta no portal não tem o A999/);
  assert.match(lida.diagnostico.join(" "), /Ticket do A999: .* \(tem: A701, A777, B702\)/);
});

test("formulário GET, com outros nomes de campo e botão com nome: o pedido usa o que a tela informa", async () => {
  const portal = portalCom(conta({ metodo: "GET", acao: "tickets.php", campoPonto: "ponto", campoSemana: "periodo", botaoComNome: true }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket", "GET moto/tickets.php?ponto=502&periodo=2026-11-09&gerar=1"]);
  assert.equal(lida.pontos.A777?.length, 3);
  assert.equal(portal.ticketsRecusados, 0);
  assert.deepEqual(portal.acoes, []);
});

test("código escondido de uso único: o formulário é aberto de novo antes de cada “Gerar”", async () => {
  const portal = portalCom(conta({ comCodigoOculto: true, lancamentos: { "1|0": VIAGENS, "2|0": [VIAGENS[0]] } }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777", "B702"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket", "POST moto/ticket_lista.php", "GET moto/ticket", "POST moto/ticket_lista.php"]);
  assert.equal(portal.ticketsRecusados, 0, "nenhum “Gerar” foi enviado com o código velho");
  assert.equal(lida.pontos.A777?.length, 3);
  assert.equal(lida.pontos.B702?.length, 1);
});

test("o mesmo código duas vezes na lista: as duas opções são lidas e a viagem repetida conta uma vez", async () => {
  // As duas opções do A777 mostram as mesmas três viagens; a segunda tem uma a mais.
  const extra: LancamentoFalso = { quant: "31.000", valor: "17.29", servico: "FRETE ATE 5 KM", data: "11/11/2026", hora: "08:15" };
  const portal = portalCom(conta({ pontos: ["A701", "A777", "A777", "B702"], lancamentos: { "1|0": VIAGENS, "2|0": [...VIAGENS, extra] } }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket", "POST moto/ticket_lista.php", "POST moto/ticket_lista.php"]);
  assert.deepEqual(
    portal.pedidos.slice(antes + 1).map((p) => p.corpo),
    ["id_ponto=502&semana=2026-11-09", "id_ponto=503&semana=2026-11-09"],
  );
  assert.deepEqual(
    lida.pontos.A777?.map((l) => `${l.data} ${l.hora}`),
    ["2026-11-09 21:00", "2026-11-10 03:40", "2026-11-10 14:05", "2026-11-11 08:15"],
  );
  assert.match(lida.diagnostico.join(" "), /o ponto aparece 2 vezes na lista do portal — as 2 foram lidas e a viagem repetida conta uma vez/);

  // Uma das duas não veio inteira: o ponto todo fica sem leitura (nunca a soma de uma só).
  const meia = portalCom(conta({ pontos: ["A777", "A777"], lancamentos: { "0|0": VIAGENS, "1|0": [{ ...VIAGENS[0], valor: "517.32" }] } }));
  const s2 = await sessaoAberta(meia);
  const r2 = await lerTicketsComSessao(s2, { buscar: meia.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(r2.pontos, {});
  assert.match(r2.falhas.A777, /linha 1: VALOR “999\.99” fora do esperado/);
});

test(`código que aparece mais de ${MAX_OPCOES_DO_MESMO_PONTO} vezes na lista não é lido pela metade`, async () => {
  const portal = portalCom(conta({ pontos: ["A777", "A777", "A777", "A777", "B702"], lancamentos: {} }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket"]);
  assert.deepEqual(lida.pontos, {});
  assert.match(lida.falhas.A777, /aparece 4 vezes na lista de pontos do portal/);
});

test("a semana consultada é a de hoje na lista do portal; na segunda-feira da virada, a que o portal marca", async () => {
  // Segunda-feira 09/11: o dia está nas duas semanas.
  const segunda = new Date("2026-11-09T12:00:00Z");
  const antiga: LancamentoFalso = { quant: "28.500", valor: "17.29", servico: "FRETE ATE 5 KM", data: "09/11/2026", hora: "02:10" };
  const tickets = conta({ lancamentos: { "1|0": [VIAGENS[0]], "1|1": [antiga] } });
  const portal = portalCom(tickets);
  const sessao = await sessaoAberta(portal);
  const nova = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: segunda });
  assert.deepEqual(nova.semana, SEMANA);
  assert.deepEqual(portal.consultasDeTicket, ["A777 2026-11-09"]);

  // O portal ainda marca a semana que está fechando: é ela.
  portal.tickets = { ...tickets, marcada: 1 };
  const velha = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: segunda });
  assert.deepEqual(velha.semana, { inicio: "2026-11-02", fim: "2026-11-09" });
  assert.equal(portal.consultasDeTicket[1], "A777 2026-11-02");
  assert.equal(velha.pontos.A777?.[0].hora, "02:10");

  // No meio da semana a marca não decide: mesmo com a antiga marcada, vale a que contém hoje.
  const quarta = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(quarta.semana, SEMANA);
});

test("lista sem a semana de hoje: nada é consultado (nunca a semana mais próxima)", async () => {
  const portal = portalCom(conta({ semanas: SEMANAS.slice(1) }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket"]);
  assert.equal(lida.abriu, true);
  assert.equal(lida.semana, null);
  assert.deepEqual(lida.pontos, {});
  assert.match(lida.falhas.A777, /não tem a semana de hoje \(11\/11\); tem 2 semana\(s\), de 26\/10 a 09\/11/);
});

test("sessão encerrada pelo portal: nada é lido e NENHUM login é enviado", async () => {
  const portal = portalCom(conta(), { trocaCookieDeSessaoEncerrada: true });
  const sessao = await sessaoAberta(portal);
  const cookies = { ...sessao.cookies };
  portal.sessoes.clear();
  const logins = portal.logins;

  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.equal(lida.abriu, false);
  assert.deepEqual(lida.pontos, {});
  assert.match(lida.falhas.A777, /pediu o login de novo/);
  assert.equal(portal.logins, logins, "quem entra de novo é a leitura do Status, com o freio de logins");
  assert.deepEqual(sessao.cookies, cookies, "a sessão guardada não é mexida por uma leitura que não abriu");
  assert.deepEqual(portal.consultasDeTicket, []);
});

test("a sessão cai no meio (depois do formulário): o “Gerar” volta com o login e o ponto fica sem leitura", async () => {
  const portal = portalCom(conta({ lancamentos: { "1|0": VIAGENS, "2|0": [VIAGENS[0]] } }));
  const sessao = await sessaoAberta(portal);
  const original = portal.buscar;
  let pedidos = 0;
  const buscar = (async (entrada: string | URL | Request, init?: RequestInit) => {
    pedidos += 1;
    // Depois do 2º pedido (formulário + 1º Gerar), o portal encerra a sessão.
    if (pedidos === 3) portal.sessoes.clear();
    return original(entrada as string, init);
  }) as unknown as typeof fetch;
  const lida = await lerTicketsComSessao(sessao, { buscar, codigos: ["A777", "B702"], agora: QUARTA });
  assert.equal(lida.pontos.A777?.length, 3, "o que veio inteiro antes da queda vale");
  assert.equal(lida.pontos.B702, undefined);
  assert.match(lida.falhas.B702, /pediu o login de novo/);
});

test("sem sessão e sem pontos: nada é pedido; sem o endereço guardado, o menu diz onde fica a aba", async () => {
  const portal = portalCom(conta());
  const vazia = await lerTicketsComSessao(sessaoVazia(), { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.equal(vazia.abriu, false);
  assert.equal(portal.pedidos.length, 0);
  assert.match(vazia.falhas.A777, /sem sessão aberta/);

  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const semPontos = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: [], agora: QUARTA });
  assert.equal(portal.pedidos.length, antes);
  assert.equal(semPontos.abriu, false);

  sessao.ticketUrl = null;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/status", "GET moto/ticket", "POST moto/ticket_lista.php"]);
  assert.equal(sessao.ticketUrl, `${BASE_FALSA}/moto/ticket`);
  assert.equal(lida.pontos.A777?.length, 3);
});

test("endereço guardado que não é navegação do portal nunca é aberto", async () => {
  const portal = portalCom(conta());
  const sessao = await sessaoAberta(portal);
  for (const ruim of [
    "https://outro.exemplo.test/moto/ticket",
    `${BASE_FALSA}/logout.php`,
    `${BASE_FALSA}/moto/ticket_pdf.php?p=502&s=2026-11-09`,
    `${BASE_FALSA}/moto/dispensa/alternar?ponto=A777`,
  ]) {
    sessao.ticketUrl = ruim;
    const antes = portal.pedidos.length;
    const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
    // O endereço ruim é ignorado: a aba é procurada de novo no menu.
    assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/status", "GET moto/ticket", "POST moto/ticket_lista.php"], ruim);
    assert.equal(lida.pontos.A777?.length, 3);
  }
  assert.deepEqual(portal.acoes, []);
  assert.deepEqual(portal.foraDoSite, []);
});

test("menu sem a aba “Ticket”, ou aba que não existe mais (404): sem leitura, com o motivo", async () => {
  // Conta sem a tela de ticket no portal de mentira: o endereço guardado dá 404 e é esquecido.
  const portal = portalCom(undefined);
  const sessao = await sessaoAberta(portal);
  assert.equal(sessao.ticketUrl, `${BASE_FALSA}/moto/ticket`);
  delete portal.telas["moto/ticket"];
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.equal(lida.abriu, false);
  assert.match(lida.falhas.A777, /não existe neste endereço \(404\)/);
  assert.equal(sessao.ticketUrl, null);

  // Menu que não tem a aba.
  const semAba = criarPortalFalso({
    telas: { "moto/status": telaStatus([CARTAO], { menu: '<nav><a href="/moto/">Ponto</a><a href="/moto/status">Status</a><a href="/moto/fila">Fila</a></nav>' }) },
  });
  const s2 = await sessaoAberta(semAba);
  s2.ticketUrl = null;
  const r2 = await lerTicketsComSessao(s2, { buscar: semAba.buscar, codigos: ["A777"], agora: QUARTA });
  assert.match(r2.falhas.A777, /não achei a aba “Ticket” no menu do portal \(em moto\/status: Ponto, Status, Fila\)/);
});

test("formulário que não é só a consulta: nada é enviado, e o diagnóstico mostra a estrutura (sem valores)", async () => {
  for (const [extra, esperado] of [
    [{ comCampoDeTexto: true }, /campos além das duas listas/],
    [{ semFormulario: true }, /fora de um formulário/],
    [{ acao: "ticket_pdf.php" }, /cara de ação/],
    [{ acao: "../logout.php" }, /cara de ação/],
  ] as [Partial<TicketFalso>, RegExp][]) {
    const portal = portalCom(conta(extra));
    const sessao = await sessaoAberta(portal);
    const antes = portal.pedidos.length;
    const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
    assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket"], JSON.stringify(extra));
    assert.equal(lida.abriu, false);
    assert.match(lida.falhas.A777, esperado);
    assert.deepEqual(portal.acoes, [], "nada com cara de ação ou de PDF foi pedido");
    assert.deepEqual(portal.consultasDeTicket, []);
    // A estrutura mostra nomes de campos e tamanhos das listas — nunca os pontos nem as semanas.
    const texto = lida.diagnostico.join(" ");
    assert.ok(!texto.includes("A701") && !texto.includes("09/11/2026"), texto);
  }
});

test("formulário que manda para outro site: a consulta não sai do portal", async () => {
  const portal = portalCom(conta({ acao: "https://outro.exemplo.test/ticket_lista.php" }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket"]);
  assert.match(lida.falhas.A777, /a consulta não foi enviada: o endereço do formulário/);
  assert.deepEqual(portal.foraDoSite, []);
});

test("formulário que manda para um endereço de planilha ou de exportação: a consulta não é enviada", async () => {
  // Estes endereços passam pela conferência do formulário (não são “ação”), mas a leitura só envia a consulta da TELA.
  for (const acao of ["ticket_excel.php", "exportar_ticket.php", "ticket_lista.csv", "ticket_xls.php"]) {
    const portal = portalCom(conta({ acao }));
    const sessao = await sessaoAberta(portal);
    const antes = portal.pedidos.length;
    const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
    assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket"], acao);
    assert.match(lida.falhas.A777, /a consulta não foi enviada: o endereço do formulário/, acao);
    assert.deepEqual(portal.consultasDeTicket, [], acao);
    assert.equal(lida.pontos.A777, undefined);
  }
});

test("tela de resultado que não fecha a conta: o ponto fica sem leitura e o diagnóstico não mostra nenhum valor", async () => {
  const casos: [Partial<TicketFalso>, RegExp][] = [
    [{ cortada: true }, /cortada/],
    [{ mostraPonto: "A701" }, /é de outro ponto \(A701\)/],
    [{ mostraSemana: 1 }, /período 02\/11 a 09\/11, e o pedido era 09\/11 a 16\/11/],
    [{ comTotal: true, totalErrado: true }, /diz 4 viagem\(ns\) no total, mas trouxe 3/],
    [{ lancamentos: { "1|0": [VIAGENS[0], { ...VIAGENS[1], valor: "517.32" }] } }, /linha 2: VALOR “999\.99” fora do esperado/],
    [{ lancamentos: { "1|0": [{ ...VIAGENS[0], data: "08/11/2026" }] } }, /fora da semana pedida/],
  ];
  for (const [extra, esperado] of casos) {
    const portal = portalCom(conta(extra));
    const sessao = await sessaoAberta(portal);
    const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
    assert.equal(lida.abriu, true);
    assert.deepEqual(lida.pontos, {}, JSON.stringify(extra));
    assert.match(lida.falhas.A777, esperado);
    assert.match(lida.diagnostico.join(" "), /Tela depois do “Gerar” \(POST moto\/ticket_lista\.php\), com os números trocados por 9/);
    semValores(lida.diagnostico);
    assert.deepEqual(portal.acoes, []);
  }
});

test("o portal devolve o formulário em vez do resultado (consulta recusada): sem leitura", async () => {
  // O portal de mentira exige o nome do botão; a tela diz que ele não tem nome → a consulta volta para o formulário.
  const tickets = conta({ botaoComNome: true });
  const portal = portalCom(tickets);
  const sessao = await sessaoAberta(portal);
  // A tela entregue ao leitor não tem o nome do botão (como se o portal o pusesse por JavaScript).
  const original = portal.buscar;
  const buscar = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const r = await original(entrada as string, init);
    if (!String(entrada).endsWith("/moto/ticket") || (init?.method ?? "GET") !== "GET") return r;
    const html = (await r.text()).replace(' name="gerar" value="1"', "");
    return new Response(html, { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  const lida = await lerTicketsComSessao(sessao, { buscar, codigos: ["A777"], agora: QUARTA });
  assert.equal(portal.ticketsRecusados, 1);
  assert.deepEqual(lida.pontos, {});
  assert.match(lida.falhas.A777, /não achei na tela o quadro de lançamentos/);
});

test("portal fora do ar ou sem resposta: sem leitura, e a sessão guardada continua como estava", async () => {
  const portal = portalCom(conta());
  const sessao = await sessaoAberta(portal);
  const cookies = { ...sessao.cookies };
  portal.foraDoAr = true;
  const fora = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777"], agora: QUARTA });
  assert.match(fora.falhas.A777, /o portal respondeu 503/);
  portal.foraDoAr = false;

  const semRede = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const caiu = await lerTicketsComSessao(sessao, { buscar: semRede, codigos: ["A777"], agora: QUARTA });
  assert.match(caiu.falhas.A777, /sem resposta do portal/);
  assert.deepEqual(sessao.cookies, cookies);
  assert.equal(sessao.ticketUrl, `${BASE_FALSA}/moto/ticket`);
});

test("todos os pontos do motorista na MESMA visita: um “Gerar” para cada um dos seis", async () => {
  const seis = ["A701", "A777", "B702", "M703", "A705", "A706"];
  const portal = portalCom(conta({ pontos: seis, lancamentos: { "1|0": VIAGENS, "2|0": [VIAGENS[0]], "5|0": [VIAGENS[1], VIAGENS[2]] } }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const lida = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: seis, agora: QUARTA });
  assert.deepEqual(pedidosDesde(portal, antes), ["GET moto/ticket", ...seis.map(() => "POST moto/ticket_lista.php")]);
  assert.deepEqual(portal.consultasDeTicket, seis.map((c) => `${c} 2026-11-09`));
  assert.deepEqual(lida.falhas, {});
  assert.deepEqual(Object.fromEntries(seis.map((c) => [c, lida.pontos[c]?.length])), { A701: 0, A777: 3, B702: 1, M703: 0, A705: 0, A706: 2 });
  // Cada viagem fica no ponto DELA (é com isso que cada ponto leva a própria porcentagem).
  for (const c of seis) assert.ok((lida.pontos[c] ?? []).every((l) => l.ponto === c), c);
});

test("a leitura tem hora para acabar: sem tempo, nada é pedido ao portal e cada ponto fica com o motivo", async () => {
  const portal = portalCom(conta({ lancamentos: { "1|0": VIAGENS, "2|0": [VIAGENS[0]] } }));
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  // Quem chamou (o cron, por exemplo) já está no fim do prazo dele.
  const semTempo = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777", "B702"], agora: QUARTA, terminarAte: Date.now() - 1 });
  assert.deepEqual(pedidosDesde(portal, antes), [], "sem tempo, nenhum pedido sai");
  assert.deepEqual(semTempo.pontos, {});
  assert.deepEqual(semTempo.falhas, { A777: MOTIVO_SEM_TEMPO_PARA_COMECAR, B702: MOTIVO_SEM_TEMPO_PARA_COMECAR });
  assert.match(MOTIVO_SEM_TEMPO_PARA_COMECAR, /não sobrou tempo nesta rodada/);
  assert.equal(semTempo.pedidos, 0);
  assert.equal(semTempo.semana, null);
  // Com tempo de sobra, a mesma leitura vem inteira.
  const comTempo = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A777", "B702"], agora: QUARTA, terminarAte: Date.now() + 60_000 });
  assert.deepEqual(comTempo.falhas, {});
  assert.deepEqual([comTempo.pontos.A777?.length, comTempo.pontos.B702?.length], [3, 1]);

  // O tempo acaba no MEIO: o ponto que não coube fica com o motivo, e o que já veio continua valendo.
  let pedidos = 0;
  const lento = (async (input: string | URL | Request, init?: RequestInit) => {
    pedidos += 1;
    // O segundo “Gerar” não responde: quem o encerra é o prazo do pedido (como no fetch de verdade).
    if (pedidos === 3) {
      await new Promise((_, recusar) => {
        const sinal = init?.signal;
        const espera = setTimeout(() => recusar(new Error("o teste esperou demais")), 5_000);
        sinal?.addEventListener("abort", () => {
          clearTimeout(espera);
          recusar(sinal.reason);
        });
      });
    }
    return portal.buscar(input, init);
  }) as typeof fetch;
  const comecou = Date.now();
  const pelaMetade = await lerTicketsComSessao(sessao, { buscar: lento, codigos: ["A777", "B702", "A701"], agora: QUARTA, terminarAte: comecou + 300 });
  assert.ok(Date.now() - comecou < 2_000, `a leitura passou muito da hora: ${Date.now() - comecou} ms`);
  assert.equal(pelaMetade.pontos.A777?.length, 3, "o primeiro ponto veio antes de o tempo acabar");
  assert.equal(pelaMetade.pontos.B702, undefined, "o ponto em que o tempo acabou não vale como lido");
  assert.match(pelaMetade.falhas.B702, /sem resposta do portal \(o portal demorou demais para responder\)/);
  // O ponto seguinte nem é pedido — e o motivo diz que ele abre a próxima leitura.
  assert.equal(pelaMetade.pontos.A701, undefined);
  assert.equal(pelaMetade.falhas.A701, MOTIVO_SEM_TEMPO);
  assert.match(MOTIVO_SEM_TEMPO, /não deu tempo .* é o primeiro da próxima/);
  assert.equal(pedidos, 3);
  semValores(pelaMetade.diagnostico);
});

test("nenhum caminho da leitura pede algo com “pdf”, mesmo com o botão na tela de resultado", async () => {
  const portal = portalCom(conta({ lancamentos: { "0|0": [], "1|0": VIAGENS, "2|0": [VIAGENS[0]] } }));
  const sessao = await sessaoAberta(portal);
  for (let i = 0; i < 3; i += 1) await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A701", "A777", "B702"], agora: QUARTA });
  assert.ok(!portal.pedidos.some((p) => /pdf/i.test(p.caminho) || /pdf/i.test(p.corpo)), "nenhum pedido com pdf");
  assert.deepEqual(portal.acoes, []);
  assert.equal(portal.consultasDeTicket.length, 9);
});
