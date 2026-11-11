import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enderecoDeAcao,
  extrairLinksMenu,
  extrairSecoes,
  interpretarStatus,
  type SecaoPortal,
} from "../src/lib/portal-copadubo-parse";
import {
  INTERVALO_LEITURA_MS,
  JANELA_LEITURA_APOS_SAIDA_H,
  leituraPeriodicaDevida,
  lerTelasDoMotorista,
  umPorVez,
} from "../src/lib/portal-copadubo";
import {
  ESPERA_NOVA_CONSULTA_MS,
  JANELA_ESPERA_MS,
  MAX_CONSULTAS_ATIVO,
  MAX_CONSULTAS_FALHA,
  decidirAvisoDeSaida,
  situacaoDoPontoNasTelas,
  type ConsultaPortal,
  type SituacaoNoPortal,
} from "../src/lib/portal-saida";
import { pontoEmDispensa } from "../src/lib/portal-status-ponto";
import { textoAvisoSaida } from "../src/lib/push";
import { BASE_FALSA, CPF_FALSO, SENHA_FALSA, criarPortalFalso, telaFila, telaStatus } from "./portal-fixture";

/**
 * SAÍDA DO PONTO: o que o portal diz (ATIVO / ESCALADO / EM DISPENSA) e o
 * aviso que sai. Tudo aqui é função pura ou portal de mentira — sem banco e
 * sem rede. O fluxo inteiro com banco está em `portal-saida-cron.test.ts`.
 *
 * As telas são INVENTADAS (o HTML real da área logada não é público). Por isso
 * o leitor trabalha por linhas de texto e estes testes variam o desenho da
 * tela: tabela, cartões, selo antes ou depois do número.
 */

process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
const CRED = { cpf: CPF_FALSO, senha: SENHA_FALSA };
const secoesDe = (html: string) => extrairSecoes(html).secoes;

/* ------------------------------------------------- situação do ponto (leitor) */

test("status: ESCALADO traz as linhas da escala como o portal escreve, na ordem", () => {
  const s = interpretarStatus(
    secoesDe(
      telaStatus([
        {
          codigo: "A032",
          situacao: "ESCALADO",
          linhas: ["Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"],
          botao: "Confirmar presença",
        },
      ]),
    ),
    "A032",
  );
  assert.ok(s);
  assert.equal(s.codigo, "A032");
  assert.equal(s.turno, "ESCALADO");
  assert.equal(s.cartao, "ABC-1D23");
  assert.equal(s.haMinutos, 2);
  assert.deepEqual(s.detalhes.slice(0, 4), [
    "Desde hoje, 11:32 · há 2 min",
    "Navio: NAVIO DE EXEMPLO",
    "Terminal: TERMINAL DE EXEMPLO",
    "Carga: FERTILIZANTE",
  ]);
  assert.ok(!s.detalhes.some((l) => /Confirmar presença/.test(l)), "texto de botão entrou nos dados da escala");
});

test("status: ATIVO e EM DISPENSA; botão de ação nunca vira a situação", () => {
  const ativo = interpretarStatus(secoesDe(telaStatus([{ codigo: "A032", situacao: "ATIVO", botao: "Entrar em dispensa" }])), "A032");
  assert.equal(ativo?.turno, "ATIVO", "o botão “Entrar em dispensa” foi lido como situação");

  const dispensa = interpretarStatus(
    secoesDe(telaStatus([{ codigo: "A032", situacao: "EM DISPENSA", linhas: ["Desde hoje, 08:10 · há 41 min", "MOTIVO", "001 - OFICINA"], botao: "Sair da dispensa" }])),
    "A032",
  );
  assert.equal(dispensa?.turno, "EM DISPENSA");
  assert.equal(dispensa?.motivo, "001 - OFICINA");
  assert.equal(dispensa?.haMinutos, 41);
});

