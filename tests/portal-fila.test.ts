import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amostraDaTela,
  descreverBotoesDeLivro,
  extrairLinksDeLivro,
  extrairToquesDeLivro,
  interpretarFilaDoPortal,
  linhasDaTela,
  quadrosDoLivro,
  resumoDoLivro,
} from "../src/lib/portal-fila-parse";
import {
  PRAZO_FILA_ENTRE_CICLOS_MS,
  SESSAO_ASSENTADA_PARA_A_FILA_MS,
  lerFilaComSessao,
  lerPortalDoMotorista,
  motivoParaNaoLerAFilaEntreCiclos,
  sessaoVazia,
} from "../src/lib/portal-copadubo";
import {
  FILA_QUE_NAO_SOME,
  FOLGA_DA_FILA_MS,
  INTERVALO_DA_FILA_PADRAO_S,
  LIVRO_PEDIDO_VALE_MS,
  PRAZO_DA_FILA_QUE_SOME_MS,
  REGRAVAR_PEDIDO_A_CADA_MS,
  esperaDaFilaMs,
  intervaloDaFilaMs,
  livrosALer,
  livrosDaFila,
  livrosDosPontosLigados,
  marcarLivrosPedidos,
  motivoDaFilaSumida,
  pedidoHaPouco,
  validadeDaFilaMs,
} from "../src/lib/portal-fila";
import { esperaEntreLeiturasMs } from "../src/lib/portal-situacao";
import {
  BASE_FALSA,
  CPF_FALSO,
  SENHA_FALSA,
  criarPortalFalso,
  quadroFalso,
  telaAtivos,
  telaStatus,
  type BotoesDeLivroFalsos,
  type FilaFalsa,
} from "./portal-fixture";

/**
 * A ABA “FILA” DO PORTAL (a Tela de Ativos) — leitura e conferência.
 *
 * O quadro público foi desligado; a fila do app passou a vir desta tela. Ela
 * decide a posição dos pontos e os avisos de “perto da vez” e “na vez”, então
 * o que não está completo e coerente é RECUSADO — nunca vira fila vazia.
 *
 * Sem rede e sem banco: o portal é de mentira e todos os dados são inventados.
 * A tela imita a que o dono do app enviou: abas de livro, o aviso do ponto da
 * conta, um cartão por quadro com “ÚLTIMO PONTO ESCALADO”, a tabela SEQ / PONTO
 * / TIPO e o “Total”. O HTML de verdade nunca foi visto, por isso a tabela é
 * testada em três formas.
 */

process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
const CRED = { cpf: CPF_FALSO, senha: SENHA_FALSA };

/** A fila da tela enviada: Truck com 5 (último A196), Carreta com 55 (último A025). */
const CARRETAS = [
  26, 28, 29, 30, 32, 33, 34, 36, 41, 43, 44, 45, 49, 52, 53, 54, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 69, 70, 71, 74, 75, 76, 77, 78,
  80, 83, 84, 85, 86, 88, 89, 90, 91, 92, 93, 95, 97, 98, 100, 101, 103, 137, 177,
];
const TRUCKS = [199, 9, 132, 172, 185];
const filaDaTela = (extra: Partial<FilaFalsa> = {}): FilaFalsa => ({
  livros: { A: { truck: quadroFalso("A", 196, TRUCKS, "TRUCK BA 2E"), carreta: quadroFalso("A", 25, CARRETAS) } },
  ...extra,
});
const livroA = (html: string) => quadrosDoLivro(interpretarFilaDoPortal(html), "A");
const motivoDe = (html: string) => {
  const r = livroA(html);
  return "motivo" in r ? r.motivo : null;
};

test("a tela enviada pelo dono do app é lida inteira, nas três formas de tabela", () => {
  assert.equal(CARRETAS.length, 55);
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    const lido = livroA(telaAtivos(filaDaTela({ forma }), "A"));
    assert.ok(!("motivo" in lido), `${forma}: ${"motivo" in lido ? lido.motivo : ""}`);
    assert.equal(lido.truck.ultimo, 196, forma);
    assert.deepEqual(lido.truck.codigos, TRUCKS, forma);
    assert.equal(lido.truck.total, 5, forma);
    assert.equal(lido.cavalo.ultimo, 25, forma);
    assert.deepEqual(lido.cavalo.codigos, CARRETAS, forma);
    assert.equal(lido.cavalo.total, 55, forma);
    assert.equal(resumoDoLivro("A", lido), "Truck 5 na fila (último A196) · Carreta 55 na fila (último A025)");
  }
});

test("as abas “Livro A · Livro B · Livro M” e o aviso do ponto da conta não viram quadro", () => {
  const html = telaAtivos(filaDaTela(), "A");
  const fila = interpretarFilaDoPortal(html);
  assert.deepEqual(fila.quadros.map((q) => q.titulo), ["Livro A - Truck", "Livro A - Carreta"]);
  assert.deepEqual(fila.recusados, []);
  assert.ok(linhasDaTela(html).some((l) => /Seu ponto \(A777\) não está na fila/.test(l)), "a tela de mentira traz o aviso do ponto da conta");
  // O ponto citado no aviso não entra em fila nenhuma.
  assert.ok(!fila.quadros.some((q) => q.codigos.includes(777)), "o ponto do aviso não entra em fila nenhuma");
  assert.deepEqual(fila.foraDosQuadros, []);
});

test("rótulos e código em formatos vizinhos: “Último ponto escalado: A196”, células de tabela, minúsculas", () => {
  const corpo = (ultimo: string) => `<html><body><h2>Livro A - Truck</h2>${ultimo}
    <table><tr><th>Seq</th><th>Ponto</th><th>Tipo</th></tr><tr><td>1</td><td>A199</td><td>TRUCK BA 2E</td></tr></table><p>Total: 1</p>
    <h2>Livro A - Carreta</h2><p>Último ponto escalado</p><p>A025</p><table><tr><td>1</td><td>A026</td><td>CAVALO TRUCADO</td></tr></table><p>Total: 1</p></body></html>`;
  for (const ultimo of [
    "<p>Último ponto escalado: A196</p>",
    "<p>ÚLTIMO PONTO ESCALADO <b>A196</b></p>",
    "<table><tr><td>Último Ponto Escalado</td><td>A196</td></tr></table>",
    "<div>último ponto escalado</div><div>A196 · TRUCK 4 EIXOS</div>",
  ]) {
    const lido = livroA(corpo(ultimo));
    assert.ok(!("motivo" in lido), ultimo);
    assert.equal(lido.truck.ultimo, 196, ultimo);
    assert.deepEqual(lido.truck.codigos, [199]);
  }
});

test("“Total” escrito em duas linhas, ou sem dois-pontos, vale do mesmo jeito", () => {
  const html = `<html><body><h2>Livro A - Truck</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A196</div>
    <div>1</div><div>A199</div><div>TRUCK BA 2E</div><div>2</div><div>A009</div><div>TRUCK 4 EIXOS</div><div>Total:</div><div>2</div>
    <h2>Livro A - Carreta</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A025</div><div>1 A026 CAVALO TRUCADO</div><div>Total 1 ponto</div></body></html>`;
  const lido = livroA(html);
  assert.ok(!("motivo" in lido), JSON.stringify(lido));
  assert.equal(lido.truck.total, 2);
  assert.deepEqual(lido.truck.codigos, [199, 9]);
  assert.equal(lido.cavalo.total, 1);
});

test("fila vazia só vale com a tela inteira: “Total: 0” ou a página até o fim", () => {
  const vazia = filaDaTela();
  vazia.livros.A!.truck = quadroFalso("A", 115, []);
  const lido = livroA(telaAtivos(vazia, "A"));
  assert.ok(!("motivo" in lido), JSON.stringify(lido));
  assert.deepEqual(lido.truck.codigos, []);
  assert.equal(lido.truck.total, 0);
  assert.equal(lido.truck.ultimo, 115);
  assert.equal(lido.cavalo.codigos.length, 55);

  // Sem o “Total”, com a página completa: ainda dá para confiar.
  const semTotal = livroA(telaAtivos({ ...vazia, semTotal: true }, "A"));
  assert.ok(!("motivo" in semTotal), JSON.stringify(semTotal));
  assert.equal(semTotal.truck.total, null);
});

