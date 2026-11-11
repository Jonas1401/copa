import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extrairEscolhaDePonto,
  extrairSecoes,
  hashEstavel,
  interpretarStatus,
  montarCorpoEscolha,
  todasAsLinhas,
} from "../src/lib/portal-copadubo-parse";
import { extrairStatusEAtivos, lerPortalDoMotorista, lerTelasDoMotorista, mostraSituacao, sessaoVazia } from "../src/lib/portal-copadubo";
import {
  BASE_FALSA,
  CPF_FALSO,
  MENU_FALSO,
  SENHA_FALSA,
  criarPortalFalso,
  paginaLogin,
  telaStatusDeUmPonto,
  telaTrocarPonto,
  type CartaoFalso,
  type EscolhaFalsa,
} from "./portal-fixture";

/**
 * O PORTAL MOSTRA UM PONTO POR VEZ.
 *
 * No site real, a conta do motorista pode ter vários pontos. Em “Trocar Ponto”
 * ele escolhe um na lista e toca em “Confirmar”; só então “Status do Ponto”
 * mostra o cartão daquele ponto. O leitor faz o mesmo caminho — e é a única
 * coisa que ele envia além do login: o formulário de dispensa, que mora na
 * mesma tela de Status, nunca é tocado.
 *
 * Nada sai da máquina; pessoas, CPFs, placas e escalas são inventados.
 */
process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
const CRED = { cpf: CPF_FALSO, senha: SENHA_FALSA };

const cartoes = (): CartaoFalso[] => [
  { codigo: "A006", situacao: "ATIVO", linhas: ["Ativado hoje, 07:10 <b>há 9 h 2 min</b>"], botao: "Entrar na dispensa" },
  { codigo: "A032", situacao: "ATIVO", linhas: ["Ativado hoje, 19:50 <b>há 2 h 27 min</b>"], botao: "Entrar na dispensa" },
  { codigo: "A063", situacao: "ATIVO", linhas: ["Ativado hoje, 18:05 <b>há 4 h 12 min</b>"], botao: "Entrar na dispensa" },
  {
    codigo: "B171",
    situacao: "EM DISPENSA",
    linhas: ["Em dispensa desde hoje, 20:00 <b>há 9 min</b>", "MOTIVO", "001 - OFICINA"],
    botao: "Sair da dispensa",
  },
];

test("trocar ponto: o formulário de escolha é reconhecido; um formulário de ação, nunca", () => {
  const e = extrairEscolhaDePonto(telaTrocarPonto({ cartoes: cartoes() }));
  assert.ok(e);
  assert.equal(e.method, "post");
  assert.equal(e.action, "trocar_ponto.php");
  assert.equal(e.campo, "id_ponto");
  // O valor enviado é o que o formulário diz (aqui, um número), não o código.
  assert.deepEqual(e.opcoes, [
    { valor: "101", codigo: "A006" },
    { valor: "102", codigo: "A032" },
    { valor: "103", codigo: "A063" },
    { valor: "104", codigo: "B171" },
  ]);
  assert.equal(montarCorpoEscolha(e, "102"), "id_ponto=102");

  // Campo escondido e botão com nome vão junto, como num navegador.
  const completo = extrairEscolhaDePonto(
    telaTrocarPonto({ cartoes: cartoes() }, "tk1x").replace('<button type="submit" class="btn">', '<button type="submit" class="btn" name="confirmar" value="1">'),
  );
  assert.ok(completo);
  assert.equal(montarCorpoEscolha(completo, "102"), "_token=tk1x&id_ponto=102&confirmar=1");
  // “Escolha o Ponto...” com valor 0 não atrapalha.
  assert.equal(extrairEscolhaDePonto(telaTrocarPonto({ cartoes: cartoes(), vazioComZero: true }))?.opcoes.length, 4);

  // A tela de Status traz o formulário de DISPENSA (lista de motivos): não é escolha de ponto.
  assert.equal(extrairEscolhaDePonto(telaStatusDeUmPonto(cartoes()[1])), null);
  assert.equal(extrairEscolhaDePonto(paginaLogin()), null);

  // Formulário com uma lista de pontos, mas que é uma AÇÃO: fora.
  const base = telaTrocarPonto({ cartoes: cartoes() });
  const rotulo = '<label for="ponto">PONTO</label>';
  const botao = '<button type="submit" class="btn">Confirmar</button>';
  const ruins = [
    base.replace('action="trocar_ponto.php"', 'action="dispensa/entrar.php"'),
    base.replace('action="trocar_ponto.php"', 'action="/logout.php"'),
    base.replace(rotulo, '<label for="ponto">Ponto que vai para a dispensa</label>'),
    base.replace(rotulo, `${rotulo}<input type="hidden" name="acao" value="entrar_dispensa">`),
    base.replace(rotulo, `${rotulo}<input type="text" name="observacao">`),
    base.replace(rotulo, `${rotulo}<input type="checkbox" name="confirmo" value="1">`),
    base.replace(rotulo, `${rotulo}<textarea name="obs"></textarea>`),
    base.replace(rotulo, `${rotulo}<select name="motivo"><option value="1">001 - OFICINA</option></select>`),
    base.replace(botao, '<button type="submit" class="btn">Excluir ponto</button>'),
  ];
  for (const [i, html] of ruins.entries()) {
    assert.notEqual(html, base, `variação ${i} não mudou a página`);
    assert.equal(extrairEscolhaDePonto(html), null, `variação ${i}`);
  }
  // Lista que não é de pontos (motivos de dispensa) nunca é uma escolha de ponto.
  assert.equal(
    extrairEscolhaDePonto('<form method="post" action="x.php"><select name="m"><option value="1">001 - OFICINA</option><option value="2">002 - DESCANSO</option></select></form>'),
    null,
  );
});