test("status: “Último Ponto Escalado” do quadro de ativos não é a situação do ponto", () => {
  // O ponto está ATIVO e a mesma página mostra o quadro com ele como último escalado.
  const pagina = `<h1>Status do Ponto</h1>
    <div><b>A032</b> <span>ABC-1D23</span> <span>ATIVO</span></div>
    <h2>Livro A - Truck</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A032</div>
    <table><tr><td>1</td><td>A109</td><td>TRUCK 4 EIXOS</td></tr></table>`;
  assert.equal(interpretarStatus(secoesDe(pagina), "A032")?.turno, "ATIVO");

  // Só o quadro, sem cartão do ponto: não há situação para inventar.
  const soQuadro = telaFila("A", "A032", [{ codigo: "A109", tipo: "TRUCK 4 EIXOS" }]);
  assert.equal(interpretarStatus(secoesDe(soQuadro), "A032")?.turno ?? null, null);
});

test("status: motorista com dois pontos — cada cartão com a sua situação e as suas linhas", () => {
  const secoes = secoesDe(
    telaStatus([
      { codigo: "A032", situacao: "ESCALADO", linhas: ["Navio: NAVIO DE EXEMPLO"] },
      { codigo: "B015", situacao: "EM DISPENSA", linhas: ["MOTIVO", "003 - DOCUMENTOS"], botao: "Sair da dispensa" },
    ]),
  );
  const a = interpretarStatus(secoes, "A032");
  const b = interpretarStatus(secoes, "B015");
  assert.equal(a?.turno, "ESCALADO");
  assert.ok(a?.detalhes.includes("Navio: NAVIO DE EXEMPLO"));
  assert.ok(!a?.detalhes.some((l) => /DOCUMENTOS|B015/.test(l)), "linha do outro ponto entrou neste cartão");
  assert.equal(a?.motivo, null, "o motivo da dispensa do outro ponto foi atribuído a este");
  assert.equal(b?.turno, "EM DISPENSA");
  assert.equal(b?.motivo, "003 - DOCUMENTOS");
  assert.ok(!b?.detalhes.some((l) => /NAVIO/.test(l)));

  // O selo de dispensa do app olha o cartão do PRÓPRIO ponto.
  const leitura = { ok: 1, criadoEm: new Date(), secoes };
  const cadastro = new Date(Date.now() - 3_600_000).toISOString();
  assert.equal(pontoEmDispensa(leitura, { livro: "B", numero: 15, criadoEm: cadastro }), true);
  assert.equal(pontoEmDispensa(leitura, { livro: "A", numero: 32, criadoEm: cadastro }), false);
});

test("status: outros desenhos de tela — tabela, selo antes do número, legenda de filtros", () => {
  const tabela = `<h2>Status do Ponto</h2><table>
    <tr><th>Ponto</th><th>Placa</th><th>Situação</th></tr>
    <tr><td>A032</td><td>ABC-1D23</td><td>Escalado</td></tr></table>`;
  assert.equal(interpretarStatus(secoesDe(tabela), "A032")?.turno, "ESCALADO");

  const seloAntes = `<h1>Status do Ponto</h1><div class="selo">EM DISPENSA</div><div class="codigo">A032</div><div>MOTIVO</div><div>001 - OFICINA</div>`;
  const s2 = interpretarStatus(secoesDe(seloAntes), "A032");
  assert.equal(s2?.turno, "EM DISPENSA");
  assert.equal(s2?.motivo, "001 - OFICINA");

  // Uma linha com TODAS as situações é legenda/filtro, não o estado do ponto.
  const comLegenda = `<h1>Status do Ponto</h1><div>A032 · ABC-1D23</div><div>Ativo · Escalado · Em dispensa</div><div>ESCALADO</div>`;
  assert.equal(interpretarStatus(secoesDe(comLegenda), "A032")?.turno, "ESCALADO");

  // O selo sozinho vale mais que a palavra no meio de uma frase.
  const comFrase = `<h1>Status do Ponto</h1><div>A032 · ABC-1D23</div><div>Cadastro ativo desde 2020</div><div>ESCALADO</div>`;
  assert.equal(interpretarStatus(secoesDe(comFrase), "A032")?.turno, "ESCALADO");
});