test("o que não está completo e coerente é recusado — com o motivo", () => {
  const base = telaAtivos(filaDaTela(), "A");

  // Sequência que pula: uma linha sumiu no meio.
  assert.match(motivoDe(base.replace("<tr><td>3</td><td>A029</td><td>CAVALO TRUCADO</td></tr>", "")) ?? "", /Livro A - Carreta: a sequência pula de 2 para 4/);
  // Sequência que não começa em 1.
  assert.match(motivoDe(base.replace("<tr><td>1</td><td>A199</td><td>TRUCK BA 2E</td></tr>", "")) ?? "", /Livro A - Truck: a sequência começa em 2/);
  // O Total da tela não bate com as linhas.
  assert.match(motivoDe(base.replace("Total: 55", "Total: 56")) ?? "", /a tela diz Total: 56, mas trouxe 55 linha/);
  // Ponto de outro livro no meio da fila.
  assert.match(motivoDe(base.replace("<td>A030</td>", "<td>B030</td>")) ?? "", /ponto de outro livro \(B030\)/);
  // O mesmo ponto duas vezes.
  assert.match(motivoDe(base.replace("<td>A030</td>", "<td>A029</td>")) ?? "", /o mesmo ponto aparece duas vezes/);
  // Último escalado de outro livro.
  assert.match(motivoDe(base.replace("<strong>A025</strong>", "<strong>M025</strong>")) ?? "", /o último escalado \(M025\) é de outro livro/);
  // Nenhum quadro do livro pedido.
  assert.match(motivoDe("<html><body><h1>Tela de Ativos</h1><p>Em manutenção.</p></body></html>") ?? "", /não trouxe os quadros do Livro A/);
  // O mesmo quadro duas vezes na página.
  const dobrado = base.replace("<h2>Livro A - Carreta</h2>", "<h2>Livro A - Truck</h2>");
  assert.match(motivoDe(dobrado) ?? "", /aparece mais de uma vez/);
});

test("quadro que não aparece na tela: fila vazia só com a página inteira e nenhum ponto fora das tabelas", () => {
  // O portal pode não desenhar o cartão de uma fila sem pontos. Com a página
  // até o fim e o outro quadro do livro lido, o que falta está vazio.
  const semTruck = livroA(telaAtivos(filaDaTela({ semCartao: "truck" }), "A"));
  assert.ok(!("motivo" in semTruck), JSON.stringify(semTruck));
  assert.deepEqual(semTruck.truck.codigos, []);
  assert.equal(semTruck.truck.ausente, true);
  assert.equal(semTruck.truck.ultimo, 0);
  assert.deepEqual(semTruck.cavalo.codigos, CARRETAS);
  assert.equal(semTruck.cavalo.ausente, undefined);
  assert.equal(resumoDoLivro("A", semTruck), "Truck 0 na fila (o quadro não apareceu na tela) · Carreta 55 na fila (último A025)");

  const semCarreta = livroA(telaAtivos(filaDaTela({ semCartao: "carreta" }), "A"));
  assert.ok(!("motivo" in semCarreta), JSON.stringify(semCarreta));
  assert.equal(semCarreta.cavalo.ausente, true);
  assert.deepEqual(semCarreta.truck.codigos, TRUCKS);

  // Página que não chegou ao fim: o quadro pode só não ter chegado.
  const inteira = telaAtivos(filaDaTela(), "A");
  const cortadaEntreOsCartoes = inteira.slice(0, inteira.indexOf("<h2>Livro A - Carreta</h2>"));
  assert.match(motivoDe(cortadaEntreOsCartoes) ?? "", /não trouxe o quadro “Livro A - Carreta” e a página veio cortada/);

  // Pontos escritos fora de qualquer tabela: pode ser um quadro que a leitura não reconheceu.
  const comOutroQuadro = telaAtivos(filaDaTela({ semCartao: "carreta" }), "A").replace(
    "<nav",
    "<section><h2>Fila das carretas do Livro A</h2><ul><li>A026</li><li>A028</li></ul></section><nav",
  );
  assert.match(motivoDe(comOutroQuadro) ?? "", /não trouxe o quadro “Livro A - Carreta”, mas mostra pontos fora das tabelas \(A026, A028\)/);

  // O aviso “Seu ponto (…)” é da conta de quem abriu a tela: não atrapalha.
  const comAviso = interpretarFilaDoPortal(telaAtivos(filaDaTela({ semCartao: "truck", pontoDaConta: "A132" }), "A"));
  assert.deepEqual(comAviso.foraDosQuadros, []);
  assert.equal(comAviso.completa, true);

  // Nenhum dos dois quadros: não dá para saber nem de que livro é a página.
  const nenhum = filaDaTela();
  delete nenhum.livros.A;
  assert.match(motivoDe(telaAtivos(nenhum, "A")) ?? "", /não trouxe os quadros do Livro A/);
});

test("tabela em formato que a leitura não entende nunca vira fila vazia nem fila mais curta", () => {
  const pagina = (truck: string, carreta: string) => `<html><body><h1>Tela de Ativos</h1>
    <section><h2>Livro A - Truck</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A196</div>${truck}</section>
    <section><h2>Livro A - Carreta</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A025</div>${carreta}</section></body></html>`;
  const carretaBoa = "<table><tr><td>1</td><td>A026</td><td>CAVALO TRUCADO</td></tr></table><p>Total: 1</p>";

  // Lista sem SEQ e sem Total: nenhuma linha reconhecida — mas os pontos estão lá.
  const lista = pagina("<ul><li>A199 — TRUCK BA 2E</li><li>A009 — TRUCK 4 EIXOS</li></ul>", carretaBoa);
  assert.match(motivoDe(lista) ?? "", /Livro A - Truck: a tela mostra 2 pontos fora da tabela \(A199, A009\): não reconheci todas as linhas/);

  // Só a última linha veio em outro formato, e não há Total para conferir.
  const ultimaDiferente = pagina("<table><tr><td>1</td><td>A199</td><td>TRUCK BA 2E</td></tr></table><p>Próximo a entrar: A009</p>", carretaBoa);
  assert.match(motivoDe(ultimaDiferente) ?? "", /Livro A - Truck: a tela mostra um ponto fora da tabela \(A009\)/);

  // Quadro na tela, sem ponto nenhum e sem Total, com a página inteira: aí sim é fila vazia.
  const vazio = livroA(pagina("<p>Nenhum ponto na fila.</p>", carretaBoa));
  assert.ok(!("motivo" in vazio), JSON.stringify(vazio));
  assert.deepEqual(vazio.truck.codigos, []);
  assert.equal(vazio.truck.ultimo, 196);
  assert.equal(vazio.truck.ausente, undefined);

  // Depois do “Total”, o que a página escreve (rodapé, menu da conta) não é mais do quadro.
  const comMenuDaConta = livroA(pagina("<table><tr><td>1</td><td>A199</td><td>TRUCK BA 2E</td></tr></table><p>Total: 1</p>", `${carretaBoa}<div class="modal"><p>Trocar para:</p><button>A777</button><button>B171</button></div>`));
  assert.ok(!("motivo" in comMenuDaConta), JSON.stringify(comMenuDaConta));
  assert.deepEqual(comMenuDaConta.cavalo.codigos, [26]);
});

test("ponto citado fora da tabela que JÁ é linha da fila não derruba a leitura", () => {
  const pagina = (antes: string, truck: string, carreta: string, depois = "") => `<html><body><header>${antes}</header><h1>Tela de Ativos</h1>
    <section><h2>Livro A - Truck</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A196</div>${truck}</section>
    <section><h2>Livro A - Carreta</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A025</div>${carreta}</section>${depois}</body></html>`;
  const tabela = (...codigos: string[]) =>
    `<table>${codigos.map((c, i) => `<tr><td>${i + 1}</td><td>${c}</td><td>CAVALO TRUCADO</td></tr>`).join("")}</table>`;

  // A conta de quem abriu a tela ESTÁ na fila: o portal diz a posição dela dentro do cartão.
  const comPosicao = livroA(pagina("", `<p>Sua posição: 2º — A009</p>${tabela("A199", "A009")}<p>Total: 2</p>`, `${tabela("A026")}<p>Total: 1</p>`));
  assert.ok(!("motivo" in comPosicao), JSON.stringify(comPosicao));
  assert.deepEqual(comPosicao.truck.codigos, [199, 9]);

  // A mesma fila escrita duas vezes (tabela + cartões para a tela pequena), sem “Total”.
  const repetida = livroA(pagina("", `${tabela("A199", "A009")}<ul class="cartoes"><li>A199 — TRUCK BA 2E</li><li>A009 — TRUCK 4 EIXOS</li></ul>`, tabela("A026")));
  assert.ok(!("motivo" in repetida), JSON.stringify(repetida));
  assert.deepEqual(repetida.truck.codigos, [199, 9]);
  // …mas se os cartões trazem um ponto que a tabela não tem, a leitura não vale.
  const comUmAMais = pagina("", `${tabela("A199", "A009")}<ul class="cartoes"><li>A199</li><li>A009</li><li>A132</li></ul>`, tabela("A026"));
  assert.match(motivoDe(comUmAMais) ?? "", /Livro A - Truck: a tela mostra um ponto fora da tabela \(A132\)/);

  // Cartão do Truck fora da tela + o ponto da conta escrito no topo: o topo não é “quadro perdido”
  // quando o aviso “Seu ponto (…)” diz de quem é o código, ou quando ele é linha da outra fila.
  const soCarreta = (antes: string, aviso: string) =>
    `<html><body><header>${antes}</header><h1>Tela de Ativos</h1>${aviso}<section><h2>Livro A - Carreta</h2><div>ÚLTIMO PONTO ESCALADO</div><div>A025</div>${tabela("A026", "A028")}<p>Total: 2</p></section></body></html>`;
  const daConta = livroA(soCarreta("<span>MOTORISTA DE TESTE · A777</span>", "<p>Seu ponto (A777) não está na fila deste livro no momento.</p>"));
  assert.ok(!("motivo" in daConta), JSON.stringify(daConta));
  assert.equal(daConta.truck.ausente, true);
  const naFila = livroA(soCarreta("<span>MOTORISTA DE TESTE · A028</span>", ""));
  assert.ok(!("motivo" in naFila), JSON.stringify(naFila));
  assert.equal(naFila.truck.ausente, true);
  // Um código no topo que não é da conta nem de fila nenhuma: aí o quadro que falta pode estar perdido.
  assert.match(motivoDe(soCarreta("<span>A132</span>", "")) ?? "", /não trouxe o quadro “Livro A - Truck”, mas mostra pontos fora das tabelas \(A132\)/);
});

