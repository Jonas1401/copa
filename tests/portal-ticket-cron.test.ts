import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, telaStatus, type CartaoFalso, type LancamentoFalso, type TicketFalso } from "./portal-fixture";

/**
 * SALDO DE GANHOS — AS VIAGENS DA SEMANA, DE PONTA A PONTA, PELO CRON.
 *
 * O motorista cadastra a porcentagem — uma para CADA ponto dele; a partir daí,
 * de 5 em 5 minutos, depois da rodada do Status, a sessão guardada dele abre a
 * aba “Ticket” do portal, escolhe cada ponto cadastrado no app (todos, na
 * mesma leitura) e a semana de hoje, e envia o “Gerar”. O card mostra viagens,
 * valor bruto e comissão — a mesma conta do “Cálculo de Frete” em cada ponto,
 * e um saldo só, que soma todos. Só o próprio motorista vê os números.
 *
 * Teste de integração isolado: nunca rode com o banco de produção. Use um
 * PostgreSQL local descartável e VAZIO chamado fila_push_test_<sufixo>:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_ticket \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fila_push_test_ticket \
 *   ./node_modules/.bin/tsx --test tests/portal-ticket-cron.test.ts
 *
 * Nada sai da máquina; pessoas, CPFs, pontos, pesos e valores são inventados.
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

// CPFs com os dígitos verificadores ERRADOS de propósito (não são de ninguém) e senhas inventadas.
const CPF_ALFA = "70000000011";
const SENHA_ALFA = "senha-alfa-11";
const CPF_CHARLIE = "70000000022";
const SENHA_CHARLIE = "senha-charlie-22";

/** A semana (segunda a segunda) que contém hoje em Brasília, e as duas anteriores, como a tela escreve. */
function semanasDeHoje() {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const dia = new Date(`${hoje}T12:00:00Z`);
  const desdeSegunda = (dia.getUTCDay() + 6) % 7;
  const mais = (dias: number) => {
    const d = new Date(dia);
    d.setUTCDate(d.getUTCDate() - desdeSegunda + dias);
    return d.toISOString().slice(0, 10);
  };
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return {
    inicio: mais(0),
    fim: mais(7),
    /** Datas de dentro da semana (a segunda e a terça), como a tela escreve. */
    segunda: br(mais(0)),
    terca: br(mais(1)),
    lista: [`${br(mais(0))} - ${br(mais(7))}`, `${br(mais(-7))} - ${br(mais(0))}`, `${br(mais(-14))} - ${br(mais(-7))}`],
  };
}