/* ------------------------------------------------ abas do menu (só navegação) */

test("menu: só entra aba de navegação; endereço de ação fica de fora (e “situacao” não é ação)", () => {
  const pagina = `<nav>
    <a href="/moto/">Ponto</a>
    <a href="/moto/situacao">Status</a>
    <a href="/moto/ticket">Ticket</a>
    <a href="/moto/fila">Fila</a>
    <a href="/logout.php">Sair</a>
    <a href="/moto/dispensa/entrar">Entrar em dispensa</a>
    <a href="/moto/acao.php?tipo=sair_dispensa">Status</a>
    <a href="/moto/fazerAcao">Fila</a>
    <a href="javascript:void(0)">Ticket</a>
    <a href="https://outro.exemplo.test/fila">Fila</a>
  </nav>`;
  const ignorados: { texto: string; url: string }[] = [];
  const links = extrairLinksMenu(pagina, `${BASE_FALSA}/moto/`, ignorados);
  assert.deepEqual(
    links.map((l) => `${l.texto} ${l.url}`),
    [
      `Ponto ${BASE_FALSA}/moto/`,
      `Status ${BASE_FALSA}/moto/situacao`,
      `Ticket ${BASE_FALSA}/moto/ticket`,
      `Fila ${BASE_FALSA}/moto/fila`,
      // O link de outro site aparece aqui, mas a sessão só abre o próprio portal.
      "Fila https://outro.exemplo.test/fila",
    ],
  );
  assert.deepEqual(ignorados.map((l) => new URL(l.url).pathname), ["/moto/acao.php", "/moto/fazerAcao"]);

  for (const acao of ["/logout.php", "/moto/dispensa/entrar", "/moto/sairDispensa.php", "/moto/status.php?acao=entrar", "/moto/ticket/novo", "/moto/trocar-senha"]) {
    assert.equal(enderecoDeAcao(acao), true, `${acao} deveria ser tratado como ação`);
  }
  for (const tela of ["/moto/situacao", "/moto/status", "/moto/informacao.php", "/moto/fila", "/moto/ativos?livro=A"]) {
    assert.equal(enderecoDeAcao(tela), false, `${tela} é só uma tela`);
  }
});

/* --------------------------------------- do portal para a situação de UM ponto */

const consultaDe = async (telas: Record<string, string>, codigo: string): Promise<{ consulta: ConsultaPortal; portal: ReturnType<typeof criarPortalFalso> }> => {
  const portal = criarPortalFalso({ telas });
  const r = await lerTelasDoMotorista(CRED, [], { buscar: portal.buscar, codigo });
  return {
    portal,
    consulta: {
      resultado: r.loginRecusado ? "login_recusado" : r.captcha ? "captcha" : r.ok ? "lido" : "falha",
      telas: r.telas,
      diagnostico: r.diagnostico,
    },
  };
};