test("linha da tabela com enfeite — “1º”, “#2”, selo depois do ponto — continua sendo linha", () => {
  const html = `<html><body><h2>Livro A - Truck</h2><p>ÚLTIMO PONTO ESCALADO</p><p>A196</p>
    <table><tr><td>1º</td><td>A199</td><td>TRUCK BA 2E</td></tr><tr class="meu"><td>2º</td><td>A009 <span class="selo">seu ponto</span></td><td>TRUCK 4 EIXOS</td></tr>
    <tr><td>3º</td><td><a href="/moto/fila?ponto=A132">A132</a></td><td>TRUCK BA 2E</td><td>há 2 h</td></tr></table><p>Total: 3</p>
    <h2>Livro A - Carreta</h2><p>ÚLTIMO PONTO ESCALADO</p><p>A025</p>
    <div>#1 A026 CAVALO TRUCADO</div><div>#2 A028 (você) CAVALO 2 EIXOS</div><div>3.</div><div>A029 · CAVALO TRUCADO</div><p>Total: 3</p></body></html>`;
  const lido = livroA(html);
  assert.ok(!("motivo" in lido), JSON.stringify(lido));
  assert.deepEqual(lido.truck.codigos, [199, 9, 132]);
  assert.deepEqual(lido.cavalo.codigos, [26, 28, 29]);
  // Um número colado em outro não é ponto: “A1990” não vira A199.
  assert.match(motivoDe(html.replace("<td>A199</td>", "<td>A1990</td>")) ?? "", /Livro A - Truck: a sequência começa em 2/);
});

test("fila grande não fica vazia de uma leitura para a outra: a leitura não é aceita (por até 10 min)", () => {
  const agora = Date.parse("2026-11-11T12:00:00Z");
  const haMinutos = (min: number) => new Date(agora - min * 60_000);
  const guardada = (truck: number[], carreta: number[], min: number) => ({
    dados: { TRUCK: { ultimo: 196, codigos: truck }, CAVALO: { ultimo: 25, codigos: carreta } },
    lidoEm: haMinutos(min),
  });
  const lido = (extra: Partial<FilaFalsa>, truck = TRUCKS, carreta = CARRETAS) => {
    const fila = filaDaTela(extra);
    fila.livros.A = { truck: quadroFalso("A", 196, truck, "TRUCK BA 2E"), carreta: quadroFalso("A", 25, carreta) };
    const r = livroA(telaAtivos(fila, "A"));
    assert.ok(!("motivo" in r), JSON.stringify(r));
    return r;
  };

  // 55 carretas há um minuto; agora o cartão sumiu da tela — ou veio com “Total: 0”.
  assert.match(
    motivoDaFilaSumida(guardada(TRUCKS, CARRETAS, 1), lido({ semCartao: "carreta" }), agora) ?? "",
    /^o quadro Carreta tinha 55 pontos há 1 min e agora veio fora da tela: leitura não aceita/,
  );
  assert.match(motivoDaFilaSumida(guardada(TRUCKS, CARRETAS, 4), lido({}, TRUCKS, []), agora) ?? "", /^o quadro Carreta tinha 55 pontos há 4 min e agora veio vazio/);

  // Fila pequena esvazia de verdade: 5 trucks escalados e o quadro fica sem ninguém.
  assert.equal(motivoDaFilaSumida(guardada(TRUCKS, CARRETAS, 1), lido({ semCartao: "truck" }), agora), null);
  assert.equal(motivoDaFilaSumida(guardada(TRUCKS, CARRETAS, 1), lido({}, [], CARRETAS), agora), null);
  // O limite: até 8 pontos podem sair de uma leitura para a outra; 9, não.
  const nove = Array.from({ length: FILA_QUE_NAO_SOME + 1 }, (_, i) => 10 + i);
  assert.equal(motivoDaFilaSumida(guardada(nove.slice(1), CARRETAS, 1), lido({}, [], CARRETAS), agora), null);
  assert.match(motivoDaFilaSumida(guardada(nove, CARRETAS, 1), lido({}, [], CARRETAS), agora) ?? "", /^o quadro Truck tinha 9 pontos/);
  // Fila que só diminuiu (mesmo muito) é aceita: a regra é só para o “vazio”.
  assert.equal(motivoDaFilaSumida(guardada(TRUCKS, CARRETAS, 1), lido({}, TRUCKS, [177]), agora), null);

  // Leitura anterior velha (mais de 10 min), ou nenhuma: vale o que a tela mostra.
  assert.equal(PRAZO_DA_FILA_QUE_SOME_MS, 10 * 60_000);
  assert.equal(motivoDaFilaSumida(guardada(TRUCKS, CARRETAS, 11), lido({ semCartao: "carreta" }), agora), null);
  assert.equal(motivoDaFilaSumida(null, lido({ semCartao: "carreta" }), agora), null);
  assert.equal(motivoDaFilaSumida({ dados: null, lidoEm: null }, lido({ semCartao: "carreta" }), agora), null);
});

test("página cortada no meio nunca vira uma fila mais curta", () => {
  for (const forma of ["tabela", "linhas", "celulas"] as const) {
    // Com o “Total” na tela, o da Carreta não chega: sem ele e sem o fim da página, recusa.
    assert.match(motivoDe(telaAtivos(filaDaTela({ forma, cortada: true }), "A")) ?? "", /Livro A - Carreta: a página veio cortada/, forma);
    // Sem “Total” nenhum, só o fim da página garante que a tabela está inteira.
    assert.match(motivoDe(telaAtivos(filaDaTela({ forma, cortada: true, semTotal: true }), "A")) ?? "", /a página veio cortada/, forma);
  }
});

test("links das abas de livro: só navegação do próprio portal", () => {
  const html = telaAtivos(filaDaTela(), "A");
  assert.deepEqual(
    extrairLinksDeLivro(html, `${BASE_FALSA}/moto/fila`).map((l) => `${l.livro} ${new URL(l.url).pathname}${new URL(l.url).search}`),
    ["A /moto/fila?livro=A", "B /moto/fila?livro=B", "M /moto/fila?livro=M"],
  );
  const suspeitos = `<a href="javascript:trocar('B')">Livro B</a><a href="#b">Livro B</a><a href="/moto/sair?livro=B">Livro B</a>
    <a href="/moto/fila/excluir?livro=M">Livro M</a><a href="/moto/fila?livro=A" data-method="post">Livro A</a><a href="/moto/fila?l=B">Ver o Livro B</a>`;
  assert.deepEqual(extrairLinksDeLivro(suspeitos, `${BASE_FALSA}/moto/fila`), []);
});

test("a amostra da tela (diagnóstico) é curta e esconde sequências longas de dígitos", () => {
  const amostra = amostraDaTela("<html><body><p>Documento 12345678901</p><p>Linha comum</p></body></html>");
  assert.deepEqual(amostra, ["Documento …", "Linha comum"]);
  assert.ok(amostraDaTela(telaAtivos(filaDaTela(), "A")).length <= 8, "a amostra tem no máximo 8 linhas");
});

/* ------------------------------------------------------------------ a leitura */

const CARTAO = { codigo: "A032", situacao: "ATIVO", linhas: ["Ativado hoje, 19:50"], botao: "Entrar na dispensa" };

/** Entra uma vez (login + Status): a sessão fica com os cookies e o endereço da aba “Fila”. */
async function sessaoAberta(portal: ReturnType<typeof criarPortalFalso>) {
  const sessao = sessaoVazia();
  const leitura = await lerPortalDoMotorista(CRED, null, { buscar: portal.buscar, codigo: "A032", codigos: ["A032"], sessao });
  assert.equal(leitura.ok, true, leitura.diagnostico.join(" | "));
  return sessao;
}