test("Saldo de Ganhos: o cron lê o Ticket de quem cadastrou a porcentagem, e só dele", { skip: !local }, async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  process.env.CRON_SECRET = "segredo-isolado-do-cron";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-este-teste-0123456789";
  process.env.COMPOSIO_API_KEY = "";
  delete process.env.PORTAL_FONTE_SAIDA;
  delete process.env.PORTAL_INTERVALO_MIN;
  delete process.env.FONTE_FILA;
  delete process.env.PORTAL_FILA_LIVROS;
  delete process.env.PORTAL_TICKET;
  delete process.env.PORTAL_TICKET_INTERVALO_MIN;

  const { db, pool } = await import("../src/db");
  const { eventos, motoristas, pontos, portalTicketConfig, portalTicketPorcentagens, portalTickets } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { MOTIVO_SEM_TEMPO, MOTIVO_SEM_TEMPO_PARA_COMECAR, apagarDadosPortalDoMotorista, removerAcessoPortal, salvarAcessoPortal } = await import("../src/lib/portal-copadubo");
  const { TICKET_COMECA_ATE_MS, TICKET_TERMINA_ATE_MS, monitorarMotorista, monitorarTickets } = await import("../src/lib/portal-monitor");
  const {
    MAX_PONTOS_POR_LEITURA,
    atualizarTicketsDoMotorista,
    contaDasViagens,
    desligarTicket,
    intervaloTicketMs,
    pontosDaVez,
    porcentagemEmCentesimos,
    resumoDoTicket,
    salvarPorcentagensDoTicket,
    saudeDoTicket,
  } = await import("../src/lib/portal-ticket");
  const { brl, calcular } = await import("../src/lib/frete");
  const { GET } = await import("../src/app/api/cron/route");
  const { eq, sql } = await import("drizzle-orm");

  /* ------------------------------------------------- portal de mentira */
  const semana = semanasDeHoje();
  const cartao = (codigo: string): CartaoFalso => ({ codigo, situacao: "ATIVO", linhas: ["Ativado hoje, 06:10"], botao: "Entrar na dispensa" });
  const viagem = (quant: string, valor: string, hora: string, data = semana.segunda, servico = "FRETE ATE 5 KM"): LancamentoFalso => ({ quant, valor, servico, data, hora });
  // A conta do alfa tem 6 pontos no portal; no app ele cadastrou primeiro dois (A777 e B702).
  const ticketsAlfa: TicketFalso = {
    pontos: ["A701", "A777", "B702", "M703", "A705", "A706"],
    semanas: semana.lista,
    lancamentos: {
      "1|0": [viagem("29.920", "17.29", "21:00"), viagem("32.140", "17.29", "03:40", semana.terca), viagem("30.000", "21.12", "14:05", semana.terca, "FRETE DE 5 A 10 KM")],
      "2|0": [viagem("29.920", "17.29", "09:30")],
      // A semana passada não é a de hoje: nunca entra na conta.
      "1|1": [viagem("40.000", "99.00", "10:00")],
    },
    comCodigoOculto: true,
  };
  const ticketsCharlie: TicketFalso = { pontos: ["A701"], semanas: semana.lista, lancamentos: { "0|0": [viagem("33.330", "44.44", "08:00")] } };
  const portal = criarPortalFalso({
    cpf: CPF_ALFA,
    senha: SENHA_ALFA,
    telas: { "moto/status": telaStatus([cartao("A777"), cartao("B702")]) },
    tickets: ticketsAlfa,
    contas: { [CPF_CHARLIE]: { senha: SENHA_CHARLIE, telas: { "moto/status": telaStatus([cartao("A701")]) }, tickets: ticketsCharlie } },
  });

  const desconhecidos: string[] = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(`${BASE_FALSA}/`)) return portal.buscar(input, init);
    if (url.includes("simport.com.br") || url.includes("open-meteo.com")) return Response.json([]);
    desconhecidos.push(url);
    return new Response("", { status: 503 });
  }) as typeof fetch;

  try {
    await garantirTabelas();
    // Impede a semente de produção em um banco vazio de teste.
    await db.insert(eventos).values({ codigo: "TESTE", tipo: "TRUCK", livro: "A", numero: 1, acao: "cadastrou", mensagem: "Inicialização do teste" });

    // alfa e charlie cadastraram o acesso ao portal; bravo, não.
    const [alfa] = await db.insert(motoristas).values({ nome: "Alfa Teste" }).returning();
    const [bravo] = await db.insert(motoristas).values({ nome: "Bravo Teste" }).returning();
    const [charlie] = await db.insert(motoristas).values({ nome: "Charlie Teste" }).returning();
    const novoPonto = async (motoristaId: number, tipo: string, livro: string, numero: number) =>
      (await db.insert(pontos).values({ tipo, livro, numero, motoristaId, status: "AGUARDANDO" }).returning())[0];
    await novoPonto(alfa.id, "CAVALO", "A", 777);
    await novoPonto(alfa.id, "TRUCK", "B", 702);
    await novoPonto(bravo.id, "CAVALO", "A", 701);
    await novoPonto(charlie.id, "CAVALO", "A", 701);
    await salvarAcessoPortal(alfa.id, { cpf: CPF_ALFA, senha: SENHA_ALFA });
    await salvarAcessoPortal(charlie.id, { cpf: CPF_CHARLIE, senha: SENHA_CHARLIE });

    type ResumoTickets = { motoristas: number; pontos: number; falhas: number };
    const executar = async () => {
      const res = await GET(new Request("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(res.status, 200);
      const dados = (await res.json()) as { tickets?: ResumoTickets; portal?: { motoristas: number; logins: number } };
      return { tickets: dados.tickets ?? null, portal: dados.portal ?? null };
    };
    /** Vence a espera do Status (as contas são lidas de novo no próximo ciclo). */
    const vencerStatus = () => db.execute(sql`update portal_motorista_acessos set proxima_leitura_em = now() - interval '1 second'`);
    /** Vence a espera do Ticket (5 minutos) e o intervalo entre dois “Atualizar”. */
    const vencerTicket = () =>
      db.execute(sql`update portal_ticket_config set proxima_leitura_em = now() - interval '1 second', tentativa_em = now() - interval '1 minute'`);
    let pedidosVistos = 0;
    /** Pedidos ao portal desde a última chamada (método + caminho, sem os parâmetros). */
    const pedidosNovos = () => {
      const fatia = portal.pedidos.slice(pedidosVistos).map((p) => `${p.metodo} ${p.caminho.split("?")[0]}`);
      pedidosVistos = portal.pedidos.length;
      return fatia;
    };
    const doTicket = (lista: string[]) => lista.filter((p) => /ticket/.test(p));
    const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

    /* 1 — ninguém cadastrou a porcentagem: o Status é lido, a aba Ticket nem é aberta. */
    let ciclo = await executar();
    let pedidos = pedidosNovos();
    assert.equal(ciclo.portal?.motoristas, 2);
    assert.equal(ciclo.portal?.logins, 2);
    assert.equal(ciclo.tickets, null);
    assert.deepEqual(doTicket(pedidos), [], pedidos.join(", "));
    let resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.disponivel, true);
    assert.equal(resumo.ligado, false);
    assert.equal(resumo.temAcesso, true);
    assert.equal(resumo.totalPontos, 2);
    assert.equal(resumo.porcentagem, null);
    // Antes de ligar, a tela já sabe de quais pontos pedir a porcentagem: os dois do app.
    assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.porcentagem, p.viagens, p.conta]), [["A777", null, null, null], ["B702", null, null, null]]);
    assert.deepEqual(resumo.semPorcentagem, ["A777", "B702"]);
    assert.deepEqual(resumo.conta, { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 });

    /* 2 — a porcentagem: só número de 0 a 100, com até duas casas — e uma para CADA ponto. */
    assert.equal(porcentagemEmCentesimos("18"), 1800);
    assert.equal(porcentagemEmCentesimos("18,5"), 1850);
    assert.equal(porcentagemEmCentesimos(" 18.25% "), 1825);
    assert.equal(porcentagemEmCentesimos(20), 2000);
    assert.equal(porcentagemEmCentesimos("100"), 10000);
    for (const ruim of ["", "0", "0,00", "100,01", "101", "-5", "18,555", "dezoito", "1e2", "18 5", null, undefined, {}, Number.NaN]) {
      assert.equal(porcentagemEmCentesimos(ruim), null, `aceitou ${String(ruim)}`);
    }
    // alfa tem dois pontos e cadastra primeiro só a porcentagem do A777: isso já liga a consulta.
    await salvarPorcentagensDoTicket(alfa.id, { A777: 1850 });
    // bravo cadastra a porcentagem sem ter o acesso ao portal: nada é lido para ele.
    await salvarPorcentagensDoTicket(bravo.id, { A701: 2000 });
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.ligado, true);
    assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.porcentagem]), [["A777", 18.5], ["B702", null]]);
    assert.deepEqual(resumo.semPorcentagem, ["B702"]);
    assert.equal(resumo.porcentagem, null, "com ponto sem porcentagem não existe “a porcentagem de todos”");
    assert.equal((await resumoDoTicket(bravo.id)).porcentagem, 20, "um ponto só: a porcentagem dele é a de todos");
    assert.equal(resumo.semana, null, "antes da primeira leitura não há semana");
    assert.equal(resumo.completo, false);
    assert.equal(resumo.pontos.length, 2);
    assert.ok(resumo.pontos.every((p) => p.viagens === null && p.conta === null));

    /* 3 — o próximo ciclo: depois do Status, o Ticket do alfa — um “Gerar” por ponto do app, com ou sem porcentagem. */
    await vencerStatus();
    const loginsAntes = portal.logins;
    ciclo = await executar();
    pedidos = pedidosNovos();
    assert.deepEqual(ciclo.tickets, { motoristas: 1, pontos: 2, falhas: 0 });
    // O código escondido é de uso único: o formulário é aberto antes de cada “Gerar”.
    assert.deepEqual(doTicket(pedidos), ["GET moto/ticket", "POST moto/ticket_lista.php", "GET moto/ticket", "POST moto/ticket_lista.php"], pedidos.join(", "));
    // O Ticket vem DEPOIS do Status de todas as contas.
    assert.ok(pedidos.lastIndexOf("GET moto/status") < pedidos.indexOf("GET moto/ticket"), pedidos.join(", "));
    assert.deepEqual(portal.consultasDeTicket, [`A777 ${semana.inicio}`, `B702 ${semana.inicio}`]);
    assert.equal(portal.logins, loginsAntes, "com a sessão guardada, nem o Status nem o Ticket fazem login");
    assert.equal(portal.ticketsRecusados, 0);

    resumo = await resumoDoTicket(alfa.id);
    assert.deepEqual(resumo.semana, { inicio: semana.inicio, fim: semana.fim });
    assert.equal(resumo.completo, true);
    assert.equal(resumo.recente, true);
    assert.equal(resumo.erro, null);
    assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.viagens?.length ?? null, p.erro]), [["A777", 3, null], ["B702", 1, null]]);
    // O monitoramento é de TODOS os pontos do app: o B702 foi lido mesmo sem porcentagem. O saldo já
    // soma as viagens e o bruto dos dois; a comissão espera a porcentagem do B702 (nunca pela metade).
    perto(29.92 * 17.29 + 32.14 * 17.29 + 30 * 21.12, 1706.6174);
    perto(29.92 * 17.29, 517.3168);
    assert.equal(resumo.conta.viagens, 4);
    assert.equal(resumo.conta.bruto, 2223.94);
    assert.equal(resumo.conta.comissao, null, "falta a porcentagem do B702: a comissão do saldo não é somada");
    assert.deepEqual(resumo.semPorcentagem, ["B702"]);
    assert.deepEqual(resumo.pontos.map((p) => [p.conta?.bruto, p.conta?.comissao]), [[1706.62, 315.72], [517.32, null]]);
    perto(resumo.conta.toneladas, 29.92 + 32.14 + 30 + 29.92);

    // O motorista põe a porcentagem do B702 — outra, 20 %: a comissão aparece na hora, sem ir ao portal.
    pedidosNovos();
    await salvarPorcentagensDoTicket(alfa.id, { B702: 2000 });
    assert.deepEqual(pedidosNovos(), [], "cadastrar a porcentagem não abre o portal");
    resumo = await resumoDoTicket(alfa.id);
    assert.deepEqual(resumo.semPorcentagem, []);
    assert.equal(resumo.porcentagem, null, "cada ponto com a sua: não há uma porcentagem só para escrever");
    assert.deepEqual(
      resumo.pontos.map((p) => [p.codigo, p.porcentagem, p.conta?.bruto, p.conta?.comissao]),
      [["A777", 18.5, 1706.62, 315.72], ["B702", 20, 517.32, 103.46]],
    );
    // UM saldo só: a soma dos dois pontos, cada um com a porcentagem dele (315,72 + 103,46).
    assert.deepEqual([resumo.conta.viagens, resumo.conta.bruto, resumo.conta.comissao], [4, 2223.94, 419.18]);
    // Cada ponto é a conta do “Cálculo de Frete” para o ticket DELE, carga por carga.
    for (const [i, porcentagem] of [[0, 18.5], [1, 20]] as const) {
      const doPonto = resumo.pontos[i];
      const naCalculadora = calcular(
        { ponto: "", cargas: (doPonto.viagens ?? []).map((v, n) => ({ id: String(n), quant: v.quant, valor: v.valor, subtotal: v.quant * v.valor, linha: "", confianca: "alta" as const })) },
        porcentagem,
      );
      assert.equal(brl(doPonto.conta?.bruto ?? Number.NaN), brl(naCalculadora.bruto));
      assert.equal(brl(doPonto.conta?.comissao ?? Number.NaN), brl(naCalculadora.ganho));
      assert.equal(doPonto.conta?.viagens, naCalculadora.cargas.length);
    }
    assert.deepEqual(contaDasViagens([], 18.5), { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 });
    // A primeira viagem, como ficou guardada.
    assert.deepEqual(resumo.pontos[0].viagens?.[0], { quant: 29.92, valor: 17.29, servico: "FRETE ATE 5 KM", data: semana.inicio, hora: "21:00" });

    // Quem não ligou a consulta (charlie) e quem não tem acesso (bravo): nada lido, nada guardado.
    const sessaoDoAlfa = portal.pedidos.find((p) => /ticket/.test(p.caminho))?.cookie ?? "";
    assert.equal(portal.sessoes.get(/PHPSESSID=([^;]+)/.exec(sessaoDoAlfa)?.[1] ?? ""), CPF_ALFA, "quem abriu o Ticket foi a conta do alfa");
    assert.ok(portal.pedidos.filter((p) => /ticket/.test(p.caminho)).every((p) => p.cookie === sessaoDoAlfa), "só a sessão do alfa abriu o Ticket");
    assert.ok(!portal.consultasDeTicket.some((c) => c.startsWith("A701")), "o ponto do charlie nunca foi consultado");
    const doCharlie = await resumoDoTicket(charlie.id);
    assert.equal(doCharlie.ligado, false);
    assert.deepEqual(doCharlie.pontos.map((p) => [p.codigo, p.porcentagem, p.viagens]), [["A701", null, null]]);
    assert.equal(doCharlie.conta.viagens, 0);
    const doBravo = await resumoDoTicket(bravo.id);
    assert.equal(doBravo.ligado, true);
    assert.equal(doBravo.temAcesso, false);
    assert.equal(doBravo.conta.viagens, 0);
    assert.equal(doBravo.semana, null);
    assert.deepEqual((await db.select().from(portalTickets)).map((l) => l.motoristaId).filter((id) => id !== alfa.id), []);

    /* 4 — antes de 5 minutos, o ciclo seguinte olha o Status e NÃO abre o Ticket. */
    assert.equal(intervaloTicketMs(), 5 * 60_000);
    await vencerStatus();
    ciclo = await executar();
    pedidos = pedidosNovos();
    assert.equal(ciclo.tickets, null);
    assert.deepEqual(doTicket(pedidos), [], pedidos.join(", "));
    assert.ok(pedidos.includes("GET moto/status"));

    /* 5 — 5 minutos depois: a viagem nova aparece, e a conta acompanha. */
    ticketsAlfa.lancamentos["2|0"] = [viagem("29.920", "17.29", "09:30"), viagem("31.500", "18.00", "16:45", semana.terca)];
    await vencerStatus();
    await vencerTicket();
    ciclo = await executar();
    pedidosNovos();
    assert.deepEqual(ciclo.tickets, { motoristas: 1, pontos: 2, falhas: 0 });
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.conta.viagens, 5);
    // B702: 517,3168 + 31,5 t × R$ 18,00 = 1.084,32; a 20 % = 216,86. Saldo: 1.706,62 + 1.084,32 e 315,72 + 216,86.
    assert.deepEqual(resumo.pontos.map((p) => [p.conta?.bruto, p.conta?.comissao]), [[1706.62, 315.72], [1084.32, 216.86]]);
    assert.deepEqual([resumo.conta.bruto, resumo.conta.comissao], [2790.94, 532.58]);
    const lidoB702 = resumo.pontos[1].lidoEm;
    assert.ok(lidoB702);
    // Viagens guardadas de OUTRA semana (a passada, e uma de 11 semanas atrás) nunca entram na soma desta.
    const diasAntes = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
    const deOutraSemana = (inicio: string) => ({
      motoristaId: alfa.id,
      codigo: "A777",
      semanaInicio: inicio,
      semanaFim: diasAntes(inicio, -7),
      lancamentos: [{ quant: 40, valor: 99, servico: "FRETE ATE 5 KM", data: inicio, hora: "10:00" }],
      lidoEm: new Date(Date.now() - 3_600_000),
      tentativaEm: new Date(Date.now() - 3_600_000),
      erro: null,
    });
    await db.insert(portalTickets).values([deOutraSemana(diasAntes(semana.inicio, 7)), deOutraSemana(diasAntes(semana.inicio, 77))]);
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.conta.viagens, 5, "viagem de outra semana não entra na soma desta");
    assert.deepEqual([resumo.conta.bruto, resumo.conta.comissao], [2790.94, 532.58]);
    assert.equal(resumo.pontos[0].viagens?.length, 3);

    /* 6 — a tela chega pela metade: nada muda; fica a última leitura boa, com o motivo. */
    ticketsAlfa.cortada = true;
    ticketsAlfa.lancamentos["2|0"] = [viagem("29.920", "17.29", "09:30")];
    await vencerTicket();
    ciclo = await executar();
    pedidosNovos();
    assert.deepEqual(ciclo.tickets, { motoristas: 1, pontos: 0, falhas: 2 });
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.conta.viagens, 5, "a leitura cortada não apaga nem troca as viagens guardadas");
    assert.equal(resumo.pontos[1].viagens?.length, 2);
    assert.equal(resumo.pontos[1].lidoEm, lidoB702, "a hora mostrada é a da última leitura BOA");
    assert.match(resumo.pontos[0].erro ?? "", /cortada/);
    assert.match(resumo.pontos[1].erro ?? "", /cortada/);
    assert.equal(resumo.completo, true, "os dois pontos continuam com leitura (a anterior)");
    // Depois de uma leitura sem nada, a próxima tentativa vem em 1 minuto (e não em 5).
    const [esperaCurta] = (await db.execute(sql`select extract(epoch from (proxima_leitura_em - now())) as s from portal_ticket_config where motorista_id = ${alfa.id}`)).rows as { s: string }[];
    assert.ok(Number(esperaCurta.s) > 30 && Number(esperaCurta.s) <= 61, `próxima tentativa em ${esperaCurta.s} s`);
    ticketsAlfa.cortada = undefined;
    ticketsAlfa.lancamentos["2|0"] = [viagem("29.920", "17.29", "09:30"), viagem("31.500", "18.00", "16:45", semana.terca)];

    /* 7 — sessão encerrada pelo portal: o Ticket NÃO faz login; as viagens guardadas ficam. */
    portal.sessoes.clear();
    await vencerTicket();
    const loginsAntesDaQueda = portal.logins;
    let leitura = await atualizarTicketsDoMotorista(alfa.id);
    pedidos = pedidosNovos();
    assert.equal(leitura.tentou, true);
    assert.deepEqual(leitura.lidos, []);
    assert.match(leitura.falhas.A777, /pediu o login de novo/);
    assert.equal(portal.logins, loginsAntesDaQueda, "a leitura do Ticket nunca envia o login");
    assert.ok(!pedidos.some((p) => p.startsWith("POST")), pedidos.join(", "));
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.conta.viagens, 5);
    assert.match(resumo.erro ?? "", /pediu o login de novo/);
    // O motivo antigo de cada ponto (“cortada”) não é mais o da última tentativa: sai da tela.
    assert.deepEqual(resumo.pontos.map((p) => p.erro), [null, null]);
    assert.deepEqual((await saudeDoTicket()).contas.find((c) => c.motoristaId === alfa.id)?.erros.length, 1);
    // Quem entra de novo é a leitura do Status; em seguida o Ticket volta a ler.
    await monitorarMotorista(alfa.id, { avisar: false });
    assert.equal(portal.logins, loginsAntesDaQueda + 1);
    pedidosNovos();

    /* 8 — “Atualizar”: lê na hora, sem esperar os 5 minutos; dois toques seguidos viram uma leitura só. */
    await vencerTicket();
    await db.execute(sql`update portal_ticket_config set proxima_leitura_em = now() + interval '4 minutes'`);
    leitura = await atualizarTicketsDoMotorista(alfa.id);
    assert.equal(leitura.tentou, false, "sem “Atualizar”, a leitura espera a hora");
    assert.equal(leitura.motivo, "nao_e_a_hora");
    leitura = await atualizarTicketsDoMotorista(alfa.id, { forcar: true });
    assert.deepEqual(leitura.lidos, ["A777", "B702"]);
    assert.deepEqual(leitura.falhas, {});
    const deNovo = await atualizarTicketsDoMotorista(alfa.id, { forcar: true });
    assert.equal(deNovo.tentou, false);
    assert.equal(deNovo.motivo, "nao_e_a_hora");
    pedidos = pedidosNovos();
    assert.equal(pedidos.filter((p) => p === "POST moto/ticket_lista.php").length, 2, pedidos.join(", "));
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.erro, null);
    assert.equal(resumo.pontos[0].erro, null);
    // A leitura boa limpa o que tem mais de 70 dias; a semana passada continua guardada (fora da soma).
    const semanasDoA777 = (await db.select({ inicio: portalTickets.semanaInicio }).from(portalTickets).where(sql`${portalTickets.motoristaId} = ${alfa.id} and ${portalTickets.codigo} = 'A777'`))
      .map((l) => l.inicio)
      .sort();
    assert.deepEqual(semanasDoA777, [diasAntes(semana.inicio, 7), semana.inicio]);
    assert.equal(resumo.conta.viagens, 5);

    /* 9 — duas funções ao mesmo tempo (cron + app aberto): só uma abre o Ticket. */
    await vencerTicket();
    const juntas = await Promise.all([atualizarTicketsDoMotorista(alfa.id), atualizarTicketsDoMotorista(alfa.id), atualizarTicketsDoMotorista(alfa.id)]);
    assert.equal(juntas.filter((r) => r.tentou).length, 1);
    pedidos = pedidosNovos();
    assert.equal(pedidos.filter((p) => p === "POST moto/ticket_lista.php").length, 2, pedidos.join(", "));

    /* 10 — trocar a porcentagem de UM ponto refaz a conta na hora, sem ir ao portal — e não mexe na do outro. */
    await salvarPorcentagensDoTicket(alfa.id, { B702: 2200 });
    resumo = await resumoDoTicket(alfa.id);
    assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.porcentagem, p.conta?.comissao]), [["A777", 18.5, 315.72], ["B702", 22, 238.55]]);
    assert.deepEqual([resumo.conta.viagens, resumo.conta.bruto, resumo.conta.comissao], [5, 2790.94, 554.27]);
    // Os dois com a MESMA porcentagem: aí existe “a porcentagem de todos” (a tela escreve “Comissão · 22%”).
    await salvarPorcentagensDoTicket(alfa.id, { A777: 2200 });
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.porcentagem, 22);
    assert.deepEqual(resumo.pontos.map((p) => p.conta?.comissao), [375.46, 238.55]);
    assert.equal(resumo.conta.comissao, 614.01);
    await salvarPorcentagensDoTicket(alfa.id, { A777: 1850 });
    // A coluna antiga do cadastro guarda só a última porcentagem salva (para a versão anterior do app).
    assert.equal((await db.select().from(portalTicketConfig).where(eq(portalTicketConfig.motoristaId, alfa.id)))[0].porcentagemCentesimos, 1850);
    assert.deepEqual(pedidosNovos(), []);

    /* 11 — o monitoramento é de TODOS os pontos do app: cinco pontos, cinco “Gerar” na MESMA leitura. */
    assert.equal(MAX_PONTOS_POR_LEITURA, 10);
    await novoPonto(alfa.id, "CAVALO", "A", 701);
    await novoPonto(alfa.id, "CAVALO", "M", 703);
    await novoPonto(alfa.id, "TRUCK", "A", 705);
    // Ponto novo que só tem viagem guardada da semana PASSADA: nesta semana ele ainda não foi lido.
    await db.insert(portalTickets).values({ ...deOutraSemana(diasAntes(semana.inicio, 7)), codigo: "M703" });
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.pontos.find((x) => x.codigo === "M703")?.viagens, null, "viagem da semana passada não vale como leitura desta");
    assert.equal(resumo.conta.viagens, 5);
    assert.equal(resumo.completo, false);
    // Ponto novo nasce SEM porcentagem: a comissão do saldo sai da tela até o motorista cadastrar a de cada um.
    assert.deepEqual(resumo.semPorcentagem, ["A701", "M703", "A705"]);
    assert.deepEqual([resumo.conta.bruto, resumo.conta.comissao], [2790.94, null]);
    await db.delete(portalTickets).where(sql`${portalTickets.motoristaId} = ${alfa.id} and ${portalTickets.codigo} = 'M703'`);
    ticketsAlfa.lancamentos["4|0"] = [viagem("28.000", "20.00", "11:11")];
    await vencerTicket();
    leitura = await atualizarTicketsDoMotorista(alfa.id);
    // Todos na mesma leitura: primeiro os que nunca foram lidos, depois os de leitura mais antiga.
    assert.deepEqual(leitura.lidos, ["A701", "M703", "A705", "A777", "B702"]);
    assert.deepEqual(leitura.falhas, {});
    assert.ok(!/pontos consultados nesta leitura/.test(leitura.diagnostico.join(" ")), "nenhum ponto ficou para a próxima leitura");
    pedidos = pedidosNovos();
    assert.equal(pedidos.filter((p) => p === "POST moto/ticket_lista.php").length, 5, "uma leitura, cinco pontos");
    assert.deepEqual(portal.consultasDeTicket.slice(-5), ["A701", "M703", "A705", "A777", "B702"].map((c) => `${c} ${semana.inicio}`));
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.totalPontos, 5);
    assert.equal(resumo.completo, true);
    assert.equal(resumo.conta.viagens, 6);
    // A viagem do A705 (28 t × R$ 20,00) já entra no bruto; a comissão espera as três porcentagens que faltam.
    assert.deepEqual([resumo.conta.bruto, resumo.conta.comissao], [3350.94, null]);
    // Duas de uma vez; ainda falta uma.
    await salvarPorcentagensDoTicket(alfa.id, { A701: 1500, A705: 1800 });
    // A coluna da versão anterior guarda a última porcentagem salva: se o deploy voltar, o app antigo ainda tem uma para usar.
    const ultimaSalva = async (motoristaId: number) =>
      ((await db.execute(sql`select porcentagem_centesimos from portal_ticket_config where motorista_id = ${motoristaId}`)).rows as { porcentagem_centesimos: number }[])[0]?.porcentagem_centesimos;
    assert.equal(await ultimaSalva(alfa.id), 1800);
    resumo = await resumoDoTicket(alfa.id);
    assert.deepEqual(resumo.semPorcentagem, ["M703"]);
    assert.equal(resumo.conta.comissao, null);
    await salvarPorcentagensDoTicket(alfa.id, { M703: 1500 });
    assert.equal(await ultimaSalva(alfa.id), 1500);
    resumo = await resumoDoTicket(alfa.id);
    assert.deepEqual(resumo.semPorcentagem, []);
    assert.deepEqual(
      resumo.pontos.map((p) => [p.codigo, p.porcentagem, p.conta?.viagens, p.conta?.comissao]),
      [["A777", 18.5, 3, 315.72], ["B702", 22, 2, 238.55], ["A701", 15, 0, 0], ["M703", 15, 0, 0], ["A705", 18, 1, 100.8]],
    );
    // Um saldo só, dos cinco pontos: 315,72 + 238,55 + 100,80.
    assert.deepEqual([resumo.conta.viagens, resumo.conta.bruto, resumo.conta.comissao], [6, 3350.94, 655.07]);
    assert.deepEqual(pedidosNovos(), [], "cadastrar porcentagem não abre o portal");
    // A leitura seguinte traz os cinco de novo.
    await vencerTicket();
    leitura = await atualizarTicketsDoMotorista(alfa.id);
    assert.deepEqual(leitura.lidos, ["A777", "B702", "A701", "M703", "A705"]);
    pedidos = pedidosNovos();
    assert.equal(pedidos.filter((p) => p === "POST moto/ticket_lista.php").length, 5);
    // Só acima do teto há rodízio: quem ficou mais tempo sem ser consultado vem primeiro.
    const cinco = resumo.pontos.map((p) => p.codigo);
    assert.deepEqual(await pontosDaVez(alfa.id, cinco), cinco);
    await db.execute(sql`update portal_tickets set tentativa_em = tentativa_em + interval '1 second' where motorista_id = ${alfa.id} and codigo in ('A777', 'B702') and semana_inicio = ${semana.inicio}`);
    assert.deepEqual(await pontosDaVez(alfa.id, cinco, 3), ["A701", "M703", "A705"]);
    assert.deepEqual(await pontosDaVez(alfa.id, cinco), ["A701", "M703", "A705", "A777", "B702"]);
    // Os pontos de UMA leitura ficam com a mesma hora. Se o tempo acabou antes da vez de um deles, é ele
    // que abre a leitura seguinte — senão o último da lista ficaria para trás toda vez que o portal está lento.
    await db.execute(sql`update portal_tickets set tentativa_em = date_trunc('second', now()) where motorista_id = ${alfa.id} and semana_inicio = ${semana.inicio}`);
    assert.deepEqual(await pontosDaVez(alfa.id, cinco), cinco);
    await db.execute(sql`update portal_tickets set erro = ${MOTIVO_SEM_TEMPO} where motorista_id = ${alfa.id} and codigo in ('M703', 'A705') and semana_inicio = ${semana.inicio}`);
    assert.deepEqual(await pontosDaVez(alfa.id, cinco), ["M703", "A705", "A777", "B702", "A701"]);
    await db.execute(sql`update portal_tickets set erro = null where motorista_id = ${alfa.id} and semana_inicio = ${semana.inicio}`);

    // A leitura tem hora para acabar dentro da função que a chamou (o cron tem 60 s no total): sem tempo,
    // nada é pedido ao portal, as viagens guardadas ficam com a hora delas, e o motivo fica registrado.
    assert.ok(TICKET_COMECA_ATE_MS.cron + 12_000 <= TICKET_TERMINA_ATE_MS.cron && TICKET_TERMINA_ATE_MS.cron <= 52_000, "a leitura que começa por último ainda tem 12 s, e sobra tempo para gravar");
    assert.ok(TICKET_COMECA_ATE_MS.appAberto + 20_000 <= TICKET_TERMINA_ATE_MS.appAberto && TICKET_TERMINA_ATE_MS.appAberto <= 52_000);
    await vencerTicket();
    pedidosNovos();
    assert.deepEqual(await monitorarTickets(Date.now(), { terminaAteMs: -1 }), { motoristas: 1, pontos: 0, falhas: 5 });
    assert.deepEqual(doTicket(pedidosNovos()), [], "sem tempo, a aba Ticket nem é aberta");
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.erro, MOTIVO_SEM_TEMPO_PARA_COMECAR);
    assert.deepEqual([resumo.conta.viagens, resumo.conta.bruto, resumo.conta.comissao, resumo.completo], [6, 3350.94, 655.07, true], "o que estava guardado continua valendo");
    // Como depois de qualquer leitura sem nada, a próxima tentativa vem em 1 minuto.
    const [aposSemTempo] = (await db.execute(sql`select extract(epoch from (proxima_leitura_em - now())) as s from portal_ticket_config where motorista_id = ${alfa.id}`)).rows as { s: string }[];
    assert.ok(Number(aposSemTempo.s) > 30 && Number(aposSemTempo.s) <= 61, `próxima tentativa em ${aposSemTempo.s} s`);
    // Com o prazo normal do cron, a leitura seguinte traz tudo e limpa o motivo.
    await vencerTicket();
    assert.deepEqual(await monitorarTickets(Date.now()), { motoristas: 1, pontos: 5, falhas: 0 });
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.erro, null);
    assert.deepEqual(resumo.pontos.map((p) => p.erro), [null, null, null, null, null]);
    assert.equal(doTicket(pedidosNovos()).filter((x) => x === "POST moto/ticket_lista.php").length, 5);

    // Ponto do app que a conta do portal não tem: fica com o motivo, e os outros seguem.
    await novoPonto(alfa.id, "CAVALO", "A", 799);
    await vencerTicket();
    leitura = await atualizarTicketsDoMotorista(alfa.id);
    assert.match(leitura.falhas.A799, /a lista de pontos desta conta no portal não tem o A799/);
    assert.equal(leitura.lidos.length, 5, "os cinco pontos que a conta tem vieram na mesma leitura");
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.completo, false, "falta a leitura do A799");
    assert.equal(resumo.conta.viagens, 6, "a soma é a dos pontos lidos");
    assert.match(resumo.pontos.find((p) => p.codigo === "A799")?.erro ?? "", /não tem o A799/);
    // …e, enquanto ele estiver no app sem porcentagem, a comissão do saldo fica em branco.
    assert.deepEqual(resumo.semPorcentagem, ["A799"]);
    assert.deepEqual([resumo.conta.bruto, resumo.conta.comissao], [3350.94, null]);
    await db.delete(pontos).where(sql`${pontos.motoristaId} = ${alfa.id} and ${pontos.numero} = 799`);
    resumo = await resumoDoTicket(alfa.id);
    assert.deepEqual([resumo.semPorcentagem, resumo.conta.comissao], [[], 655.07], "tirado o ponto do app, o saldo volta a fechar");
    pedidosNovos();

    /* 12 — o administrador vê se a leitura funciona; nunca peso, valor, porcentagem ou comissão. */
    const saude = await saudeDoTicket();
    assert.equal(saude.ligado, true);
    assert.equal(saude.motoristas, 2);
    const daConta = saude.contas.find((c) => c.motoristaId === alfa.id);
    assert.ok(daConta?.lidoEm);
    assert.equal(daConta?.pontosLidos, 5);
    // (As horas saem do texto antes da conferência: “18.5” também é um jeito de escrever 18,5 segundos.)
    const textoDaSaude = JSON.stringify(saude).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<hora>");
    const guardado = JSON.stringify((await db.execute(sql`select erro, diagnostico from portal_ticket_config`)).rows) + JSON.stringify((await db.execute(sql`select erro from portal_tickets`)).rows);
    for (const numero of ["29.92", "29,92", "17.29", "17,29", "21.12", "31.5", "32.14", "517", "1706", "0.185", "18.5", "1850", "2200", "1500", "1800", "655", "3350", "\"quant\"", "\"valor\"", "bruto", "comiss", "porcentage"]) {
      assert.ok(!textoDaSaude.includes(numero), `o resumo do administrador mostra “${numero}”`);
    }
    for (const numero of ["29.92", "29,92", "17.29", "17,29", "21.12", "32.14", "31.5"]) {
      assert.ok(!guardado.includes(numero), `o diagnóstico guardado mostra “${numero}”`);
    }
    // Nas tabelas do Ticket não há nada da conta do portal: nem CPF, nem senha, nem cookie.
    const bruto =
      JSON.stringify((await db.execute(sql`select * from portal_tickets`)).rows) +
      JSON.stringify((await db.execute(sql`select * from portal_ticket_config`)).rows) +
      JSON.stringify((await db.execute(sql`select * from portal_ticket_porcentagens`)).rows);
    // A porcentagem de cada ponto fica na tabela dela: uma linha por ponto, só de quem cadastrou.
    assert.deepEqual(
      ((await db.execute(sql`select motorista_id, codigo, porcentagem_centesimos from portal_ticket_porcentagens order by motorista_id, codigo`)).rows as { motorista_id: number; codigo: string; porcentagem_centesimos: number }[]).map(
        (l) => [l.motorista_id, l.codigo, l.porcentagem_centesimos],
      ),
      [[alfa.id, "A701", 1500], [alfa.id, "A705", 1800], [alfa.id, "A777", 1850], [alfa.id, "B702", 2200], [alfa.id, "M703", 1500], [bravo.id, "A701", 2000]],
    );
    for (const segredo of [CPF_ALFA, SENHA_ALFA, CPF_CHARLIE, SENHA_CHARLIE, "PHPSESSID", "logado", "_token", "tq"]) {
      assert.ok(!bruto.includes(segredo), `as tabelas do Ticket não podem guardar “${segredo}”`);
    }

    /* 13 — PORTAL_TICKET=desligado: nem com a leitura vencida a aba é aberta. */
    process.env.PORTAL_TICKET = "desligado";
    await vencerStatus();
    await vencerTicket();
    ciclo = await executar();
    pedidos = pedidosNovos();
    assert.equal(ciclo.tickets, null);
    assert.deepEqual(doTicket(pedidos), []);
    assert.equal((await atualizarTicketsDoMotorista(alfa.id, { forcar: true })).motivo, "desligado");
    assert.equal((await resumoDoTicket(alfa.id)).disponivel, false);
    delete process.env.PORTAL_TICKET;
    // Com PORTAL_FONTE_SAIDA=quadro não existe a rodada do Status (que mantém a sessão): o Ticket também não é lido sozinho.
    process.env.PORTAL_FONTE_SAIDA = "quadro";
    await vencerTicket();
    assert.deepEqual(await monitorarTickets(Date.now()), { motoristas: 0, pontos: 0, falhas: 0 });
    assert.deepEqual(doTicket(pedidosNovos()), []);
    delete process.env.PORTAL_FONTE_SAIDA;

    /* 14 — tirar o acesso ao portal apaga as viagens (as porcentagens ficam); desligar apaga tudo. */
    await removerAcessoPortal(alfa.id);
    assert.equal((await db.select().from(portalTickets).where(eq(portalTickets.motoristaId, alfa.id))).length, 0);
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.ligado, true);
    assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.porcentagem]), [["A777", 18.5], ["B702", 22], ["A701", 15], ["M703", 15], ["A705", 18]]);
    assert.equal(resumo.temAcesso, false);
    assert.equal(resumo.conta.viagens, 0);
    assert.equal(resumo.semana, null);
    await vencerTicket();
    ciclo = await executar();
    assert.deepEqual(doTicket(pedidosNovos()), [], "sem acesso ao portal, o Ticket não é aberto");
    assert.equal(await desligarTicket(alfa.id), true);
    assert.equal((await resumoDoTicket(alfa.id)).ligado, false);
    assert.equal((await db.select().from(portalTicketPorcentagens).where(eq(portalTicketPorcentagens.motoristaId, alfa.id))).length, 0, "desligar apaga a porcentagem de todos os pontos");
    assert.equal(await desligarTicket(alfa.id), false);
    // Ligar de novo começa do zero: só o ponto que ele cadastrar agora tem porcentagem — mesmo que
    // tenha sobrado no banco uma linha de porcentagem de antes (ela não vale sem o motorista pôr de novo).
    await db.insert(portalTicketPorcentagens).values({ motoristaId: alfa.id, codigo: "A777", porcentagemCentesimos: 9900 });
    await salvarPorcentagensDoTicket(alfa.id, { A705: 1900 });
    resumo = await resumoDoTicket(alfa.id);
    assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.porcentagem]), [["A777", null], ["B702", null], ["A701", null], ["M703", null], ["A705", 19]]);
    assert.equal(await desligarTicket(alfa.id), true);
    // Cadastro do motorista excluído: não sobra nada dele.
    await apagarDadosPortalDoMotorista(bravo.id);
    assert.equal((await db.select().from(portalTicketConfig)).length, 0);
    assert.equal((await db.select().from(portalTicketPorcentagens)).length, 0);

    /* 15 — “Desligar o Saldo de Ganhos” com viagens guardadas: saem as viagens e a porcentagem — só as de quem desligou. */
    await salvarPorcentagensDoTicket(charlie.id, { A701: 1500 });
    await monitorarMotorista(charlie.id, { avisar: false });
    const doCharlieLido = await atualizarTicketsDoMotorista(charlie.id, { forcar: true });
    assert.deepEqual(doCharlieLido.lidos, ["A701"]);
    const resumoDoCharlie = await resumoDoTicket(charlie.id);
    assert.equal(resumoDoCharlie.conta.viagens, 1);
    // Um ponto só: a tela é a de sempre — a porcentagem dele, e a comissão é ela sobre o bruto (33,33 t × R$ 44,44 × 15 %).
    assert.equal(resumoDoCharlie.porcentagem, 15);
    assert.deepEqual([resumoDoCharlie.conta.bruto, resumoDoCharlie.conta.comissao], [1481.19, 222.18]);
    perto(33.33 * 44.44 * 0.15, 222.17778);
    assert.equal(await desligarTicket(charlie.id), true);
    assert.equal((await db.select().from(portalTickets).where(eq(portalTickets.motoristaId, charlie.id))).length, 0, "desligar apaga as viagens guardadas");
    assert.equal((await db.select().from(portalTicketConfig).where(eq(portalTicketConfig.motoristaId, charlie.id))).length, 0);
    assert.equal((await db.select().from(portalTicketPorcentagens).where(eq(portalTicketPorcentagens.motoristaId, charlie.id))).length, 0);
    assert.equal((await resumoDoTicket(charlie.id)).temAcesso, true, "o acesso ao portal (o aviso de saída) continua");
    pedidosNovos();

    /* 16 — quem cadastrou UMA porcentagem na versão anterior: ela vira a de cada ponto que ele tem — uma vez só. */
    const [delta] = await db.insert(motoristas).values({ nome: "Delta Teste" }).returning();
    const [eco] = await db.insert(motoristas).values({ nome: "Eco Teste" }).returning();
    // Como a versão anterior gravava: uma porcentagem para tudo, sem a marca “por ponto”.
    const cadastroAntigo = (motoristaId: number, centesimos: number) =>
      db.execute(sql`insert into portal_ticket_config (motorista_id, porcentagem_centesimos) values (${motoristaId}, ${centesimos})`);
    const porcentagensDe = async (motoristaId: number) =>
      ((await db.execute(sql`select codigo, porcentagem_centesimos from portal_ticket_porcentagens where motorista_id = ${motoristaId} order by codigo`)).rows as { codigo: string; porcentagem_centesimos: number }[]).map(
        (l) => [l.codigo, l.porcentagem_centesimos],
      );
    const marcaPorPonto = async (motoristaId: number) => (await db.select().from(portalTicketConfig).where(eq(portalTicketConfig.motoristaId, motoristaId)))[0]?.porPontoEm ?? null;
    await cadastroAntigo(delta.id, 1750);
    // Ainda sem ponto no app: nada a converter; continua ligado, esperando o ponto.
    resumo = await resumoDoTicket(delta.id);
    assert.equal(resumo.ligado, true);
    assert.deepEqual(resumo.pontos, []);
    assert.equal(await marcaPorPonto(delta.id), null);
    await novoPonto(delta.id, "CAVALO", "A", 706);
    await novoPonto(delta.id, "TRUCK", "A", 706); // o mesmo código nos dois tipos é UM ponto no portal
    await novoPonto(delta.id, "CAVALO", "B", 702);
    // O card, a página e o cron olham ao mesmo tempo: a conversão acontece uma vez, e todos veem o mesmo.
    const juntos = await Promise.all([resumoDoTicket(delta.id), resumoDoTicket(delta.id), resumoDoTicket(delta.id), atualizarTicketsDoMotorista(delta.id)]);
    for (const visto of juntos.slice(0, 3) as Awaited<ReturnType<typeof resumoDoTicket>>[]) {
      assert.deepEqual(visto.pontos.map((p) => [p.codigo, p.porcentagem]), [["A706", 17.5], ["B702", 17.5]]);
      assert.equal(visto.porcentagem, 17.5);
      assert.deepEqual(visto.semPorcentagem, []);
    }
    assert.deepEqual(await porcentagensDe(delta.id), [["A706", 1750], ["B702", 1750]]);
    assert.ok(await marcaPorPonto(delta.id));
    // Ponto cadastrado DEPOIS nasce sem porcentagem: a antiga não é copiada de novo.
    await novoPonto(delta.id, "CAVALO", "M", 703);
    resumo = await resumoDoTicket(delta.id);
    assert.deepEqual(resumo.semPorcentagem, ["M703"]);
    assert.equal(resumo.porcentagem, null);
    assert.deepEqual(await porcentagensDe(delta.id), [["A706", 1750], ["B702", 1750]]);
    await salvarPorcentagensDoTicket(delta.id, { M703: 2100 });
    resumo = await resumoDoTicket(delta.id);
    assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.porcentagem]), [["A706", 17.5], ["B702", 17.5], ["M703", 21]]);
    // Um valor estragado no banco (zero, negativo, mais de 100 %) nunca vira porcentagem: o ponto fica “sem porcentagem”.
    for (const estragado of [0, -500, 10_001]) {
      await db.execute(sql`update portal_ticket_porcentagens set porcentagem_centesimos = ${estragado} where motorista_id = ${delta.id} and codigo = 'B702'`);
      resumo = await resumoDoTicket(delta.id);
      assert.deepEqual(resumo.pontos.map((p) => [p.codigo, p.porcentagem]), [["A706", 17.5], ["B702", null], ["M703", 21]], `aceitou ${estragado}`);
      assert.deepEqual(resumo.semPorcentagem, ["B702"]);
    }
    // Quem salva antes de olhar (a página nova, logo depois da atualização): a antiga vai para os outros pontos e a nova vale no dele.
    await novoPonto(eco.id, "CAVALO", "A", 701);
    await novoPonto(eco.id, "CAVALO", "A", 705);
    await cadastroAntigo(eco.id, 1600);
    await salvarPorcentagensDoTicket(eco.id, { A705: 2000 });
    assert.deepEqual(await porcentagensDe(eco.id), [["A701", 1600], ["A705", 2000]]);
    assert.ok(await marcaPorPonto(eco.id));
    // Sem acesso ao portal, nada disso abriu o Ticket.
    assert.deepEqual(doTicket(pedidosNovos()), []);
    await desligarTicket(delta.id);
    await desligarTicket(eco.id);
    assert.equal((await db.select().from(portalTicketPorcentagens)).length, 0);

    /* Em todo o percurso. */
    assert.deepEqual(portal.acoes, [], "nem o “Gerar PDF” nem ação nenhuma do portal");
    assert.deepEqual(portal.foraDoSite, []);
    assert.ok(!portal.pedidos.some((p) => /pdf/i.test(p.caminho) || /pdf/i.test(p.corpo)), "nenhum pedido com pdf");
    // Além do login, o único envio é o “Gerar” da consulta.
    assert.ok(
      portal.pedidos.every((p) => p.metodo === "GET" || p.caminho.startsWith("seguranca/") || p.caminho === "moto/ticket_lista.php"),
      "além do login e do “Gerar”, só leitura",
    );
    assert.ok(portal.consultasDeTicket.every((c) => c.endsWith(` ${semana.inicio}`)), "só a semana de hoje é consultada");
    assert.deepEqual(desconhecidos.filter((u) => u.includes("copadubo") || u.includes("composio")), []);
  } finally {
    globalThis.fetch = fetchReal;
    delete process.env.PORTAL_TICKET;
    await pool.end();
  }
});
