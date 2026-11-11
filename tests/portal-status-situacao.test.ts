import assert from "node:assert/strict";
import { test } from "node:test";
import { esperaParaLoginAutomatico, lerPortalDoMotorista, lerTelasDoMotorista, registrarLoginEnviado, sessaoVazia } from "../src/lib/portal-copadubo";
import { analisarPortal, hashEstavel, interpretarStatus } from "../src/lib/portal-copadubo-parse";
import { chamadaDoAvisoDeSaida, foraDaFilaPeloPortal, seloDoPortal } from "../src/lib/portal-selo";
import {
  avisoDaTroca,
  esperaEntreLeiturasMs,
  fontePortal,
  intervaloStatusMs,
  situacaoFresca,
  validadeSituacaoMs,
} from "../src/lib/portal-situacao";
import { BASE_FALSA, CPF_FALSO, SENHA_FALSA, criarPortalFalso, telaFila, telaStatus } from "./portal-fixture";

/**
 * O STATUS DO PORTAL COMO FONTE DO “SAIU TRABALHO” — as regras, sem banco.
 *
 *   - que aviso cada TROCA de situação pede (e quando não pede nenhum);
 *   - a configuração por ambiente (fonte e intervalo);
 *   - a sessão guardada: uma leitura = um pedido; o login só se repete quando o
 *     portal pede, e nunca um atrás do outro;
 *   - o selo do ponto na tela e a chamada para cadastrar o acesso.
 *
 * Tudo contra o portal de mentira (`tests/portal-fixture.ts`): nenhum pedido
 * sai da máquina. O fluxo inteiro, com banco, está em
 * tests/portal-status-monitor.test.ts.
 */

process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
const CRED = { cpf: CPF_FALSO, senha: SENHA_FALSA };
const DEZ_MIN = 10 * 60_000;

const cartao = (situacao: string, linhas: string[] = []) =>
  telaStatus([{ codigo: "A032", situacao, linhas, botao: situacao === "EM DISPENSA" ? "Sair da dispensa" : "Entrar em dispensa" }]);

/** Nada do que é guardado ou mostrado pode carregar CPF ou senha. */
function semCredencial(valor: unknown, onde: string) {
  const texto = JSON.stringify(valor);
  assert.ok(!texto.includes(SENHA_FALSA), `a senha vazou em ${onde}`);
  assert.ok(!texto.includes(CPF_FALSO), `o CPF vazou em ${onde}`);
}

/* ------------------------------------------------------ troca de situação */

test("troca de situação: cada mudança pede o aviso certo", () => {
  assert.equal(avisoDaTroca({ anterior: "ATIVO", novo: "ESCALADO" }), "saiu");
  assert.equal(avisoDaTroca({ anterior: "ATIVO", novo: "EM ATENDIMENTO" }), "saiu");
  assert.equal(avisoDaTroca({ anterior: "ATIVO", novo: "EM DISPENSA" }), "dispensa");
  assert.equal(avisoDaTroca({ anterior: "ESCALADO", novo: "ATIVO" }), "voltou");
  assert.equal(avisoDaTroca({ anterior: "EM DISPENSA", novo: "ATIVO" }), "voltou");
  // Saiu da dispensa direto para o trabalho (e o contrário): são avisos novos.
  assert.equal(avisoDaTroca({ anterior: "EM DISPENSA", novo: "ESCALADO" }), "saiu");
  assert.equal(avisoDaTroca({ anterior: "ESCALADO", novo: "EM DISPENSA" }), "dispensa");
});

test("troca de situação: o que NÃO é novidade não gera aviso", () => {
  // Primeira leitura do ponto: é só o ponto de partida, mesmo já ESCALADO.
  assert.equal(avisoDaTroca({ anterior: null, novo: "ESCALADO" }), null);
  assert.equal(avisoDaTroca({ anterior: undefined, novo: "EM DISPENSA" }), null);
  assert.equal(avisoDaTroca({ anterior: "", novo: "ATIVO" }), null);
  // A mesma situação lida de novo.
  for (const turno of ["ATIVO", "ESCALADO", "EM DISPENSA"]) {
    assert.equal(avisoDaTroca({ anterior: turno, novo: turno }), null, turno);
  }
  // O mesmo trabalho com outro nome, e variações de “na fila”.
  assert.equal(avisoDaTroca({ anterior: "ESCALADO", novo: "EM ATENDIMENTO" }), null);
  assert.equal(avisoDaTroca({ anterior: "EM ATENDIMENTO", novo: "ESCALADO" }), null);
  assert.equal(avisoDaTroca({ anterior: "ATIVO", novo: "AGUARDANDO" }), null);
});