test("a leitura do Status guarda o endereço da aba “Fila” que o menu informa", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: filaDaTela() });
  const sessao = await sessaoAberta(portal);
  assert.equal(sessao.filaUrl, `${BASE_FALSA}/moto/fila`);
  // A olhada do Status não abriu a aba Fila: ela é lida à parte, uma vez por ciclo.
  assert.ok(!portal.caminhos().includes("GET moto/fila"), portal.caminhos().join(", "));
});

test("com a sessão guardada, a fila é UM pedido — sem login e sem abrir ação nenhuma", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: filaDaTela() });
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;
  const logins = portal.logins;

  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
  assert.equal(lida.abriu, true);
  assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/fila"]);
  assert.equal(lida.pedidos, 1);
  assert.equal(portal.logins, logins, "a leitura da fila nunca faz login");
  assert.deepEqual(portal.acoes, []);
  assert.deepEqual(portal.foraDoSite, []);
  assert.deepEqual(lida.falhas, {});
  assert.deepEqual(lida.livros.A?.truck.codigos, TRUCKS);
  assert.deepEqual(lida.livros.A?.cavalo.codigos, CARRETAS);
  assert.deepEqual(lida.diagnostico, ["Fila do Livro A (moto/fila): Truck 5 na fila (último A196) · Carreta 55 na fila (último A025)."]);
});

test("a tela abre em outro livro: a leitura segue o link “Livro A” da própria tela", async () => {
  const fila = filaDaTela({ padrao: "B" });
  fila.livros.B = { truck: quadroFalso("B", 164, [3, 7]), carreta: quadroFalso("B", 34, [40, 41, 42]) };
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila });
  const sessao = await sessaoAberta(portal);
  const antes = portal.pedidos.length;

  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
  assert.deepEqual(portal.pedidos.slice(antes).map((p) => `${p.metodo} ${p.caminho}`), ["GET moto/fila", "GET moto/fila?livro=A"]);
  assert.deepEqual(lida.livros.A?.cavalo.codigos, CARRETAS);
  // A fila do Livro B, que estava na tela, nunca é confundida com a do Livro A.
  assert.ok(!lida.livros.A?.cavalo.codigos.includes(40), "o B040 não entra na fila do Livro A");
  assert.match(lida.diagnostico.join(" "), /Fila do Livro A \(moto\/fila\?livro=A\): Truck 5/);

  // Pedindo os dois livros: um vem da tela, o outro do link.
  const antes2 = portal.pedidos.length;
  const duas = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A", "B"] });
  assert.deepEqual(portal.pedidos.slice(antes2).map((p) => `${p.metodo} ${p.caminho}`), ["GET moto/fila", "GET moto/fila?livro=A"]);
  assert.deepEqual(duas.livros.B?.truck.codigos, [3, 7]);
  assert.deepEqual(duas.livros.B?.cavalo.codigos, [40, 41, 42]);
  assert.deepEqual(duas.livros.A?.truck.codigos, TRUCKS);
  assert.deepEqual(portal.acoes, []);
});

/* ------------------------------------------------ os botões “Livro A · B · M” */

/** Os três livros com fila, e o mesmo número (32) na Carreta de cada um — o exemplo do dono do app: A32, B32, M32. */
const tresLivros = (extra: Partial<FilaFalsa> = {}): FilaFalsa => ({
  livros: {
    A: { truck: quadroFalso("A", 196, TRUCKS, "TRUCK BA 2E"), carreta: quadroFalso("A", 25, CARRETAS) },
    B: { truck: quadroFalso("B", 164, [3, 7, 12], "TRUCK 4 EIXOS"), carreta: quadroFalso("B", 20, [30, 32, 40]) },
    M: { truck: quadroFalso("M", 107, [9], "TRUCK 4 EIXOS"), carreta: quadroFalso("M", 17, [11, 15, 32]) },
  },
  ...extra,
});
const PAGINA_DA_FILA = `${BASE_FALSA}/moto/fila`;
const comoTexto = (html: string) =>
  extrairToquesDeLivro(html, PAGINA_DA_FILA).map(
    (t) => `${t.livro} ${t.metodo} ${new URL(t.url).pathname}${new URL(t.url).search}${t.corpo !== undefined ? ` [${t.corpo}]` : ""} (${t.forma})`,
  );
const cadaLivro = (modelo: string) => ["A", "B", "M"].map((l) => modelo.replaceAll("#", l));

test("o toque no botão do livro, em cada forma de botão: o pedido que o navegador faria", () => {
  const toques = (botoes: BotoesDeLivroFalsos, codigo?: string) => comoTexto(telaAtivos(tresLivros({ botoes }), "A", codigo));
  assert.deepEqual(toques("links"), cadaLivro("# GET /moto/fila?livro=# (link)"));
  assert.deepEqual(toques("links-relativos"), cadaLivro("# GET /moto/fila?livro=# (link)"));
  assert.deepEqual(toques("onclick"), cadaLivro("# GET /moto/fila?livro=# (botão com endereço)"));
  assert.deepEqual(toques("data-href"), cadaLivro("# GET /moto/fila?livro=# (botão com endereço)"));
  assert.deepEqual(toques("form-get"), cadaLivro("# GET /moto/fila?livro=# (formulário GET)"));
  assert.deepEqual(toques("form-get", "cod1"), cadaLivro("# GET /moto/fila?_token=cod1&livro=# (formulário GET)"));
  // <input type="submit">: o que vai no pedido é o texto do botão.
  assert.deepEqual(toques("input-submit"), cadaLivro("# GET /moto/fila?livro=Livro+# (formulário GET)"));
  assert.deepEqual(toques("form-post"), cadaLivro("# POST /moto/fila [livro=#] (formulário POST)"));
  assert.deepEqual(toques("form-post", "cod1"), cadaLivro("# POST /moto/fila [livro=#&_token=cod1] (formulário POST)"));
  assert.deepEqual(toques("form-post-unico"), cadaLivro("# POST /moto/fila [livro=#] (formulário POST)"));
  assert.deepEqual(toques("form-post-unico", "cod1"), cadaLivro("# POST /moto/fila [_token=cod1&livro=#] (formulário POST)"));
  // Botão que só um script saberia usar: nenhum toque — e o diagnóstico diz o que a tela tem.
  const soScript = telaAtivos(tresLivros({ botoes: "script" }), "A");
  assert.deepEqual(comoTexto(soScript), []);
  assert.deepEqual(descreverBotoesDeLivro(soScript), cadaLivro('Livro #: <button type="button" data-livro="#">'));
});

test("o toque no botão do livro: endereços relativos, `formaction`, e o link ganha do formulário", () => {
  // Como o navegador: num formulário GET os campos ENTRAM NO LUGAR dos parâmetros que o endereço já tinha.
  assert.deepEqual(
    comoTexto(`<form action="fila.php?aba=1"><input type="hidden" name="v" value="2"><button name="l" value="B">Livro B</button></form>`),
    ["B GET /moto/fila.php?v=2&l=B (formulário GET)"],
  );
  // Num POST o endereço fica como está, e sem `action` o formulário vai para a própria página.
  assert.deepEqual(comoTexto(`<form method="POST"><button name="l" value="M"> Livro  M </button></form>`), ["M POST /moto/fila [l=M] (formulário POST)"]);
  assert.deepEqual(
    comoTexto(`<form method="get" action="/moto/x"><button formaction="/moto/fila_b.php" formmethod="post" name="l" value="B">Livro B</button></form>`),
    ["B POST /moto/fila_b.php [l=B] (formulário POST)"],
  );
  // Um formulário por livro, cada um com o seu endereço e sem campo nenhum.
  assert.deepEqual(
    comoTexto(`<form action="/moto/fila_a.php"><button>Livro A</button></form><form action="/moto/fila_b.php"><button>Livro B</button></form>`),
    ["A GET /moto/fila_a.php (formulário GET)", "B GET /moto/fila_b.php (formulário GET)"],
  );
  assert.deepEqual(comoTexto(`<a href="#" onclick="window.location = 'fila.php?livro=B'; return false;">Livro B</a>`), ["B GET /moto/fila.php?livro=B (botão com endereço)"]);
  assert.deepEqual(comoTexto(`<div class="pilula" onclick="location.assign(&quot;?livro=M&quot;)"><span>Livro M</span></div>`), ["M GET /moto/fila?livro=M (botão com endereço)"]);
  assert.deepEqual(comoTexto(`<input type="button" value="Livro B" data-url="/moto/fila?livro=B">`), ["B GET /moto/fila?livro=B (botão com endereço)"]);
  // Botões dentro de uma caixa da mesma tag: cada um com os SEUS atributos.
  assert.deepEqual(
    comoTexto(`<div class="livros"><div data-href="?livro=A">Livro A</div><div data-href="?livro=B">Livro B</div></div>`),
    ["A GET /moto/fila?livro=A (botão com endereço)", "B GET /moto/fila?livro=B (botão com endereço)"],
  );
  // O mesmo livro em mais de uma forma: link, depois botão com endereço, depois formulário GET, depois POST.
  const variasFormas = `<form method="post" action="/moto/p"><button name="l" value="B">Livro B</button></form>
    <form method="get" action="/moto/g"><button name="l" value="B">Livro B</button></form>
    <button data-href="/moto/d?l=B">Livro B</button>`;
  assert.deepEqual(comoTexto(`${variasFormas}<a href="/moto/fila?livro=B">Livro B</a>`), ["B GET /moto/fila?livro=B (link)"]);
  assert.deepEqual(comoTexto(variasFormas), ["B GET /moto/d?l=B (botão com endereço)"]);
  assert.deepEqual(comoTexto(variasFormas.split("\n").slice(0, 2).join("\n")), ["B GET /moto/g?l=B (formulário GET)"]);
});