test("trocar ponto: as opções das listas não viram texto da página", () => {
  const troca = extrairSecoes(telaTrocarPonto({ cartoes: cartoes() })).secoes;
  assert.ok(!todasAsLinhas(troca).some((l) => /A0(06|32|63)|B171/.test(l)), "a lista de pontos não é um cartão");
  assert.equal(interpretarStatus(troca, "A032"), null);

  const status = extrairSecoes(telaStatusDeUmPonto(cartoes()[1])).secoes;
  assert.ok(!todasAsLinhas(status).some((l) => /OFICINA|DESCANSO|Selecione/.test(l)), "os motivos do formulário de dispensa não são dados do ponto");
});

test("status de um ponto: cartão como o do site e nada do formulário de dispensa", () => {
  const ativo = interpretarStatus(extrairSecoes(telaStatusDeUmPonto(cartoes()[1])).secoes, "A032");
  assert.equal(ativo?.codigo, "A032");
  assert.equal(ativo?.turno, "ATIVO");
  assert.equal(ativo?.cartao, "ABC-1D23");
  assert.equal(ativo?.haMinutos, 147, "“há 2 h 27 min”");
  assert.equal(ativo?.motivo, null, "ponto ATIVO não tem motivo de dispensa");
  // O cartão acaba no botão de dispensa: “Motivo”, “Cancelar”, “Confirmar” e o rodapé ficam de fora.
  assert.deepEqual(ativo?.detalhes, ["Ativado hoje, 19:50 há 2 h 27 min", "FULANO DE TAL EXEMPLO"]);

  const dispensa = interpretarStatus(extrairSecoes(telaStatusDeUmPonto(cartoes()[3])).secoes, "B171");
  assert.equal(dispensa?.turno, "EM DISPENSA");
  assert.equal(dispensa?.motivo, "001 - OFICINA");
  assert.equal(dispensa?.haMinutos, 9);

  // Só horas, e horas por extenso.
  const com = (linha: string) => interpretarStatus(extrairSecoes(telaStatusDeUmPonto({ codigo: "A032", situacao: "ATIVO", linhas: [linha] })).secoes, "A032");
  assert.equal(com("Ativado hoje, 16:00 há 3 h")?.haMinutos, 180);
  assert.equal(com("Ativado ontem, 21:00 há 1 hora e 5 min")?.haMinutos, 65);
  assert.equal(com("Ativado hoje, 19:50")?.haMinutos, null);

  // O contador de tempo anda sozinho: não é novidade na leitura.
  const outro = { ...cartoes()[1], linhas: ["Ativado hoje, 19:50 <b>há 2 h 28 min</b>"] };
  assert.equal(
    hashEstavel(extrairSecoes(telaStatusDeUmPonto(cartoes()[1])).secoes),
    hashEstavel(extrairSecoes(telaStatusDeUmPonto(outro)).secoes),
  );

  // A pergunta por OUTRO ponto não é respondida com este cartão.
  const secoes = extrairSecoes(telaStatusDeUmPonto(cartoes()[1])).secoes;
  assert.equal(mostraSituacao(secoes, "A032"), true);
  assert.equal(mostraSituacao(secoes, "A063"), false);
});