/* ------------------------------------------------------------ configuração */

test("configuração: o Status do portal é o padrão; PORTAL_FONTE_SAIDA=quadro volta ao quadro", () => {
  const antes = process.env.PORTAL_FONTE_SAIDA;
  try {
    delete process.env.PORTAL_FONTE_SAIDA;
    assert.equal(fontePortal(), "portal");
    process.env.PORTAL_FONTE_SAIDA = "";
    assert.equal(fontePortal(), "portal");
    process.env.PORTAL_FONTE_SAIDA = "portal";
    assert.equal(fontePortal(), "portal");
    process.env.PORTAL_FONTE_SAIDA = "qualquer-coisa";
    assert.equal(fontePortal(), "portal", "valor desconhecido não desliga o aviso pelo portal");
    process.env.PORTAL_FONTE_SAIDA = " QUADRO ";
    assert.equal(fontePortal(), "quadro");
  } finally {
    if (antes === undefined) delete process.env.PORTAL_FONTE_SAIDA;
    else process.env.PORTAL_FONTE_SAIDA = antes;
  }
});

test("configuração: 1 minuto por padrão; PORTAL_INTERVALO_MIN aceita de 1 a 60", () => {
  const antes = process.env.PORTAL_INTERVALO_MIN;
  try {
    delete process.env.PORTAL_INTERVALO_MIN;
    assert.equal(intervaloStatusMs(), 60_000);
    for (const [valor, esperado] of [["5", 300_000], ["60", 3_600_000], ["1", 60_000], [" 2 ", 120_000]] as const) {
      process.env.PORTAL_INTERVALO_MIN = valor;
      assert.equal(intervaloStatusMs(), esperado, valor);
    }
    // Fora da faixa ou sem sentido: fica no padrão (nunca mais rápido que 1 min).
    for (const valor of ["0", "-3", "61", "abc", "0.2", ""]) {
      process.env.PORTAL_INTERVALO_MIN = valor;
      assert.equal(intervaloStatusMs(), 60_000, JSON.stringify(valor));
    }
  } finally {
    if (antes === undefined) delete process.env.PORTAL_INTERVALO_MIN;
    else process.env.PORTAL_INTERVALO_MIN = antes;
  }
});

test("a espera gravada fica um pouco abaixo do intervalo, para o despertador de 1 min não pular um ciclo", () => {
  assert.equal(esperaEntreLeiturasMs(60_000), 45_000);
  assert.equal(esperaEntreLeiturasMs(300_000), 285_000);
  assert.equal(esperaEntreLeiturasMs(30_000), 30_000, "nunca menos que 30 s entre leituras da mesma conta");
});

test("situação lida há muito tempo não afirma nada sobre agora", () => {
  const agora = Date.UTC(2026, 10, 10, 12, 0, 0);
  const lida = (minutos: number) => ({ lidoEm: new Date(agora - minutos * 60_000) });
  assert.equal(validadeSituacaoMs(60_000), 5 * 60_000);
  assert.equal(situacaoFresca(lida(0), agora, 60_000), true);
  assert.equal(situacaoFresca(lida(4), agora, 60_000), true);
  assert.equal(situacaoFresca(lida(6), agora, 60_000), false);
  // Intervalo maior: vale por três leituras.
  assert.equal(situacaoFresca(lida(25), agora, 10 * 60_000), true);
  assert.equal(situacaoFresca(lida(31), agora, 10 * 60_000), false);
  assert.equal(situacaoFresca(null, agora, 60_000), false);
  assert.equal(situacaoFresca(undefined, agora, 60_000), false);
});