test("botão de livro que não é só uma troca de tela nunca é tocado", () => {
  const nenhum = (html: string, porque: string) => assert.deepEqual(comoTexto(html), [], porque);
  const botao = `<button name="livro" value="B">Livro B</button>`;
  nenhum(`<form method="post" action="/moto/sair.php">${botao}</form>`, "o formulário vai para um endereço de saída");
  nenhum(`<form method="post" action="/moto/fila/excluir">${botao}</form>`, "o formulário vai para um endereço de ação");
  nenhum(`<form method="post" action="/moto/fila"><input type="hidden" name="acao" value="excluir">${botao}</form>`, "campo escondido que nomeia uma ação");
  nenhum(`<form method="post" action="/moto/fila"><input type="text" name="obs">${botao}</form>`, "formulário com algo para digitar");
  nenhum(`<form method="post" action="/moto/fila"><input type="checkbox" name="todos">${botao}</form>`, "formulário com algo para marcar");
  nenhum(`<form method="post" action="/moto/fila"><select name="x"><option>1</option></select>${botao}</form>`, "formulário com lista");
  nenhum(`<form method="post" action="/moto/fila"><textarea name="t"></textarea>${botao}</form>`, "formulário com texto longo");
  nenhum(`<form method="post" action="/moto/fila"><p>Entrar na dispensa</p>${botao}</form>`, "formulário que fala de dispensa");
  nenhum(`<form method="post" action="/moto/fila"><button name="livro" value="B">Livro B - trocar</button></form>`, "o texto não é só o nome do livro");
  nenhum(`<form method="dialog" action="/moto/fila">${botao}</form>`, "método que não é GET nem POST");
  nenhum(`<form method="get" action="/moto/fila"><button name="acao" value="B">Livro B</button></form>`, "o pedido montado tem cara de ação");
  nenhum(`<form method="post" action="/moto/fila"><button>Livro A</button><button>Livro B</button><button>Livro M</button></form>`, "três botões que dariam o mesmo pedido");
  nenhum(`<form method="post" action="/moto/fila"><button type="button" name="livro" value="B">Livro B</button></form>`, "botão que não envia o formulário");
  nenhum(`<a href="/moto/fila">Livro A</a><a href="/moto/fila">Livro B</a>`, "dois livros no mesmo endereço");
  nenhum(`<button onclick="trocarLivro('B')">Livro B</button>`, "onclick sem endereço");
  nenhum(`<button onclick="location.href='/moto/sair'">Livro B</button>`, "onclick para um endereço de saída");
  nenhum(`<button data-href="javascript:trocar('B')">Livro B</button>`, "endereço que não é de página");
  nenhum(`<button data-href="#livro-b">Livro B</button>`, "âncora da própria página");
  nenhum(`<button data-href="ftp://portal.example/fila?livro=B">Livro B</button>`, "protocolo que não é http");
  nenhum(`<button data-href="/moto/fila?livro=B">Ver o Livro B</button>`, "o texto não é só o nome do livro (botão com endereço)");
  // O que é de fora do portal a função devolve — quem recusa é o leitor (ver a leitura, abaixo).
  assert.deepEqual(extrairToquesDeLivro(`<a href="https://outro-site.example/fila?livro=B">Livro B</a>`, PAGINA_DA_FILA).length, 1);
});

test("diagnóstico dos botões de livro: a tag e os atributos, sem o conteúdo da tela", () => {
  const html = `<h1>Tela de Ativos</h1>
    <form method="post" action="/moto/fila.php?x=1"><input type="hidden" name="_token" value="segredo123456789">
      <button class="pilula ativa" id="a" style="color:red" type="button" role="tab" aria-selected="true" onclick="abrir('A')">Livro A</button>
      <input type="submit" name="livro" value="Livro B"></form>
    <li data-livro="M" title="Livro M">Livro M</li>
    <p>Seu ponto (A032) não está na fila deste livro no momento.</p><table><tr><td>1</td><td>A199</td></tr></table>`;
  assert.deepEqual(descreverBotoesDeLivro(html), [
    `Livro A: <button type="button" role="tab" aria-selected onclick="abrir('A')">`,
    `Livro M: <li data-livro="M" title>`,
    `Livro B: <input type="submit" name="livro" value="Livro B">`,
    "formulário POST /moto/fila.php — campos: _token (oculto), livro",
  ]);
  // Nada da fila, nada da conta e nenhum valor de campo escondido.
  assert.doesNotMatch(descreverBotoesDeLivro(html).join(" "), /A032|A199|segredo/);
  assert.deepEqual(descreverBotoesDeLivro("<html><body><p>Sistema em manutenção.</p></body></html>"), []);
  // Mais frouxo que a leitura: um botão com o texto um pouco diferente não é tocado, mas aparece no diagnóstico.
  const comContagem = `<a href="/moto/fila?l=2">Livro B (27)</a><span>Livro M - Carreta</span><p>Livro B é o livro das carretas do interior, com fila própria.</p>`;
  assert.deepEqual(comoTexto(comContagem), []);
  assert.deepEqual(descreverBotoesDeLivro(comContagem), [`Livro B (27): <a href="/moto/fila?l=2">`, "Livro M - Carreta: <span>"]);
  // No máximo quatro controles e dois formulários; números longos saem mascarados; a caixa dos três botões não conta.
  const muitos =
    `<div class="livros">${Array.from({ length: 7 }, (_, i) => `<a href="/x?doc=12345678${i}">Livro A ${i}</a>`).join("")}</div>` +
    "<form><button>Livro M</button></form>".repeat(3);
  assert.deepEqual(descreverBotoesDeLivro(muitos), [
    ...[0, 1, 2, 3].map((i) => `Livro A ${i}: <a href="/x?doc=…">`),
    "formulário GET (a própria página) — campos: nenhum",
    "formulário GET (a própria página) — campos: nenhum",
  ]);
  assert.deepEqual(descreverBotoesDeLivro(`<div><button data-livro="A">Livro A</button><button data-livro="B">Livro B</button></div>`), [
    `Livro A: <button data-livro="A">`,
    `Livro B: <button data-livro="B">`,
  ]);
  // Botões que são caixas dentro de uma caixa da mesma tag: só os de dentro, cada um com os seus atributos.
  assert.deepEqual(descreverBotoesDeLivro(`<div class="livros" data-grupo="x"><div data-livro="A">Livro A</div><div data-livro="B">Livro B</div></div>`), [
    `Livro A: <div data-livro="A">`,
    `Livro B: <div data-livro="B">`,
  ]);
});

