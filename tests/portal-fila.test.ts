import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amostraDaTela,
  extrairLinksDeLivro,
  interpretarFilaDoPortal,
  linhasDaTela,
  quadrosDoLivro,
  resumoDoLivro,
} from "../src/lib/portal-fila-parse";
import { lerFilaComSessao, lerPortalDoMotorista, sessaoVazia } from "../src/lib/portal-copadubo";
import { FILA_QUE_NAO_SOME, PRAZO_DA_FILA_QUE_SOME_MS, motivoDaFilaSumida } from "../src/lib/portal-fila";
import {
  BASE_FALSA,
  CPF_FALSO,
  SENHA_FALSA,
  criarPortalFalso,
  quadroFalso,
  telaAtivos,
  telaStatus,
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
  assert.match(lida.falhas.A ?? "", /não trouxe os quadros do Livro A \(Truck e Carreta\), e a tela não tem um link “Livro A”/);
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