/* ------------------------------------------------------- histórico enxuto */

test("a mesma tela com o relógio andando tem a mesma impressão digital; uma mudança de verdade, não", () => {
  const secoes = (html: string) => analisarPortal(html).secoes;
  const base = hashEstavel(secoes(cartao("ATIVO", ["Desde hoje, 07:00 · há 5 min"])));
  assert.equal(hashEstavel(secoes(cartao("ATIVO", ["Desde hoje, 07:00 · há 6 min"]))), base);
  assert.equal(hashEstavel(secoes(cartao("ATIVO", ["Desde hoje, 07:00 · há 2 h"]))), base);
  assert.notEqual(hashEstavel(secoes(cartao("ESCALADO", ["Desde hoje, 07:00 · há 5 min"]))), base);
  assert.notEqual(hashEstavel(secoes(cartao("ATIVO", ["Desde hoje, 08:15 · há 5 min"]))), base);
});

/* --------------------------------------------------------- sessão guardada */

test("sessão guardada: a primeira leitura faz o login; as seguintes são UM pedido, sem login", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": cartao("ATIVO", ["Desde hoje, 07:00 · há 5 min"]) } });
  const sessao = sessaoVazia();

  const primeira = await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
  assert.equal(primeira.ok, true, primeira.diagnostico.join(" | "));
  assert.equal(primeira.fezLogin, true);
  assert.equal(portal.logins, 1);
  assert.equal(interpretarStatus(primeira.secoes, "A032")?.turno, "ATIVO");
  assert.ok(Object.keys(sessao.cookies).length > 0, "a sessão aberta não foi guardada");
  assert.equal(sessao.logins.length, 1);
  assert.ok(sessao.statusUrl?.endsWith("/moto/status"), "o endereço da tela de Status não foi guardado");
  semCredencial(sessao, "a sessão guardada");

  for (const situacao of ["ATIVO", "ESCALADO", "EM DISPENSA"]) {
    portal.telas["moto/status"] = cartao(situacao, ["Desde hoje, 11:32 · há 2 min"]);
    const antes = portal.pedidos.length;
    const leitura = await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
    assert.equal(leitura.ok, true, leitura.diagnostico.join(" | "));
    assert.equal(leitura.fezLogin, false);
    assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/status"], "uma leitura com sessão é um pedido só");
    assert.equal(interpretarStatus(leitura.secoes, "A032")?.turno, situacao);
    assert.match(leitura.diagnostico.join("\n"), /Sessão guardada reaproveitada: nenhum login nesta leitura/);
  }
  assert.equal(portal.logins, 1, "com a sessão aberta ninguém faz login de novo");
  assert.deepEqual(portal.acoes, [], "o leitor não toca em botão nenhum");
});