test("os livros lidos: os de sempre e o de cada ponto cadastrado; PORTAL_FILA_LIVROS_DOS_PONTOS=0 volta ao que era", () => {
  comAmbiente({ PORTAL_FILA_LIVROS: undefined, PORTAL_FILA_LIVROS_DOS_PONTOS: undefined }, () => {
    assert.deepEqual(livrosDaFila(), ["A"]);
    assert.equal(livrosDosPontosLigados(), true);
    assert.deepEqual(livrosALer([]), ["A"], "sem ponto nenhum: o Livro A, que é o que o visitante vê");
    assert.deepEqual(livrosALer(["A"]), ["A"]);
    assert.deepEqual(livrosALer(["B"]), ["A", "B"], "B032 cadastrado: o leitor toca em “Livro B”");
    assert.deepEqual(livrosALer(["M"]), ["A", "M"]);
    assert.deepEqual(livrosALer(["M", "B", "M", "A"]), ["A", "B", "M"], "na ordem dos botões, sem repetir");
    assert.deepEqual(livrosALer(["m", " b "]), ["A", "B", "M"]);
    assert.deepEqual(livrosALer(["X", "", "AB"]), ["A"], "o que não é livro não entra");
  });
  // `PORTAL_FILA_LIVROS` são os livros lidos SEMPRE; os dos pontos entram por cima.
  comAmbiente({ PORTAL_FILA_LIVROS: "M", PORTAL_FILA_LIVROS_DOS_PONTOS: undefined }, () => {
    assert.deepEqual(livrosALer([]), ["M"]);
    assert.deepEqual(livrosALer(["B"]), ["B", "M"]);
  });
  for (const desligado of ["0", "desligado", "OFF", " não ", "nao", "Desligada"]) {
    comAmbiente({ PORTAL_FILA_LIVROS: undefined, PORTAL_FILA_LIVROS_DOS_PONTOS: desligado }, () => {
      assert.equal(livrosDosPontosLigados(), false, desligado);
      assert.deepEqual(livrosALer(["B", "M"]), ["A"], `“${desligado}”: só o Livro A, como era`);
    });
  }
  comAmbiente({ PORTAL_FILA_LIVROS: "A,B", PORTAL_FILA_LIVROS_DOS_PONTOS: "0" }, () => assert.deepEqual(livrosALer(["M"]), ["A", "B"]));
  for (const ligado of ["1", "sim", "", "ligado", "true"]) {
    comAmbiente({ PORTAL_FILA_LIVROS: undefined, PORTAL_FILA_LIVROS_DOS_PONTOS: ligado }, () => {
      assert.equal(livrosDosPontosLigados(), true, ligado);
      assert.deepEqual(livrosALer(["B"]), ["A", "B"], ligado);
    });
  }
});

const FORMAS_DE_BOTAO: BotoesDeLivroFalsos[] = ["links", "links-relativos", "form-get", "input-submit", "form-post", "form-post-unico", "onclick", "data-href"];
for (const botoes of FORMAS_DE_BOTAO) {
  test(`A32, B32 e M32 numa visita, com os botões de livro em “${botoes}”: um pedido por livro, sem login`, async () => {
    const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: tresLivros({ botoes }) });
    const sessao = await sessaoAberta(portal);
    const antes = portal.pedidos.length;
    const logins = portal.logins;

    const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A", "B", "M"] });
    assert.deepEqual(lida.falhas, {});
    assert.deepEqual(lida.livros.A?.truck.codigos, TRUCKS);
    assert.deepEqual(lida.livros.A?.cavalo.codigos, CARRETAS);
    assert.deepEqual([lida.livros.B?.truck.ultimo, lida.livros.B?.truck.codigos], [164, [3, 7, 12]]);
    assert.deepEqual([lida.livros.B?.cavalo.ultimo, lida.livros.B?.cavalo.codigos], [20, [30, 32, 40]]);
    assert.deepEqual([lida.livros.M?.truck.ultimo, lida.livros.M?.truck.codigos], [107, [9]]);
    assert.deepEqual([lida.livros.M?.cavalo.ultimo, lida.livros.M?.cavalo.codigos], [17, [11, 15, 32]]);
    // A aba (que abre no Livro A) e um toque para cada um dos outros dois.
    assert.equal(lida.pedidos, 3);
    const porPost = botoes === "form-post" || botoes === "form-post-unico";
    assert.deepEqual(portal.livrosPedidos, porPost ? ["POST B", "POST M"] : ["GET B", "GET M"]);
    assert.equal(portal.livrosRecusados, 0);
    assert.deepEqual([...new Set(portal.caminhos().slice(antes))].sort(), porPost ? ["GET moto/fila", "POST moto/fila"] : ["GET moto/fila"]);
    assert.equal(portal.logins, logins, "a leitura da fila nunca faz login");
    assert.deepEqual(portal.acoes, []);
    assert.deepEqual(portal.foraDoSite, []);
    assert.match(lida.diagnostico.join(" "), porPost ? /Fila do Livro B \(POST moto\/fila\): Truck 3 na fila \(último B164\)/ : /Fila do Livro B \(moto\/fila\?[^)]*livro=(?:Livro\+)?B\): Truck 3 na fila \(último B164\)/);

    // Só o livro do ponto: quem tem só o M032 faz o leitor tocar só em “Livro M”.
    const antesDoM = portal.livrosPedidos.length;
    const soM = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["M"] });
    assert.deepEqual(Object.keys(soM.livros), ["M"]);
    assert.deepEqual(portal.livrosPedidos.slice(antesDoM).map((x) => x.split(" ")[1]), ["M"]);
    assert.equal(soM.pedidos, 2);
  });
}

test("portal que guarda o livro na sessão e troca o código escondido a cada tela: vale o botão da ÚLTIMA tela aberta", async () => {
  for (const botoes of ["form-post", "form-post-unico", "form-get"] as const) {
    const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: tresLivros({ botoes, lembraOLivro: true, codigoOculto: true }) });
    const sessao = await sessaoAberta(portal);
    const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A", "B", "M"] });
    assert.deepEqual(lida.falhas, {}, botoes);
    assert.equal(portal.livrosRecusados, 0, `${botoes}: o código enviado é o da última tela, não o da primeira`);
    assert.deepEqual(lida.livros.M?.cavalo.codigos, [11, 15, 32], botoes);

    // Na visita seguinte a aba abre no último livro visto (M): os outros dois vêm pelos botões, e nada se mistura.
    const segunda = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A", "B", "M"] });
    assert.deepEqual(segunda.falhas, {}, botoes);
    assert.deepEqual(segunda.livros.A?.truck.codigos, TRUCKS, botoes);
    assert.deepEqual(segunda.livros.B?.cavalo.codigos, [30, 32, 40], botoes);
    assert.deepEqual(segunda.livros.M?.truck.codigos, [9], botoes);
    assert.deepEqual(portal.livrosPedidos.slice(-2).map((x) => x.split(" ")[1]), ["A", "B"], botoes);
    assert.equal(portal.livrosRecusados, 0, botoes);
    assert.deepEqual(portal.acoes, []);
  }
});

test("botão de livro que a leitura não sabe usar: o Livro A vem, o B e o M ficam sem leitura e o diagnóstico diz o que a tela tem", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: tresLivros({ botoes: "script" }) });
  const sessao = await sessaoAberta(portal);
  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A", "B", "M"] });
  assert.deepEqual(lida.livros.A?.truck.codigos, TRUCKS);
  assert.deepEqual(Object.keys(lida.livros), ["A"]);
  assert.match(
    lida.falhas.B ?? "",
    /não trouxe os quadros do Livro B \(Truck e Carreta\), e não achei na tela um botão “Livro B” que eu saiba usar \(a tela tem: Livro A: <button type="button" data-livro="A"> \| Livro B: <button type="button" data-livro="B"> \| Livro M: <button type="button" data-livro="M">\)/,
  );
  assert.match(lida.falhas.M ?? "", /não achei na tela um botão “Livro M” que eu saiba usar/);
  assert.equal(lida.pedidos, 1, "sem botão que sirva, nada mais é pedido");
  assert.deepEqual(portal.livrosPedidos, []);
  // A fila do Livro A, que estava na tela, nunca vira a do B.
  assert.equal(lida.livros.B, undefined);
});

test("botão de livro que aponta para fora do portal não é tocado; toque que não troca a tela não vira fila", async () => {
  // “Livro B” aponta para outro site; “Livro M” abre de novo a mesma tela (a do Livro A).
  const tela = telaAtivos(tresLivros(), "A").replace('href="/moto/fila?livro=B"', 'href="https://outro-site.example/fila?livro=B"');
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]), "moto/fila": tela } });
  const sessao = await sessaoAberta(portal);
  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A", "B", "M"] });
  assert.deepEqual(Object.keys(lida.livros), ["A"]);
  assert.deepEqual(portal.foraDoSite, [], "nada é pedido fora do portal");
  assert.match(lida.falhas.B ?? "", /não achei na tela um botão “Livro B” que eu saiba usar \(a tela tem: .*Livro B: <a href="https:\/\/outro-site\.example\/fila\?livro=B">/);
  assert.match(lida.falhas.M ?? "", /toquei em “Livro M” \(link, moto\/fila\?livro=M\) e a tela não trouxe os quadros do Livro M/);
  assert.equal(lida.pedidos, 2, "a aba e o toque em “Livro M”");
  // O diagnóstico mostra o que veio depois do toque: a tela continuou no Livro A (sem o aviso “Seu ponto…”, que é da conta).
  const depois = lida.diagnostico.find((l) => l.startsWith("Tela depois do toque em “Livro M”")) ?? "";
  assert.match(depois, /primeiras linhas: Portal - Fila \| Tela de Ativos \| Livro A Livro B Livro M \| Livro A - Truck \| ÚLTIMO PONTO ESCALADO A196 \|/);
  assert.doesNotMatch(depois, /Seu ponto|A777/);
  assert.equal(lida.diagnostico.filter((l) => l.startsWith("Tela depois do toque")).length, 1, "só do livro em que o toque não trocou a tela");

  // É a tela que veio DEPOIS do toque — não a primeira. Aqui o botão troca a tela, mas o Livro M não tem quadro nenhum.
  const semM = tresLivros();
  delete semM.livros.M;
  const outroPortal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: semM });
  const outraLida = await lerFilaComSessao(await sessaoAberta(outroPortal), { buscar: outroPortal.buscar, livros: ["A", "B", "M"] });
  assert.deepEqual(Object.keys(outraLida.livros), ["A", "B"]);
  assert.match(outraLida.falhas.M ?? "", /toquei em “Livro M” \(link, moto\/fila\?livro=M\) e a tela não trouxe os quadros do Livro M/);
  const depoisDoM = outraLida.diagnostico.find((l) => l.startsWith("Tela depois do toque em “Livro M”")) ?? "";
  assert.match(depoisDoM, /primeiras linhas: Portal - Fila \| Tela de Ativos \| Livro A Livro B Livro M \| Nenhum ponto ativo neste livro\./);
  assert.doesNotMatch(depoisDoM, /A196|B164|Livro [AB] - /, "nada da primeira tela (Livro A) nem da do toque anterior (Livro B)");
});