test("leitura: depois do login o leitor escolhe o ponto em “Trocar Ponto” e lê o Status dele", async () => {
  const portal = criarPortalFalso({ escolha: { cartoes: cartoes() } });
  const sessao = sessaoVazia();
  const ler = () => lerPortalDoMotorista(CRED, null, { buscar: portal.buscar, codigo: "A032", codigos: ["A032"], sessao });

  const r = await ler();
  assert.equal(r.ok, true);
  assert.equal(mostraSituacao(r.secoes, "A032"), true);
  assert.equal(interpretarStatus(r.secoes, "A032")?.turno, "ATIVO");
  assert.deepEqual(portal.trocas, ["A032"], "uma escolha: a do ponto monitorado");
  assert.equal(portal.logins, 1);
  const diagnostico = r.diagnostico.join("\n");
  assert.match(diagnostico, /Ponto A032 escolhido em “Trocar Ponto” \(POST moto\/trocar_ponto\.php; a lista tem 4 ponto\(s\)\)\./);
  assert.match(diagnostico, /Situação do ponto A032: ATIVO\./);
  // O pedido da escolha leva só o campo da lista, com o valor que o formulário dá ao A032.
  const envios = portal.pedidos.filter((p) => p.metodo === "POST" && !p.caminho.startsWith("seguranca/"));
  assert.deepEqual(envios.map((p) => `${p.caminho} ${p.corpo}`), ["moto/trocar_ponto.php id_ponto=102"]);

  // Minuto seguinte, com a sessão guardada: UM pedido, sem login e sem escolher de novo.
  let antes = portal.pedidos.length;
  const r2 = await ler();
  assert.equal(mostraSituacao(r2.secoes, "A032"), true);
  assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/status"]);
  assert.equal(portal.logins, 1);
  assert.deepEqual(portal.trocas, ["A032"]);

  // O ponto é escalado: a leitura seguinte traz a situação e as linhas do cartão — e só elas.
  portal.escolha!.cartoes[1] = {
    codigo: "A032",
    situacao: "ESCALADO",
    linhas: ["Escalado hoje, 22:40 <b>há 1 min</b>", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO"],
    botao: "Entrar na dispensa",
  };
  antes = portal.pedidos.length;
  const r3 = await ler();
  const escalado = interpretarStatus(r3.secoes, "A032");
  assert.equal(escalado?.turno, "ESCALADO");
  // (a palavra da situação sai da linha: ela já está no título do aviso)
  assert.deepEqual(escalado?.detalhes, ["hoje, 22:40 há 1 min", "Navio: NAVIO DE EXEMPLO", "Terminal: TERMINAL DE EXEMPLO", "FULANO DE TAL EXEMPLO"]);
  assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/status"]);

  // Em nenhum momento um endereço de ação foi aberto, e nada saiu do portal.
  assert.deepEqual(portal.acoes, []);
  assert.deepEqual(portal.foraDoSite, []);
  assert.ok(!JSON.stringify([r.diagnostico, r2.diagnostico, r3.diagnostico]).includes(SENHA_FALSA));
});

test("leitura: motorista com dois pontos — cada um é escolhido e lido, e o cartão de um nunca vale pelo outro", async () => {
  const portal = criarPortalFalso({ escolha: { cartoes: cartoes() } });
  const sessao = sessaoVazia();
  const opcoes = { buscar: portal.buscar, codigo: "A032", codigos: ["A032", "B171"], sessao };

  const r = await lerPortalDoMotorista(CRED, null, opcoes);
  assert.deepEqual(portal.trocas, ["A032", "B171"]);
  assert.equal(interpretarStatus(r.secoes, "A032")?.turno, "ATIVO");
  const b = interpretarStatus(r.secoes, "B171");
  assert.equal(b?.codigo, "B171");
  assert.equal(b?.turno, "EM DISPENSA");
  assert.equal(b?.motivo, "001 - OFICINA");
  assert.equal(interpretarStatus(r.secoes, "A032")?.motivo, null, "o motivo é do B171, não do A032");
  assert.match(r.diagnostico.join("\n"), /Situação do ponto A032: ATIVO\.\nSituação do ponto B171: EM DISPENSA\./);

  // Minuto seguinte: a sessão ficou no B171; o leitor volta ao A032 (uma escolha) e tem os dois.
  const antes = portal.pedidos.length;
  const r2 = await lerPortalDoMotorista(CRED, null, opcoes);
  assert.deepEqual(portal.trocas, ["A032", "B171", "A032"]);
  assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/status", "GET moto/", "POST moto/trocar_ponto.php", "GET moto/status"]);
  assert.equal(mostraSituacao(r2.secoes, "A032"), true);
  assert.equal(mostraSituacao(r2.secoes, "B171"), true);
  assert.equal(portal.logins, 1);

  // Leitura completa (a da hora do aviso): com as telas dos dois pontos, cada código acha o SEU cartão.
  const telas = await lerTelasDoMotorista(CRED, [], opcoes);
  assert.equal(extrairStatusEAtivos(telas.telas, "A032").status?.codigo, "A032");
  assert.equal(extrairStatusEAtivos(telas.telas, "A032").status?.turno, "ATIVO");
  assert.equal(extrairStatusEAtivos(telas.telas, "B171").status?.codigo, "B171");
  assert.equal(extrairStatusEAtivos(telas.telas, "B171").status?.turno, "EM DISPENSA");
  assert.deepEqual(portal.acoes, []);
});

test("leitura: ponto fora da lista da conta não é escolhido — e a tela de outro ponto não conta", async () => {
  const portal = criarPortalFalso({ escolha: { cartoes: cartoes() } });
  const sessao = sessaoVazia();
  await lerPortalDoMotorista(CRED, null, { buscar: portal.buscar, codigos: ["A063"], sessao });
  assert.deepEqual(portal.trocas, ["A063"]);

  // A sessão está no A063; o ponto pedido agora (A999) não é desta conta.
  const r = await lerPortalDoMotorista(CRED, null, { buscar: portal.buscar, codigo: "A999", codigos: ["A999"], sessao });
  assert.deepEqual(portal.trocas, ["A063"], "nenhuma escolha a mais");
  assert.equal(mostraSituacao(r.secoes, "A999"), false);
  assert.match(r.diagnostico.join("\n"), /A lista de pontos desta conta no portal não tem o A999 \(tem: A006, A032, A063, B171\)\./);
  assert.deepEqual(portal.acoes, []);
});

test("leitura: variações do formulário de escolha", async () => {
  const variacoes: Partial<EscolhaFalsa>[] = [
    { comCodigoOculto: true },
    { metodo: "GET", campo: "ponto", acao: "definir_ponto.php" },
    { aposEscolha: "ponto" },
    { vazioComZero: true },
  ];
  for (const variacao of variacoes) {
    const nome = JSON.stringify(variacao);
    const portal = criarPortalFalso({ escolha: { cartoes: cartoes(), ...variacao } });
    const r = await lerPortalDoMotorista(CRED, null, { buscar: portal.buscar, codigo: "A032", codigos: ["A032", "A063"], sessao: sessaoVazia() });
    assert.deepEqual(portal.trocas, ["A032", "A063"], nome);
    assert.equal(portal.trocasRecusadas, 0, nome);
    assert.equal(mostraSituacao(r.secoes, "A032"), true, nome);
    assert.equal(mostraSituacao(r.secoes, "A063"), true, nome);
    assert.deepEqual(portal.acoes, [], nome);
    assert.deepEqual(portal.foraDoSite, [], nome);
  }
});

test("leitura: sem a tela de escolha, o diagnóstico mostra a estrutura dos formulários — nunca os valores", async () => {
  // Portal em que o Status mostra outro ponto e a tela “Ponto” não tem a lista.
  const portal = criarPortalFalso({
    telas: {
      "moto/": `<html><body><a href="/moto/">Ponto</a><a href="/moto/status">Status</a><h1>Meu ponto</h1>
<form method="POST" action="perfil.php"><input type="hidden" name="segredo" value="valor-que-nao-pode-aparecer"><input type="text" name="apelido" value="outro-valor"><button>Salvar</button></form></body></html>`,
      "moto/status": telaStatusDeUmPonto(cartoes()[2]),
    },
  });
  const r = await lerPortalDoMotorista(CRED, null, { buscar: portal.buscar, codigo: "A032", codigos: ["A032"], sessao: sessaoVazia() });
  const diagnostico = r.diagnostico.join("\n");
  assert.equal(mostraSituacao(r.secoes, "A032"), false);
  assert.match(diagnostico, /Não achei no portal a tela de escolha do ponto/);
  assert.match(diagnostico, /Formulário em moto\/: POST perfil\.php — campos: segredo \(oculto\), apelido\./);
  assert.ok(!diagnostico.includes("valor-que-nao-pode-aparecer") && !diagnostico.includes("outro-valor"));
  assert.deepEqual(portal.acoes, []);
  assert.equal(portal.pedidos.filter((p) => p.metodo === "POST" && !p.caminho.startsWith("seguranca/")).length, 0, "nenhum formulário foi enviado");
});

test("leitura: a aba “Trocar Ponto” é aberta mesmo com um endereço que o leitor comum não abriria", async () => {
  // No menu, “Trocar Ponto” aponta para alterar_ponto.php (“alterar” tem cara de ação) e não há lista em /moto/.
  const menu = '<nav><a href="/moto/alterar_ponto.php">Trocar Ponto</a><a href="/moto/status">Status</a><a href="/logout.php">Sair</a></nav>';
  const statusDo = (i: number) => telaStatusDeUmPonto(cartoes()[i]).replace(MENU_FALSO, menu);
  const portal = criarPortalFalso({
    telas: {
      "moto/": `<html><body>${menu}<h1>Início</h1><p>Bem-vindo ao portal.</p></body></html>`,
      "moto/status": statusDo(2), // a sessão está no A063
      "moto/alterar_ponto.php": telaTrocarPonto({ cartoes: cartoes(), acao: "alterar_ponto.php" }).replace(MENU_FALSO, menu),
    },
  });
  const envios: string[] = [];
  const buscar = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof entrada === "string" || entrada instanceof URL ? String(entrada) : entrada.url);
    if ((init?.method ?? "GET").toUpperCase() === "POST" && url.pathname === "/moto/alterar_ponto.php") {
      envios.push(String(init?.body ?? ""));
      portal.telas["moto/status"] = statusDo(1); // escolhido: A032
      return new Response(null, { status: 302, headers: { location: "/moto/status" } });
    }
    return portal.buscar(entrada, init);
  }) as typeof fetch;

  const r = await lerPortalDoMotorista(CRED, null, { buscar, codigo: "A032", codigos: ["A032"], sessao: sessaoVazia() });
  assert.equal(mostraSituacao(r.secoes, "A032"), true, r.diagnostico.join("\n"));
  assert.deepEqual(envios, ["id_ponto=102"]);
  assert.match(r.diagnostico.join("\n"), /Ponto A032 escolhido em “Trocar Ponto” \(POST moto\/alterar_ponto\.php/);
  assert.deepEqual(portal.acoes, [], "“Sair” continua sem ser aberto");

  // Mas uma aba “Ponto” que aponta para uma dispensa não é aberta nem para procurar a lista.
  const menuRuim = '<nav><a href="/moto/dispensa/ponto.php">Ponto</a><a href="/moto/status">Status</a></nav>';
  const outro = criarPortalFalso({
    telas: {
      "moto/": `<html><body>${menuRuim}<h1>Início</h1><p>Bem-vindo ao portal.</p></body></html>`,
      "moto/status": telaStatusDeUmPonto(cartoes()[2]).replace(MENU_FALSO, menuRuim),
    },
  });
  const r2 = await lerPortalDoMotorista(CRED, null, { buscar: outro.buscar, codigo: "A032", codigos: ["A032"], sessao: sessaoVazia() });
  assert.equal(mostraSituacao(r2.secoes, "A032"), false);
  assert.deepEqual(outro.acoes, []);
});