test("sessão encerrada pelo portal: a leitura seguinte entra de novo na hora; se o portal continuar derrubando, o freio segura", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": cartao("ATIVO") } });
  const sessao = sessaoVazia();
  const ler = (esperaEntreLoginsMs = DEZ_MIN) =>
    lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs });
  await ler();
  assert.equal(portal.logins, 1);

  // O portal derruba a sessão (o site reiniciou, o motorista entrou pelo celular…):
  // a leitura automática seguinte entra de novo NA HORA e já traz a situação.
  portal.sessoes.clear();
  const refeita = await ler();
  assert.equal(refeita.ok, true, refeita.diagnostico.join(" | "));
  assert.equal(refeita.fezLogin, true);
  assert.equal(portal.logins, 2);
  assert.equal(interpretarStatus(refeita.secoes, "A032")?.turno, "ATIVO");
  assert.match(refeita.diagnostico.join("\n"), /A sessão guardada venceu/);
  assert.equal(sessao.falhouEm, null, "login aceito não deixa espera de login recusado");

  // Derrubou de novo logo em seguida: agora o freio segura — nada de um login por minuto.
  portal.sessoes.clear();
  let antes = portal.pedidos.length;
  const freada = await ler();
  assert.equal(freada.ok, false);
  assert.equal(freada.fezLogin, false);
  assert.equal(freada.loginRecusado, false, "esperar o freio não é senha recusada");
  assert.ok((freada.tentarEmMs ?? 0) > 9 * 60_000 && (freada.tentarEmMs ?? 0) <= DEZ_MIN, `nova tentativa em ${freada.tentarEmMs} ms`);
  assert.ok(!portal.caminhos().slice(antes).some((p) => p.startsWith("POST")), "o freio não segurou o login");
  assert.equal(portal.logins, 2);
  assert.deepEqual(sessao.cookies, {}, "a sessão vencida continuou guardada");
  assert.match(freada.diagnostico.join("\n"), /A sessão guardada venceu/);
  assert.match(freada.diagnostico.join("\n"), /os últimos logins nesta conta foram há pouco: novo login automático em \d+ min/);

  // …e continua sem login enquanto o freio vale (sem cookie, nem chega a pedir nada).
  antes = portal.pedidos.length;
  const denovo = await ler();
  assert.equal(denovo.ok, false);
  assert.equal(portal.pedidos.length, antes, "sem sessão e com o freio, nenhum pedido vai ao portal");

  // “Ler agora” (sem freio) entra na hora e deixa a sessão pronta de novo.
  const manual = await ler(0);
  assert.equal(manual.ok, true, manual.diagnostico.join(" | "));
  assert.equal(manual.fezLogin, true);
  assert.equal(portal.logins, 3);

  // Passado o freio, o automático também volta a entrar.
  portal.sessoes.clear();
  sessao.logins = sessao.logins.map((t) => t - 11 * 60_000);
  const depois = await ler();
  assert.equal(depois.ok, true, depois.diagnostico.join(" | "));
  assert.equal(portal.logins, 4);
});

test("freio dos logins automáticos: dois em seguida, depois um a cada 10 min; login que não abriu a conta espera 10 min", () => {
  const agora = 1_800_000_000_000;
  const min = 60_000;
  /** Sessão em que estes logins foram enviados (aceitos, a não ser que `recusado`). */
  const com = (momentos: number[], recusado = false) => {
    const sessao = sessaoVazia();
    for (const t of momentos) {
      registrarLoginEnviado(sessao, t, DEZ_MIN);
      sessao.falhouEm = null;
    }
    if (recusado) sessao.falhouEm = momentos[momentos.length - 1];
    return sessao;
  };
  const espera = (momentos: number[], recusado = false) => esperaParaLoginAutomatico(com(momentos, recusado), DEZ_MIN, agora);
  const perto = (valor: number, esperado: number) => assert.ok(Math.abs(valor - esperado) <= 2, `${valor} ms não é ${esperado} ms`);

  // Nunca entrou, ou entrou uma vez há pouco: pode entrar agora (uma queda isolada da sessão não cega o app).
  assert.equal(espera([]), 0);
  assert.equal(espera([agora - 30_000]), 0);
  // Dois logins em seguida: o terceiro espera a ficha voltar (10 min depois do primeiro dos dois).
  perto(espera([agora - 1_000, agora - 500]), DEZ_MIN - 1_000);
  perto(espera([agora - 2 * min, agora - min]), 8 * min);
  // Três em seguida (o terceiro pedido por uma pessoa, sem freio): a espera nunca passa de 10 min depois do último.
  perto(espera([agora - 3 * min, agora - 2 * min, agora - min]), 9 * min);
  assert.ok(espera([agora - 5, agora - 4, agora - 3, agora - 2, agora - 1]) <= DEZ_MIN);
  // Portal que encerra a sessão a cada 10 min: um login a cada 10 min, sempre permitido.
  assert.equal(espera([agora - 30 * min, agora - 20 * min, agora - 10 * min]), 0);

  // Caso ruim — a sessão cai a cada minuto, o dia inteiro: dois logins em
  // seguida e depois UM a cada 10 min (nunca um por minuto, nunca parado).
  const simulada = sessaoVazia();
  const enviados: number[] = [];
  for (let t = agora; t < agora + 24 * 60 * min; t += min) {
    if (esperaParaLoginAutomatico(simulada, DEZ_MIN, t) > 0) continue;
    registrarLoginEnviado(simulada, t, DEZ_MIN);
    simulada.falhouEm = null; // o portal aceitou; a sessão cai de novo antes da leitura seguinte
    enviados.push((t - agora) / min);
  }
  assert.deepEqual(enviados.slice(0, 5), [0, 1, 10, 20, 30]);
  assert.equal(enviados.length, 24 * 6 + 1, "um login a cada 10 min, mais o segundo do começo");
  assert.ok(simulada.logins.length <= 12, "a lista de logins guardada não cresce sem limite");

  // Login que NÃO abriu a conta: 10 min de espera, mesmo sendo o único.
  perto(espera([agora - 3 * min], true), 7 * min);
  assert.equal(espera([agora - 11 * min], true), 0);
  // Leitura pedida por uma pessoa (intervalo 0): sem freio.
  assert.equal(esperaParaLoginAutomatico(com([agora - 2, agora - 1], true), 0, agora), 0);
  // Sessão guardada sem o número de fichas (formato antigo): o mais cauteloso.
  perto(esperaParaLoginAutomatico({ ...sessaoVazia(), logins: [agora - min], fichas: Number.NaN }, DEZ_MIN, agora), 9 * min);
});