test("consulta: ESCALADO vira um aviso com as linhas da escala — sem menu, rodapé, botão ou o nome do motorista", async () => {
  const { consulta, portal } = await consultaDe(
    {
      "moto/status": telaStatus([
        {
          codigo: "A032",
          situacao: "ESCALADO",
          linhas: ["Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"],
          nome: "FULANO DE TAL EXEMPLO",
          botao: "Confirmar presença",
        },
      ]),
      "moto/fila": telaFila("A", "A032", [{ codigo: "A109", tipo: "TRUCK 4 EIXOS" }]),
    },
    "A032",
  );
  const situacao = situacaoDoPontoNasTelas(consulta, "A032", { nomeMotorista: "Fulano Exemplo" });
  assert.equal(situacao.tipo, "status");
  if (situacao.tipo !== "status") return;
  const { evento } = situacao;
  assert.equal(evento.saiu, true);
  assert.equal(evento.turno, "ESCALADO");
  assert.equal(evento.titulo, "🚛 Seu ponto foi ESCALADO");
  assert.equal(
    evento.mensagem,
    ["Seu ponto A032 foi ESCALADO.", "Desde hoje, 11:32 · há 2 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "Carga: FERTILIZANTE"].join("\n"),
  );
  assert.doesNotMatch(evento.mensagem, /0800|Sair|Ticket|Confirmar|FULANO/);
  assert.deepEqual(portal.acoes, []);

  const decisao = decidirAvisoDeSaida({ codigo: "A032", situacao, ehUltimoEscalado: true, tentativas: 1, idadeMs: 1_000 });
  assert.equal(decisao.acao, "avisar");
  if (decisao.acao !== "avisar") return;
  assert.deepEqual(decisao.portal, { saiu: true, titulo: evento.titulo, mensagem: evento.mensagem });
  assert.match(decisao.historico, /^A032 foi ESCALADO\. · Desde hoje, 11:32/);
});

test("consulta: ESCALADO sem dados na tela avisa mesmo assim e diz onde conferir", async () => {
  const { consulta } = await consultaDe({ "moto/status": telaStatus([{ codigo: "A032", situacao: "ESCALADO", nome: "FULANO DE TAL EXEMPLO" }]) }, "A032");
  const situacao = situacaoDoPontoNasTelas(consulta, "A032", { nomeMotorista: "Fulano" });
  assert.equal(situacao.tipo, "status");
  if (situacao.tipo !== "status") return;
  assert.match(situacao.evento.mensagem, /^Seu ponto A032 foi ESCALADO\.\nO portal não mostrou os dados da escala nesta tela/);
});

test("consulta: linha em maiúsculas que não é o nome do motorista continua no aviso", async () => {
  // Um dado da escala em maiúsculas (navio) não pode ser confundido com o nome.
  const { consulta } = await consultaDe(
    { "moto/status": telaStatus([{ codigo: "A032", situacao: "ESCALADO", linhas: ["NAVIO DE EXEMPLO", "TERMINAL DE EXEMPLO"], nome: "FULANO DE TAL EXEMPLO" }]) },
    "A032",
  );
  const comNome = situacaoDoPontoNasTelas(consulta, "A032", { nomeMotorista: "Fulano" });
  const semNome = situacaoDoPontoNasTelas(consulta, "A032");
  for (const s of [comNome, semNome]) {
    assert.equal(s.tipo, "status");
    if (s.tipo !== "status") continue;
    assert.match(s.evento.mensagem, /NAVIO DE EXEMPLO\nTERMINAL DE EXEMPLO/, "um dado da escala foi descartado como se fosse o nome");
  }
});

test("consulta: ponto diferente do monitorado, tela sem situação e portal fora nunca viram destino", async () => {
  const outro = await consultaDe({ "moto/status": telaStatus([{ codigo: "B015", situacao: "ESCALADO", linhas: ["Navio: OUTRO"] }]) }, "A032");
  const s1 = situacaoDoPontoNasTelas(outro.consulta, "A032");
  assert.equal(s1.tipo, "falha");
  if (s1.tipo === "falha") assert.match(s1.motivo, /mostrou o ponto B015, e não o A032/);

  const semSituacao = await consultaDe({ "moto/status": `<h1>Status do Ponto</h1><div>A032 · ABC-1D23</div><div>Sem informação no momento</div>` }, "A032");
  const s2 = situacaoDoPontoNasTelas(semSituacao.consulta, "A032");
  assert.equal(s2.tipo, "falha");
  if (s2.tipo === "falha") assert.match(s2.motivo, /sem uma situação conhecida/);

  const semTela = await consultaDe({}, "A032");
  const s3 = situacaoDoPontoNasTelas(semTela.consulta, "A032");
  assert.equal(s3.tipo, "falha");

  assert.deepEqual(situacaoDoPontoNasTelas({ resultado: "login_recusado", telas: [], diagnostico: [] }, "A032"), { tipo: "login_recusado" });
  assert.deepEqual(situacaoDoPontoNasTelas({ resultado: "captcha", telas: [], diagnostico: [] }, "A032"), { tipo: "captcha" });
  assert.deepEqual(situacaoDoPontoNasTelas({ resultado: "sem_acesso", telas: [], diagnostico: [] }, "A032"), { tipo: "sem_acesso" });
});

/* ------------------------------------------------------- decisão do aviso */

const situacaoCom = async (situacao: string, linhas: string[] = []): Promise<SituacaoNoPortal> => {
  const { consulta } = await consultaDe({ "moto/status": telaStatus([{ codigo: "A032", situacao, linhas }]) }, "A032");
  return situacaoDoPontoNasTelas(consulta, "A032", { nomeMotorista: "Fulano" });
};

test("decisão: EM DISPENSA avisa na hora, com o motivo", async () => {
  const situacao = await situacaoCom("EM DISPENSA", ["Desde hoje, 08:10 · há 41 min", "MOTIVO", "001 - OFICINA"]);
  const d = decidirAvisoDeSaida({ codigo: "A032", situacao, ehUltimoEscalado: false, tentativas: 1, idadeMs: 0 });
  assert.equal(d.acao, "avisar");
  if (d.acao !== "avisar") return;
  assert.equal(d.portal?.saiu, true);
  assert.equal(d.portal?.titulo, "🟥 Seu ponto foi para a DISPENSA");
  assert.match(d.portal?.mensagem ?? "", /Seu ponto A032 saiu para a DISPENSA \(motivo 001 - OFICINA\)\. Está nessa situação há 41 min\./);
});

test("decisão: portal ainda ATIVO — Último Escalado avisa já; número que só sumiu espera e consulta de novo", async () => {
  const ativo = await situacaoCom("ATIVO");

  // O quadro confirma a chamada: avisa na hora, pelo quadro, dizendo o que o portal mostra.
  const d1 = decidirAvisoDeSaida({ codigo: "A032", situacao: ativo, ehUltimoEscalado: true, tentativas: 1, idadeMs: 0 });
  assert.equal(d1.acao, "avisar");
  if (d1.acao === "avisar") {
    assert.equal(d1.portal?.saiu, false, "ATIVO não pode ser anunciado como saída confirmada pelo portal");
    assert.match(d1.portal?.observacao ?? "", /ainda aparece como ATIVO/);
  }

  // O número só sumiu: nova consulta em 1 minuto, até a quarta.
  for (let tentativas = 1; tentativas < MAX_CONSULTAS_ATIVO; tentativas += 1) {
    const d = decidirAvisoDeSaida({ codigo: "A032", situacao: ativo, ehUltimoEscalado: false, tentativas, idadeMs: tentativas * 60_000 });
    assert.deepEqual({ acao: d.acao, emMs: d.acao === "aguardar" ? d.emMs : null }, { acao: "aguardar", emMs: ESPERA_NOVA_CONSULTA_MS });
  }
  const d4 = decidirAvisoDeSaida({ codigo: "A032", situacao: ativo, ehUltimoEscalado: false, tentativas: MAX_CONSULTAS_ATIVO, idadeMs: 3 * 60_000 });
  assert.equal(d4.acao, "avisar", "depois das novas consultas o aviso tem de sair");
  if (d4.acao === "avisar") {
    assert.equal(d4.portal?.saiu, false);
    assert.match(d4.portal?.observacao ?? "", /continua ATIVO, sem escala nem dispensa/);
    assert.match(d4.historico, /não está mais no quadro · portal mostra ATIVO/);
  }

  // Nunca fica em silêncio: passada a janela, avisa mesmo na primeira consulta.
  const tarde = decidirAvisoDeSaida({ codigo: "A032", situacao: ativo, ehUltimoEscalado: false, tentativas: 1, idadeMs: JANELA_ESPERA_MS });
  assert.equal(tarde.acao, "avisar");
});

test("decisão: falha de leitura tenta mais uma vez; recusa, captcha e sem acesso avisam pelo quadro na hora", () => {
  const falha: SituacaoNoPortal = { tipo: "falha", motivo: "Portal respondeu 503." };
  const d1 = decidirAvisoDeSaida({ codigo: "A032", situacao: falha, ehUltimoEscalado: false, tentativas: 1, idadeMs: 0 });
  assert.equal(d1.acao, "aguardar");
  const d2 = decidirAvisoDeSaida({ codigo: "A032", situacao: falha, ehUltimoEscalado: false, tentativas: MAX_CONSULTAS_FALHA, idadeMs: 60_000 });
  assert.equal(d2.acao, "avisar");
  if (d2.acao === "avisar") {
    assert.equal(d2.portal, null, "sem leitura do portal, vale o aviso do quadro");
    assert.equal(d2.historico, "A032 não está mais no quadro · destino não confirmado");
  }
  // Chamada confirmada pelo quadro não espera o portal voltar.
  const d3 = decidirAvisoDeSaida({ codigo: "A032", situacao: falha, ehUltimoEscalado: true, tentativas: 1, idadeMs: 0 });
  assert.equal(d3.acao, "avisar");

  for (const tipo of ["login_recusado", "captcha", "sem_acesso"] as const) {
    const d = decidirAvisoDeSaida({ codigo: "A032", situacao: { tipo }, ehUltimoEscalado: false, tentativas: 1, idadeMs: 0 });
    assert.equal(d.acao, "avisar", `${tipo}: insistir só repetiria a mesma falha na conta do motorista`);
    if (d.acao === "avisar") assert.equal(d.portal, null);
  }
});

/* ------------------------------------------------------------ texto do aviso */

test("aviso: o texto diz o que o portal confirmou — ou diz claramente que não confirmou", () => {
  const base = { codigo: "A032", rotulo: "Truck", livro: "A", nome: "Fulano" };

  const classico = textoAvisoSaida({ ...base, saidaPorUltimo: false, portal: null });
  assert.equal(classico.title, "🚛 Monitor Ponto CopaLinks");
  assert.equal(
    classico.body,
    "Olá, Fulano! Seu número A032 não aparece mais no quadro. O destino não foi confirmado no Portal do Motorista.\nTruck — Livro A",
  );

  const ativo = textoAvisoSaida({
    ...base,
    saidaPorUltimo: true,
    portal: { saiu: false, titulo: "x", mensagem: "y", observacao: "No Portal do Motorista o ponto ainda aparece como ATIVO: a escala ainda não foi registrada lá." },
  });
  assert.equal(ativo.title, "🚛 Monitor Ponto CopaLinks", "o título de ATIVO do portal não pode ir no aviso de saída");
  assert.match(ativo.body, /agora aparece como Último Escalado\. No Portal do Motorista o ponto ainda aparece como ATIVO/);
  assert.doesNotMatch(ativo.body, /destino não foi confirmado/);

  const escalado = textoAvisoSaida({
    ...base,
    saidaPorUltimo: true,
    portal: { saiu: true, titulo: "🚛 Seu ponto foi ESCALADO", mensagem: "Seu ponto A032 foi ESCALADO.\nNavio: NAVIO DE EXEMPLO" },
  });
  assert.deepEqual(escalado, { title: "🚛 Seu ponto foi ESCALADO", body: "Olá, Fulano! Seu ponto A032 foi ESCALADO.\nNavio: NAVIO DE EXEMPLO" });
});

/* ---------------------------------------------------- leitura periódica */

test("leitura periódica: só entra na conta do motorista com um ponto fora do quadro", () => {
  const agora = Date.UTC(2026, 10, 10, 15, 0, 0);
  const min = 60_000;
  const secoes = (situacao: string): SecaoPortal[] => secoesDe(telaStatus([{ codigo: "A032", situacao }]));
  const fora = [{ codigo: "A032", saidaEm: agora - 30 * min }];
  const devida = (e: Partial<Parameters<typeof leituraPeriodicaDevida>[0]>) =>
    leituraPeriodicaDevida({ agora, pontosFora: fora, ultima: null, falhasSeguidas: 0, ...e });

  // Ponto na fila (nenhum fora): nunca.
  assert.equal(devida({ pontosFora: [] }), false);
  // Saiu há mais tempo que a janela: para de entrar.
  assert.equal(devida({ pontosFora: [{ codigo: "A032", saidaEm: agora - (JANELA_LEITURA_APOS_SAIDA_H * 60 + 1) * min }] }), false);
  // Fora do quadro e nunca lido: sim.
  assert.equal(devida({}), true);
  // Lido há menos que o intervalo: não (nem depois de falha).
  assert.equal(devida({ ultima: { ok: true, em: agora - (INTERVALO_LEITURA_MS - min), secoes: secoes("EM DISPENSA") } }), false);
  assert.equal(devida({ ultima: { ok: false, em: agora - 2 * min, secoes: [] } }), false);
  // Última leitura boa é de ANTES da saída: precisa de uma nova.
  assert.equal(devida({ ultima: { ok: true, em: agora - 40 * min, secoes: secoes("ATIVO") } }), true);
  // Lido depois da saída e ESCALADO/ATIVO: não há o que acompanhar.
  assert.equal(devida({ ultima: { ok: true, em: agora - 20 * min, secoes: secoes("ESCALADO") } }), false);
  assert.equal(devida({ ultima: { ok: true, em: agora - 20 * min, secoes: secoes("ATIVO") } }), false);
  // EM DISPENSA: relê para saber quando ela termina (o selo do ponto depende disso).
  assert.equal(devida({ ultima: { ok: true, em: agora - 11 * min, secoes: secoes("EM DISPENSA") } }), true);
  // Falhas: tenta de novo no intervalo; depois de 3 seguidas, só a cada 30 min.
  assert.equal(devida({ ultima: { ok: false, em: agora - 11 * min, secoes: [] }, falhasSeguidas: 1 }), true);
  assert.equal(devida({ ultima: { ok: false, em: agora - 11 * min, secoes: [] }, falhasSeguidas: 3 }), false);
  assert.equal(devida({ ultima: { ok: false, em: agora - 31 * min, secoes: [] }, falhasSeguidas: 3 }), true);
});

/* ------------------------------------------------ um login por vez por conta */

test("um por vez: idas ao portal do mesmo motorista não se cruzam; outro motorista não espera", async () => {
  const ordem: string[] = [];
  const tarefa = (nome: string, ms: number, falhar = false) => async () => {
    ordem.push(`inicio ${nome}`);
    await new Promise((r) => setTimeout(r, ms));
    ordem.push(`fim ${nome}`);
    if (falhar) throw new Error(`falha ${nome}`);
    return nome;
  };

  const a = umPorVez(901, tarefa("a", 30, true));
  const b = umPorVez(901, tarefa("b", 5));
  const c = umPorVez(902, tarefa("c", 1));
  const resultados = await Promise.allSettled([a, b, c]);

  assert.equal(resultados[0].status, "rejected", "o erro da tarefa chega a quem chamou");
  assert.deepEqual(resultados.slice(1).map((r) => (r.status === "fulfilled" ? r.value : null)), ["b", "c"]);
  // A falha de uma ida não trava a fila; “b” só começa depois de “a” terminar.
  assert.ok(ordem.indexOf("inicio b") > ordem.indexOf("fim a"), ordem.join(", "));
  // O motorista 902 não esperou o 901.
  assert.ok(ordem.indexOf("fim c") < ordem.indexOf("fim a"), ordem.join(", "));

  // Dois logins “simultâneos” na mesma conta: o portal vê um de cada vez.
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([{ codigo: "A032", situacao: "ATIVO" }]) } });
  await Promise.all([
    umPorVez(903, () => lerTelasDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032" })),
    umPorVez(903, () => lerTelasDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032" })),
  ]);
  assert.equal(portal.logins, 2);
  assert.equal(portal.maxSimultaneos, 1, "dois logins simultâneos na mesma conta");
});
