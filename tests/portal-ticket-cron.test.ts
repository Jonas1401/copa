import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_FALSA, criarPortalFalso, telaStatus, type CartaoFalso, type LancamentoFalso, type TicketFalso } from "./portal-fixture";

/**
 * SALDO DE GANHOS — AS VIAGENS DA SEMANA, DE PONTA A PONTA, PELO CRON.
 *
 * O motorista cadastra a porcentagem; a partir daí, de 5 em 5 minutos, depois
 * da rodada do Status, a sessão guardada dele abre a aba “Ticket” do portal,
 * escolhe cada ponto cadastrado no app e a semana de hoje, e envia o “Gerar”.
 * O card mostra viagens, valor bruto e comissão — a mesma conta do “Cálculo de
 * Frete”. Só o próprio motorista vê os números.
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
  const { eventos, motoristas, pontos, portalTicketConfig, portalTickets } = await import("../src/db/schema");
  const { garantirTabelas } = await import("../src/lib/estado");
  const { apagarDadosPortalDoMotorista, removerAcessoPortal, salvarAcessoPortal } = await import("../src/lib/portal-copadubo");
  const { monitorarMotorista, monitorarTickets } = await import("../src/lib/portal-monitor");
  const {
    MAX_PONTOS_POR_LEITURA,
    atualizarTicketsDoMotorista,
    contaDasViagens,
    desligarTicket,
    intervaloTicketMs,
    porcentagemEmCentesimos,
    resumoDoTicket,
    salvarPorcentagemDoTicket,
    saudeDoTicket,
  } = await import("../src/lib/portal-ticket");
  const { calcular } = await import("../src/lib/frete");
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
    assert.deepEqual(resumo.pontos, []);
    assert.deepEqual(resumo.conta, { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 });

    /* 2 — a porcentagem: só número de 0 a 100, com até duas casas. */
    assert.equal(porcentagemEmCentesimos("18"), 1800);
    assert.equal(porcentagemEmCentesimos("18,5"), 1850);
    assert.equal(porcentagemEmCentesimos(" 18.25% "), 1825);
    assert.equal(porcentagemEmCentesimos(20), 2000);
    assert.equal(porcentagemEmCentesimos("100"), 10000);
    for (const ruim of ["", "0", "0,00", "100,01", "101", "-5", "18,555", "dezoito", "1e2", "18 5", null, undefined, {}, Number.NaN]) {
      assert.equal(porcentagemEmCentesimos(ruim), null, `aceitou ${String(ruim)}`);
    }
    await salvarPorcentagemDoTicket(alfa.id, 1850);
    // bravo cadastra a porcentagem sem ter o acesso ao portal: nada é lido para ele.
    await salvarPorcentagemDoTicket(bravo.id, 2000);
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.ligado, true);
    assert.equal(resumo.porcentagem, 18.5);
    assert.equal(resumo.semana, null, "antes da primeira leitura não há semana");
    assert.equal(resumo.completo, false);
    assert.equal(resumo.pontos.length, 2);
    assert.ok(resumo.pontos.every((p) => p.viagens === null && p.conta === null));

    /* 3 — o próximo ciclo: depois do Status, o Ticket do alfa — um “Gerar” por ponto do app. */
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
    // A mesma conta do “Cálculo de Frete”: Quant × Valor, somado; a comissão é a porcentagem do bruto.
    const brutoA777 = 29.92 * 17.29 + 32.14 * 17.29 + 30 * 21.12;
    const brutoB702 = 29.92 * 17.29;
    assert.equal(resumo.conta.viagens, 4);
    perto(resumo.conta.bruto, brutoA777 + brutoB702);
    perto(resumo.conta.comissao, (brutoA777 + brutoB702) * 0.185);
    perto(resumo.conta.toneladas, 29.92 + 32.14 + 30 + 29.92);
    perto(resumo.pontos[0].conta?.bruto ?? 0, brutoA777);
    perto(resumo.pontos[1].conta?.comissao ?? 0, brutoB702 * 0.185);
    // …conferida com a própria calculadora, carga por carga.
    const todas = resumo.pontos.flatMap((p) => p.viagens ?? []);
    const naCalculadora = calcular(
      { ponto: "", cargas: todas.map((v, i) => ({ id: String(i), quant: v.quant, valor: v.valor, subtotal: v.quant * v.valor, linha: "", confianca: "alta" as const })) },
      18.5,
    );
    assert.equal(resumo.conta.bruto, naCalculadora.bruto);
    assert.equal(resumo.conta.comissao, naCalculadora.ganho);
    assert.equal(resumo.conta.viagens, naCalculadora.cargas.length);
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
    assert.deepEqual(doCharlie.pontos, []);
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
    perto(resumo.conta.bruto, brutoA777 + brutoB702 + 31.5 * 18);
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
    perto(resumo.conta.bruto, brutoA777 + brutoB702 + 31.5 * 18);
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

    /* 10 — trocar a porcentagem refaz a conta na hora, sem ir ao portal. */
    await salvarPorcentagemDoTicket(alfa.id, 2000);
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.porcentagem, 20);
    perto(resumo.conta.comissao, resumo.conta.bruto * 0.2);
    assert.equal(resumo.conta.viagens, 5);
    assert.deepEqual(pedidosNovos(), []);

    /* 11 — mais pontos do que cabem numa leitura: rodízio, até 3 “Gerar” por vez. */
    assert.equal(MAX_PONTOS_POR_LEITURA, 3);
    await novoPonto(alfa.id, "CAVALO", "A", 701);
    await novoPonto(alfa.id, "CAVALO", "M", 703);
    await novoPonto(alfa.id, "TRUCK", "A", 705);
    // Ponto novo que só tem viagem guardada da semana PASSADA: nesta semana ele ainda não foi lido.
    await db.insert(portalTickets).values({ ...deOutraSemana(diasAntes(semana.inicio, 7)), codigo: "M703" });
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.pontos.find((x) => x.codigo === "M703")?.viagens, null, "viagem da semana passada não vale como leitura desta");
    assert.equal(resumo.conta.viagens, 5);
    assert.equal(resumo.completo, false);
    await db.delete(portalTickets).where(sql`${portalTickets.motoristaId} = ${alfa.id} and ${portalTickets.codigo} = 'M703'`);
    ticketsAlfa.lancamentos["4|0"] = [viagem("28.000", "20.00", "11:11")];
    await vencerTicket();
    leitura = await atualizarTicketsDoMotorista(alfa.id);
    // Primeiro os que nunca foram lidos.
    assert.deepEqual(leitura.lidos, ["A701", "M703", "A705"]);
    assert.match(leitura.diagnostico.join(" "), /3 de 5 pontos consultados nesta leitura/);
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.totalPontos, 5);
    assert.equal(resumo.completo, true);
    assert.equal(resumo.conta.viagens, 6);
    await vencerTicket();
    leitura = await atualizarTicketsDoMotorista(alfa.id);
    // Depois, os de leitura mais antiga.
    assert.deepEqual(leitura.lidos.slice(0, 2), ["A777", "B702"]);
    assert.equal(leitura.lidos.length, 3);
    pedidos = pedidosNovos();
    assert.equal(pedidos.filter((p) => p === "POST moto/ticket_lista.php").length, 6, "duas leituras, três pontos cada");

    // Ponto do app que a conta do portal não tem: fica com o motivo, e os outros seguem.
    await novoPonto(alfa.id, "CAVALO", "A", 799);
    await vencerTicket();
    leitura = await atualizarTicketsDoMotorista(alfa.id);
    assert.match(leitura.falhas.A799, /a lista de pontos desta conta no portal não tem o A799/);
    assert.equal(leitura.lidos.length, 2);
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.completo, false, "falta a leitura do A799");
    assert.equal(resumo.conta.viagens, 6, "a soma é a dos pontos lidos");
    assert.match(resumo.pontos.find((p) => p.codigo === "A799")?.erro ?? "", /não tem o A799/);
    await db.delete(pontos).where(sql`${pontos.motoristaId} = ${alfa.id} and ${pontos.numero} = 799`);
    pedidosNovos();

    /* 12 — o administrador vê se a leitura funciona; nunca peso, valor, porcentagem ou comissão. */
    const saude = await saudeDoTicket();
    assert.equal(saude.ligado, true);
    assert.equal(saude.motoristas, 2);
    const daConta = saude.contas.find((c) => c.motoristaId === alfa.id);
    assert.ok(daConta?.lidoEm);
    assert.equal(daConta?.pontosLidos, 5);
    const textoDaSaude = JSON.stringify(saude);
    const guardado = JSON.stringify((await db.execute(sql`select erro, diagnostico from portal_ticket_config`)).rows) + JSON.stringify((await db.execute(sql`select erro from portal_tickets`)).rows);
    for (const numero of ["29.92", "29,92", "17.29", "17,29", "21.12", "31.5", "32.14", "517", "1706", "0.185", "18.5", "1850", "2000", "\"quant\"", "\"valor\"", "bruto", "comiss", "porcentagem"]) {
      assert.ok(!textoDaSaude.includes(numero), `o resumo do administrador mostra “${numero}”`);
    }
    for (const numero of ["29.92", "29,92", "17.29", "17,29", "21.12", "32.14", "31.5"]) {
      assert.ok(!guardado.includes(numero), `o diagnóstico guardado mostra “${numero}”`);
    }
    // Nas tabelas do Ticket não há nada da conta do portal: nem CPF, nem senha, nem cookie.
    const bruto = JSON.stringify((await db.execute(sql`select * from portal_tickets`)).rows) + JSON.stringify((await db.execute(sql`select * from portal_ticket_config`)).rows);
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

    /* 14 — tirar o acesso ao portal apaga as viagens (a porcentagem fica); desligar apaga tudo. */
    await removerAcessoPortal(alfa.id);
    assert.equal((await db.select().from(portalTickets).where(eq(portalTickets.motoristaId, alfa.id))).length, 0);
    resumo = await resumoDoTicket(alfa.id);
    assert.equal(resumo.ligado, true);
    assert.equal(resumo.porcentagem, 20);
    assert.equal(resumo.temAcesso, false);
    assert.equal(resumo.conta.viagens, 0);
    assert.equal(resumo.semana, null);
    await vencerTicket();
    ciclo = await executar();
    assert.deepEqual(doTicket(pedidosNovos()), [], "sem acesso ao portal, o Ticket não é aberto");
    assert.equal(await desligarTicket(alfa.id), true);
    assert.equal((await resumoDoTicket(alfa.id)).ligado, false);
    assert.equal(await desligarTicket(alfa.id), false);
    // Cadastro do motorista excluído: não sobra nada dele.
    await apagarDadosPortalDoMotorista(bravo.id);
    assert.equal((await db.select().from(portalTicketConfig)).length, 0);

    /* 15 — “Desligar o Saldo de Ganhos” com viagens guardadas: saem as viagens e a porcentagem — só as de quem desligou. */
    await salvarPorcentagemDoTicket(charlie.id, 1500);
    await monitorarMotorista(charlie.id, { avisar: false });
    const doCharlieLido = await atualizarTicketsDoMotorista(charlie.id, { forcar: true });
    assert.deepEqual(doCharlieLido.lidos, ["A701"]);
    const resumoDoCharlie = await resumoDoTicket(charlie.id);
    assert.equal(resumoDoCharlie.conta.viagens, 1);
    perto(resumoDoCharlie.conta.comissao, 33.33 * 44.44 * 0.15);
    assert.equal(await desligarTicket(charlie.id), true);
    assert.equal((await db.select().from(portalTickets).where(eq(portalTickets.motoristaId, charlie.id))).length, 0, "desligar apaga as viagens guardadas");
    assert.equal((await db.select().from(portalTicketConfig).where(eq(portalTicketConfig.motoristaId, charlie.id))).length, 0);
    assert.equal((await resumoDoTicket(charlie.id)).temAcesso, true, "o acesso ao portal (o aviso de saída) continua");
    pedidosNovos();

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