test("senha recusada: a sessão não é guardada e o login automático seguinte espera o freio", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": cartao("ATIVO") } });
  const sessao = sessaoVazia();
  const errada = { cpf: CPF_FALSO, senha: "senha-que-nao-e-a-certa" };

  const recusada = await lerPortalDoMotorista(errada, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
  assert.equal(recusada.ok, false);
  assert.equal(recusada.loginRecusado, true);
  assert.equal(recusada.fezLogin, true);
  assert.deepEqual(sessao.cookies, {});
  assert.equal(sessao.logins.length, 1, "o login recusado também conta para o freio");

  // Uma senha errada não vira uma tentativa por minuto na conta do motorista.
  const seguinte = await lerPortalDoMotorista(errada, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
  assert.equal(seguinte.ok, false);
  assert.equal(seguinte.loginRecusado, false);
  assert.equal(seguinte.fezLogin, false);
  assert.equal(portal.logins, 1);
  assert.ok((seguinte.tentarEmMs ?? 0) > 9 * 60_000, "depois de um login que não abriu a conta, a espera é de 10 min");
  assert.match(seguinte.diagnostico.join("\n"), /o último login não abriu a conta/);

  // Com a senha certa (leitura pedida pelo motorista) entra na hora — e a espera da recusa acaba.
  const certa = await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: 0 });
  assert.equal(certa.ok, true, certa.diagnostico.join(" | "));
  assert.equal(sessao.falhouEm, null);
});

test("portal fora do ar: a sessão guardada continua guardada e ninguém tenta um login novo", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": cartao("ATIVO") } });
  const sessao = sessaoVazia();
  await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
  const cookies = { ...sessao.cookies };

  portal.foraDoAr = true;
  const fora = await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
  assert.equal(fora.ok, false);
  assert.equal(fora.fezLogin, false);
  assert.equal(fora.tentarEmMs, undefined, "portal fora do ar não é o freio de logins");
  assert.deepEqual(sessao.cookies, cookies, "uma falha do portal não pode jogar a sessão fora");

  portal.foraDoAr = false;
  const antes = portal.pedidos.length;
  const volta = await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
  assert.equal(volta.ok, true, volta.diagnostico.join(" | "));
  assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/status"]);
  assert.equal(portal.logins, 1);
});