test("o portal pede o login de novo no meio da visita: o livro que faltava fica sem leitura, sem login e sem perder o que já veio", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: tresLivros() });
  const sessao = await sessaoAberta(portal);
  const logins = portal.logins;
  // O portal encerra a sessão logo depois de entregar a primeira tela.
  const buscar = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const resposta = await portal.buscar(entrada, init);
    if (String(entrada).endsWith("/moto/fila")) portal.sessoes.clear();
    return resposta;
  }) as typeof fetch;
  const lida = await lerFilaComSessao(sessao, { buscar, livros: ["A", "B"] });
  assert.deepEqual(lida.livros.A?.truck.codigos, TRUCKS);
  assert.match(lida.falhas.B ?? "", /botão “Livro B” \(moto\/fila\?livro=B\): o portal pediu o login de novo/);
  assert.equal(portal.logins, logins);
});

test("sessão encerrada pelo portal: a fila não é lida e NENHUM login é enviado", async () => {
  // O portal troca o cookie de quem chega com uma sessão encerrada: esse cookie
  // novo (de visitante) não pode ir parar na sessão guardada do motorista.
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: filaDaTela(), trocaCookieDeSessaoEncerrada: true });
  const sessao = await sessaoAberta(portal);
  const cookies = { ...sessao.cookies };
  assert.match(cookies.PHPSESSID ?? "", /^logado\d+$/);
  portal.sessoes.clear();
  const logins = portal.logins;
  const antes = portal.pedidos.length;

  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
  assert.equal(lida.abriu, false);
  assert.deepEqual(lida.livros, {});
  assert.match(lida.falhas.A ?? "", /pediu o login de novo/);
  assert.equal(portal.logins, logins, "quem entra de novo é a leitura do Status, com o freio de logins");
  // O portal entregou mesmo um cookie novo nesta visita (os pedidos seguintes já foram com ele)…
  assert.ok(
    portal.pedidos.slice(antes).some((p) => /PHPSESSID=visitante\d+/.test(p.cookie)),
    "o portal de mentira trocou o cookie da sessão encerrada",
  );
  // …e a sessão guardada continua como estava.
  assert.deepEqual(sessao.cookies, cookies, "a sessão guardada não é mexida por uma leitura que não abriu");
});

test("sem sessão e sem o endereço guardado: nada é pedido; com sessão, o menu diz onde fica a aba", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: filaDaTela() });
  const vazia = await lerFilaComSessao(sessaoVazia(), { buscar: portal.buscar, livros: ["A"] });
  assert.equal(vazia.abriu, false);
  assert.equal(portal.pedidos.length, 0);
  assert.match(vazia.falhas.A ?? "", /sem sessão aberta/);

  const sessao = await sessaoAberta(portal);
  sessao.filaUrl = null;
  const antes = portal.pedidos.length;
  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
  assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/status", "GET moto/fila"]);
  assert.equal(sessao.filaUrl, `${BASE_FALSA}/moto/fila`);
  assert.equal(lida.livros.A?.truck.codigos.length, 5);
});

test("endereço guardado que não é navegação do portal nunca é aberto", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: filaDaTela() });
  const sessao = await sessaoAberta(portal);
  for (const ruim of ["https://outro.exemplo.test/moto/fila", `${BASE_FALSA}/logout.php`, `${BASE_FALSA}/moto/dispensa/alternar?ponto=A032`]) {
    sessao.filaUrl = ruim;
    const antes = portal.pedidos.length;
    const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
    // O endereço ruim é ignorado: a aba é procurada de novo no menu.
    assert.deepEqual(portal.caminhos().slice(antes), ["GET moto/status", "GET moto/fila"], ruim);
    assert.equal(lida.livros.A?.cavalo.codigos.length, 55);
  }
  assert.deepEqual(portal.acoes, []);
  assert.deepEqual(portal.foraDoSite, []);
});

test("aba que não existe mais (404): o endereço é esquecido e a próxima leitura procura no menu", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) } });
  const sessao = await sessaoAberta(portal);
  sessao.filaUrl = `${BASE_FALSA}/moto/fila`;
  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
  assert.equal(lida.abriu, false);
  assert.match(lida.falhas.A ?? "", /não existe neste endereço \(404\)/);
  assert.equal(sessao.filaUrl, null);
});

test("tela que não é a esperada: nenhuma fila, e o diagnóstico mostra o que veio", async () => {
  const portal = criarPortalFalso({
    telas: {
      "moto/status": telaStatus([CARTAO]),
      "moto/fila": "<html><body><h1>Tela de Ativos</h1><p>Sistema em manutenção. Volte mais tarde.</p></body></html>",
    },
  });
  const sessao = await sessaoAberta(portal);
  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
  assert.equal(lida.abriu, true);
  assert.deepEqual(lida.livros, {});
  assert.match(lida.falhas.A ?? "", /não trouxe os quadros do Livro A \(Truck e Carreta\), e não achei na tela um botão “Livro A” que eu saiba usar \(nenhum controle com o texto “Livro …”\)/);
  assert.match(lida.diagnostico.join(" "), /Tela aberta \(moto\/fila\), primeiras linhas: Tela de Ativos \| Sistema em manutenção/);
});

test("fila recusada na leitura: o livro fica sem leitura e o motivo aparece", async () => {
  const fila = filaDaTela({ cortada: true });
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila });
  const sessao = await sessaoAberta(portal);
  const lida = await lerFilaComSessao(sessao, { buscar: portal.buscar, livros: ["A"] });
  assert.deepEqual(lida.livros, {});
  assert.match(lida.falhas.A ?? "", /Livro A - Carreta: a página veio cortada/);
  // Quadro recusado não faz a leitura sair procurando o livro em outra aba.
  assert.equal(lida.pedidos, 1);
});

/* ------------------------------------------- a fila entre as olhadas do Status */