test("hora do aviso: as outras abas são lidas na MESMA sessão, sem login", async () => {
  const portal = criarPortalFalso({
    telas: {
      "moto/status": cartao("ESCALADO", ["Navio: NAVIO DE EXEMPLO"]),
      "moto/fila": telaFila("A", "A032", [{ codigo: "A040", tipo: "CARRETA 6 EIXOS" }]),
    },
  });
  const sessao = sessaoVazia();
  await lerPortalDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });

  const antes = portal.pedidos.length;
  const telas = await lerTelasDoMotorista(CRED, [], { buscar: portal.buscar, codigo: "A032", sessao, esperaEntreLoginsMs: DEZ_MIN });
  assert.equal(telas.ok, true, telas.diagnostico.join(" | "));
  assert.equal(telas.fezLogin, false);
  const pedidos = portal.caminhos().slice(antes);
  assert.ok(!pedidos.some((p) => p.startsWith("POST")), "a leitura completa não pode fazer login com a sessão aberta");
  assert.deepEqual([...pedidos].sort(), ["GET moto/", "GET moto/fila", "GET moto/status", "GET moto/ticket"]);
  assert.equal(portal.logins, 1);
  assert.deepEqual(portal.acoes, [], "nenhum botão de ação (sair, dispensa) foi aberto");
});

/* ------------------------------------------------------------ selo na tela */

test("selo do ponto: o Status do portal manda quando diz que o ponto está fora da fila", () => {
  // Mesmo com o número ainda no quadro.
  assert.deepEqual(seloDoPortal({ status: "AGUARDANDO", situacaoPortal: "ESCALADO" }), { texto: "ESCALADO", cor: "ambar" });
  assert.deepEqual(seloDoPortal({ status: "NA VEZ", situacaoPortal: "EM ATENDIMENTO" }), { texto: "EM ATENDIMENTO", cor: "ambar" });
  assert.deepEqual(seloDoPortal({ status: "SAIU", situacaoPortal: "ESCALADO" }), { texto: "ESCALADO", cor: "ambar" });
  assert.deepEqual(seloDoPortal({ status: "AGUARDANDO", situacaoPortal: "EM DISPENSA", emDispensa: true }), { texto: "DISPENSA", cor: "vermelho" });
  assert.deepEqual(seloDoPortal({ status: "SAIU", situacaoPortal: "EM DISPENSA" }), { texto: "DISPENSA", cor: "vermelho" });
  assert.equal(foraDaFilaPeloPortal({ status: "AGUARDANDO", situacaoPortal: "ESCALADO" }), true);
  assert.equal(foraDaFilaPeloPortal({ status: "AGUARDANDO", emDispensa: true }), true);
});

test("selo do ponto: ATIVO no portal deixa o quadro mostrar a posição; fora do quadro, vale o portal", () => {
  assert.equal(seloDoPortal({ status: "AGUARDANDO", situacaoPortal: "ATIVO" }), null);
  assert.equal(seloDoPortal({ status: "NA VEZ", situacaoPortal: "ATIVO" }), null);
  assert.deepEqual(seloDoPortal({ status: "SAIU", situacaoPortal: "ATIVO" }), { texto: "ATIVO", cor: "verde" });
  assert.equal(foraDaFilaPeloPortal({ status: "SAIU", situacaoPortal: "ATIVO" }), false);
  // Sem leitura recente do portal: fica o que o quadro mostra.
  for (const status of ["AGUARDANDO", "NA VEZ", "SAIU"]) {
    assert.equal(seloDoPortal({ status }), null, status);
    assert.equal(seloDoPortal({ status, situacaoPortal: null }), null, status);
    assert.equal(foraDaFilaPeloPortal({ status, situacaoPortal: "" }), false, status);
  }
});

test("sem acesso ao portal o app pede o cadastro; com acesso (ou com o quadro como fonte) não pede nada", () => {
  const semAcesso = chamadaDoAvisoDeSaida("sem_acesso");
  assert.match(semAcesso?.titulo ?? "", /Aviso de saída desligado/);
  assert.match(semAcesso?.texto ?? "", /cadastre o CPF e a senha do portal/);
  const pausado = chamadaDoAvisoDeSaida("pausado");
  assert.match(pausado?.titulo ?? "", /Aviso de saída parado/);
  assert.match(pausado?.texto ?? "", /recusou a sua senha/);
  assert.equal(chamadaDoAvisoDeSaida("portal"), null);
  assert.equal(chamadaDoAvisoDeSaida("quadro"), null);
  assert.equal(chamadaDoAvisoDeSaida(undefined), null);
  assert.equal(chamadaDoAvisoDeSaida(null), null);
});