/** Roda `f` com as variáveis do ambiente trocadas e devolve tudo ao lugar. */
function comAmbiente<T>(valores: Record<string, string | undefined>, f: () => T): T {
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(valores)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return f();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("com o app aberto a fila é relida de 20 em 20 s; PORTAL_FILA_INTERVALO_S muda (10 a 60) ou desliga", () => {
  const limpo = { PORTAL_FILA_INTERVALO_S: undefined, PORTAL_INTERVALO_MIN: undefined };
  comAmbiente(limpo, () => {
    assert.equal(INTERVALO_DA_FILA_PADRAO_S, 20);
    assert.equal(intervaloDaFilaMs(), 20_000);
    // A reserva fica 2 s abaixo: o pedido do app (um a cada 5 s) nunca cai exatamente em cima da marca.
    assert.equal(FOLGA_DA_FILA_MS, 2_000);
    assert.equal(esperaDaFilaMs(), 18_000);
    // A olhada do Status continua no minuto, e a fila continua valendo por 3 min sem leitura nova.
    assert.equal(esperaEntreLeiturasMs(), 45_000);
    assert.equal(validadeDaFilaMs(), 3 * 60_000);
  });
  for (const [texto, esperado] of [
    ["10", 10_000],
    ["15", 15_000],
    [" 30 ", 30_000],
    ["12.4", 12_000],
    // Fora da faixa ou ilegível: vale o padrão (nunca mais rápido que 10 s por engano).
    ["5", 20_000],
    ["9.9", 20_000],
    ["61", 20_000],
    ["600", 20_000],
    ["-20", 20_000],
    ["rápido", 20_000],
    ["", 20_000],
  ] as const) {
    comAmbiente({ ...limpo, PORTAL_FILA_INTERVALO_S: texto }, () => {
      assert.equal(intervaloDaFilaMs(), esperado, `PORTAL_FILA_INTERVALO_S=“${texto}”`);
      assert.equal(esperaDaFilaMs(), esperado - 2_000);
    });
  }
  // A chave de retorno: só a carona do Status, com a espera de sempre.
  for (const texto of ["0", "desligado", "DESLIGADO", "desligada", "off", "nao", "não"]) {
    comAmbiente({ ...limpo, PORTAL_FILA_INTERVALO_S: texto }, () => {
      assert.equal(intervaloDaFilaMs(), null, `PORTAL_FILA_INTERVALO_S=“${texto}”`);
      assert.equal(esperaDaFilaMs(), 45_000);
    });
  }
  // Intervalo que não é menor que a espera do Status: a carona já lê nesse ritmo.
  comAmbiente({ ...limpo, PORTAL_FILA_INTERVALO_S: "45" }, () => {
    assert.equal(intervaloDaFilaMs(), null);
    assert.equal(esperaDaFilaMs(), 45_000);
  });
  comAmbiente({ ...limpo, PORTAL_FILA_INTERVALO_S: "44" }, () => assert.equal(intervaloDaFilaMs(), 44_000));
  comAmbiente({ ...limpo, PORTAL_FILA_INTERVALO_S: "60" }, () => assert.equal(intervaloDaFilaMs(), null));
  // Com o Status de 5 em 5 minutos, a fila entre ciclos continua no ritmo dela.
  comAmbiente({ PORTAL_FILA_INTERVALO_S: "60", PORTAL_INTERVALO_MIN: "5" }, () => {
    assert.equal(intervaloDaFilaMs(), 60_000);
    assert.equal(esperaDaFilaMs(), 58_000);
  });
  assert.equal(intervaloDaFilaMs(15_000), null, "espera do Status menor que o intervalo: desligada");
});

test("livro pedido: o B e o M só são relidos entre as olhadas enquanto um app aberto com ponto neles pede", async () => {
  const agora = Date.UTC(2026, 10, 12, 2, 30, 0);
  const ha = (ms: number) => ({ pedidoEm: new Date(agora - ms) });
  // O app pergunta de 5 em 5 s e a marca é regravada no máximo de 10 em 10 s: 45 s cobrem várias perguntas perdidas…
  assert.equal(LIVRO_PEDIDO_VALE_MS, 45_000);
  assert.equal(REGRAVAR_PEDIDO_A_CADA_MS, 10_000);
  assert.ok(LIVRO_PEDIDO_VALE_MS >= 3 * (REGRAVAR_PEDIDO_A_CADA_MS + 5_000), "a marca não cai entre duas regravações");
  // …e a marca nunca dura mais que a espera da carona: fechado o app, o livro volta ao minuto logo.
  comAmbiente({ PORTAL_INTERVALO_MIN: undefined }, () => assert.ok(LIVRO_PEDIDO_VALE_MS <= esperaEntreLeiturasMs(), "a marca dura no máximo a espera da carona"));
  assert.equal(pedidoHaPouco({ pedidoEm: null }, agora), false, "nunca pedido");
  assert.equal(pedidoHaPouco(ha(0), agora), true);
  assert.equal(pedidoHaPouco(ha(12_000), agora), true);
  assert.equal(pedidoHaPouco(ha(45_000), agora), true, "até os 45 s, inclusive");
  assert.equal(pedidoHaPouco(ha(45_001), agora), false);
  assert.equal(pedidoHaPouco(ha(10 * 60_000), agora), false, "pedido de dez minutos atrás: ninguém está olhando");
  // Sem banco configurado (como aqui) nada é gravado, nem tentado.
  assert.deepEqual(await marcarLivrosPedidos(["B", "M"], agora), []);
});

test("leitura entre ciclos: a parte de rede muda a sessão que recebe — por isso ela recebe uma CÓPIA", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: filaDaTela() });
  const sessao = await sessaoAberta(portal);
  // Sem o endereço da aba, a parte de rede procura no menu e ANOTA o endereço na sessão que recebeu.
  sessao.filaUrl = null;
  const guardada = JSON.stringify(sessao);
  const copia = structuredClone(sessao);
  const lida = await lerFilaComSessao(copia, { buscar: portal.buscar, livros: ["A"] });
  assert.equal(lida.abriu, true);
  assert.equal(copia.filaUrl, `${BASE_FALSA}/moto/fila`);
  assert.equal(JSON.stringify(sessao), guardada, "a sessão guardada não foi tocada: nada volta para o banco");
});

/* ------------------------------------------- a leitura entre as olhadas do Status */

test("a leitura entre ciclos só usa uma sessão assentada: 30 minutos sem o portal pedir login de novo", () => {
  const agora = 1_800_000_000_000;
  const MIN = 60_000;
  const sessao = (logins: number[], extra: { cookies?: Record<string, string>; filaUrl?: string | null } = {}) => ({
    cookies: { PHPSESSID: "logado1" },
    filaUrl: `${BASE_FALSA}/moto/fila` as string | null,
    logins,
    ...extra,
  });
  const motivo = (...argumentos: Parameters<typeof sessao>) => motivoParaNaoLerAFilaEntreCiclos(sessao(...argumentos), agora);
  assert.equal(SESSAO_ASSENTADA_PARA_A_FILA_MS, 30 * MIN);

  assert.equal(motivo([]), null, "nenhum login na última hora: serve");
  assert.equal(motivo([agora - 59 * MIN]), null);
  assert.equal(motivo([agora - 30 * MIN]), null, "30 minutos exatos: serve");
  assert.match(motivo([agora - 30 * MIN + 1]) ?? "", /^esta conta entrou no portal há 29 min; a leitura entre as olhadas do Status só usa uma sessão aberta há 30 min ou mais$/);
  assert.match(motivo([agora - 12 * MIN - 5_000]) ?? "", /há 12 min;/);
  assert.match(motivo([agora - 20_000]) ?? "", /há menos de 1 min;/);
  // Vale o login MAIS RECENTE, em qualquer ordem da lista.
  assert.match(motivo([agora - 50 * MIN, agora - 5 * MIN]) ?? "", /há 5 min;/);
  assert.match(motivo([agora - 5 * MIN, agora - 50 * MIN]) ?? "", /há 5 min;/);
  assert.equal(motivo([agora - 50 * MIN, agora - 31 * MIN]), null);
  // Sem sessão aberta ou sem o endereço da aba guardado: também não (e nada é pedido para descobrir).
  assert.match(motivo([], { cookies: {} }) ?? "", /^sem sessão aberta no portal nesta conta$/);
  assert.match(motivo([], { filaUrl: null }) ?? "", /^o endereço da aba “Fila” ainda não está guardado nesta conta/);
  assert.match(motivo([], { filaUrl: "" }) ?? "", /^o endereço da aba “Fila” ainda não está guardado nesta conta/);
  assert.match(motivo([agora - 5 * MIN], { cookies: {} }) ?? "", /^sem sessão aberta/);
});

test("a leitura da fila aceita um prazo próprio: com o portal lento, a leitura entre ciclos desiste cedo", async () => {
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([CARTAO]) }, fila: filaDaTela() });
  const sessao = await sessaoAberta(portal);
  /** O portal leva `ms` para responder — e, como o fetch de verdade, o pedido falha se for cancelado antes. */
  const lento =
    (ms: number): typeof fetch =>
    (input, init) =>
      new Promise((resolver, rejeitar) => {
        const espera = setTimeout(() => resolver(portal.buscar(input, init)), ms);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(espera);
          rejeitar(init.signal?.reason ?? new DOMException("cancelado", "AbortError"));
        });
      });
  assert.equal(PRAZO_FILA_ENTRE_CICLOS_MS, 6_000, "o prazo da leitura entre ciclos");

  const antes = portal.pedidos.length;
  const inicio = Date.now();
  const curta = await lerFilaComSessao(structuredClone(sessao), { buscar: lento(1_500), livros: ["A"], prazoMs: 600 });
  const levou = Date.now() - inicio;
  assert.equal(curta.abriu, false);
  assert.deepEqual(curta.livros, {});
  assert.match(curta.falhas.A ?? "", /demorou demais/);
  assert.ok(levou >= 450 && levou < 1_300, `desistiu em ${levou} ms`);
  assert.equal(portal.pedidos.length, antes, "o pedido foi cancelado antes de o portal responder");

  // Sem prazo próprio vale o de sempre (14 s): a mesma demora não atrapalha a carona do Status.
  const normal = await lerFilaComSessao(structuredClone(sessao), { buscar: lento(1_500), livros: ["A"] });
  assert.equal(normal.abriu, true);
  assert.equal(normal.livros.A?.truck.codigos.length, 5);
});
