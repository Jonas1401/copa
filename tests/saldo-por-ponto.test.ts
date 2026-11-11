import assert from "node:assert/strict";
import { test } from "node:test";
import { brl, calcular } from "../src/lib/frete";
import { prazoDoTicketMs } from "../src/lib/portal-copadubo";
import { MAX_PONTOS_POR_LEITURA, contaDasViagens, contaDoPonto, emCentavos, porcentagensDoPedido, saldoDosPontos } from "../src/lib/portal-ticket";

/**
 * SALDO DE GANHOS COM MAIS DE UM PONTO — as regras da conta e do cadastro.
 *
 * Cada ponto do motorista tem a SUA porcentagem; o saldo é um só e soma todos
 * os pontos; toda leitura consulta todos os pontos do app. Aqui só as contas
 * (sem rede e sem banco); o caminho inteiro, com o banco, está em
 * `tests/portal-ticket-cron.test.ts`. Pontos, pesos e valores inventados.
 */

/** Três viagens do A777 e uma do B702 (as mesmas do teste do cron). */
const DO_A777 = [
  { quant: 29.92, valor: 17.29 },
  { quant: 32.14, valor: 17.29 },
  { quant: 30, valor: 21.12 },
];
const DO_B702 = [{ quant: 29.92, valor: 17.29 }];
const naCalculadora = (viagens: { quant: number; valor: number }[], porcentagem: number) =>
  calcular({ ponto: "", cargas: viagens.map((v, i) => ({ id: String(i), quant: v.quant, valor: v.valor, subtotal: v.quant * v.valor, linha: "", confianca: "alta" as const })) }, porcentagem);

test("os centavos são os que a tela escreve (o mesmo arredondamento do dinheiro do app)", () => {
  for (const valor of [0, 0.004, 0.005, 1.005, 2.675, 10.075, 0.285, 517.3168, 1706.6174, 315.724219, 103.46336, 2223.9342, 99999.995]) {
    assert.equal(brl(emCentavos(valor) / 100), brl(valor), `${valor}`);
    assert.ok(Number.isInteger(emCentavos(valor)), `${valor} não virou centavos inteiros`);
  }
  assert.equal(emCentavos(1.005), 101);
  assert.equal(emCentavos(10.075), 1008);
  assert.equal(emCentavos(1706.6174), 170662);
  assert.equal(emCentavos(Number.NaN), 0);
  assert.equal(emCentavos(Number.POSITIVE_INFINITY), 0);
});

test("a conta de UM ponto é a da calculadora de frete, com a porcentagem dele", () => {
  const conta = contaDoPonto(DO_A777, 18.5);
  const calc = naCalculadora(DO_A777, 18.5);
  assert.equal(conta.viagens, 3);
  assert.equal(conta.bruto, 1706.62);
  assert.equal(conta.comissao, 315.72);
  assert.ok(Math.abs(conta.toneladas - 92.06) < 1e-9);
  // O que aparece na tela é o que a calculadora mostra para o mesmo ticket.
  assert.equal(brl(conta.bruto), brl(calc.bruto));
  assert.equal(brl(conta.comissao ?? Number.NaN), brl(calc.ganho));
  // Outra porcentagem, outra comissão — o bruto é o mesmo.
  assert.deepEqual([contaDoPonto(DO_A777, 20).bruto, contaDoPonto(DO_A777, 20).comissao], [1706.62, 341.32]);
});

test("ponto sem porcentagem: viagens e bruto aparecem; a comissão fica em branco — nunca zero", () => {
  const conta = contaDoPonto(DO_B702, null);
  assert.deepEqual(conta, { viagens: 1, bruto: 517.32, comissao: null, toneladas: 29.92 });
  // Semana sem viagem, com porcentagem: aí sim é zero de verdade.
  assert.deepEqual(contaDoPonto([], 18), { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 });
  assert.equal(contaDoPonto([], null).comissao, null);
});

test("o saldo é UM só: a soma de todos os pontos, cada um com a SUA porcentagem", () => {
  const a777 = { porcentagem: 18.5, conta: contaDoPonto(DO_A777, 18.5) };
  const b702 = { porcentagem: 20, conta: contaDoPonto(DO_B702, 20) };
  assert.deepEqual([b702.conta.bruto, b702.conta.comissao], [517.32, 103.46]);
  const saldo = saldoDosPontos([a777, b702]);
  assert.equal(saldo.viagens, 4);
  assert.equal(saldo.bruto, 2223.94);
  // 18,5 % de um ponto + 20 % do outro — e não uma porcentagem só sobre tudo.
  assert.equal(saldo.comissao, 419.18);
  assert.notEqual(saldo.comissao, emCentavos(naCalculadora([...DO_A777, ...DO_B702], 18.5).ganho) / 100);
  assert.notEqual(saldo.comissao, emCentavos(naCalculadora([...DO_A777, ...DO_B702], 20).ganho) / 100);
  assert.ok(Math.abs(saldo.toneladas - 121.98) < 1e-9);
  // A ordem dos pontos não muda o saldo.
  assert.deepEqual(saldoDosPontos([b702, a777]).comissao, saldo.comissao);
});

test("o saldo fecha, centavo por centavo, com as linhas dos pontos", () => {
  const a777 = { porcentagem: 18.5, conta: contaDoPonto(DO_A777, 18.5) };
  const b702 = { porcentagem: 18.5, conta: contaDoPonto(DO_B702, 18.5) };
  const saldo = saldoDosPontos([a777, b702]);
  assert.equal(emCentavos(saldo.bruto), emCentavos(a777.conta.bruto) + emCentavos(b702.conta.bruto));
  assert.equal(emCentavos(saldo.comissao ?? Number.NaN), emCentavos(a777.conta.comissao ?? Number.NaN) + emCentavos(b702.conta.comissao ?? Number.NaN));
  // Somar tudo antes de arredondar daria R$ 2.223,93 — um centavo a menos do que 1.706,62 + 517,32.
  assert.match(brl(contaDasViagens([...DO_A777, ...DO_B702], 0).bruto), /2\.223,93$/);
  assert.match(brl(saldo.bruto), /2\.223,94$/);
  // Muitos pontos, valores quebrados: a soma em centavos nunca deixa resto de conta com vírgula.
  const muitos = Array.from({ length: 9 }, (_, i) => {
    const porcentagem = 15 + i * 0.75;
    return { porcentagem, conta: contaDoPonto([{ quant: 28.337 + i * 0.911, valor: 17.29 + i * 1.03 }, { quant: 31.005, valor: 20.01 }], porcentagem) };
  });
  const total = saldoDosPontos(muitos);
  assert.equal(emCentavos(total.bruto), muitos.reduce((s, p) => s + emCentavos(p.conta.bruto), 0));
  assert.equal(emCentavos(total.comissao ?? Number.NaN), muitos.reduce((s, p) => s + emCentavos(p.conta.comissao ?? Number.NaN), 0));
  assert.equal(total.viagens, 18);
  assert.match(String(total.bruto), /^\d+(\.\d{1,2})?$/, `bruto com mais de duas casas: ${total.bruto}`);
  assert.match(String(total.comissao), /^\d+(\.\d{1,2})?$/, `comissão com mais de duas casas: ${total.comissao}`);
});

test("enquanto falta a porcentagem de algum ponto do app, a comissão do saldo NÃO é somada", () => {
  const a777 = { porcentagem: 18.5, conta: contaDoPonto(DO_A777, 18.5) };
  // Ponto lido, sem porcentagem: entra nas viagens e no bruto; a comissão do saldo fica em branco.
  const semPorcentagem = saldoDosPontos([a777, { porcentagem: null, conta: contaDoPonto(DO_B702, null) }]);
  assert.deepEqual([semPorcentagem.viagens, semPorcentagem.bruto, semPorcentagem.comissao], [4, 2223.94, null]);
  // Ponto do app ainda sem leitura E sem porcentagem: também trava a comissão (todo ponto precisa da sua).
  assert.equal(saldoDosPontos([a777, { porcentagem: null, conta: null }]).comissao, null);
  // Ponto com porcentagem que só não foi lido ainda: a comissão é a dos pontos lidos (o card diz “1 de 2 pontos”).
  assert.deepEqual(saldoDosPontos([a777, { porcentagem: 20, conta: null }]), { viagens: 3, bruto: 1706.62, comissao: 315.72, toneladas: a777.conta.toneladas });
  // Nenhum ponto: tudo zero.
  assert.deepEqual(saldoDosPontos([]), { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 });
});

test("o cadastro: uma porcentagem para cada ponto, e só dos pontos que o motorista tem no app", () => {
  const meus = ["A032", "A063"];
  assert.deepEqual(porcentagensDoPedido({ porcentagens: { A032: "18", A063: "20,5" } }, meus), { porPonto: { A032: 1800, A063: 2050 } });
  // Um ponto de cada vez: os outros não são tocados.
  assert.deepEqual(porcentagensDoPedido({ porcentagens: { A063: "22" } }, meus), { porPonto: { A063: 2200 } });
  // O código vem como o motorista escreve; vale o que o portal usa.
  assert.deepEqual(porcentagensDoPedido({ porcentagens: { "a 63": 19.5 } }, meus), { porPonto: { A063: 1950 } });

  const erro = (corpo: unknown, codigos = meus) => {
    const r = porcentagensDoPedido(corpo, codigos);
    assert.ok("erro" in r && !("porPonto" in r), `aceitou ${JSON.stringify(corpo)}`);
    return "erro" in r ? r.erro : "";
  };
  // Ponto de outro motorista (ou que não existe): nada é salvo.
  assert.match(erro({ porcentagens: { A032: "18", A999: "18" } }), /não está cadastrado no app/);
  // Uma chave esquisita vinda do pedido (JSON) é só mais um “ponto” que o motorista não tem.
  assert.match(erro(JSON.parse('{"porcentagens":{"__proto__":"18"}}')), /não está cadastrado no app/);
  assert.match(erro(JSON.parse('{"porcentagens":{"constructor":"18","A032":"18"}}')), /não está cadastrado no app/);
  // Porcentagem que não é um número de 0 a 100: a resposta diz de qual ponto — e nada é salvo, nem a do outro.
  for (const ruim of ["", "0", "101", "100,01", "dezoito", "18,555", "-5", null, {}, []]) {
    assert.match(erro({ porcentagens: { A032: "18", A063: ruim } }), /porcentagem do A063/, `aceitou ${JSON.stringify(ruim)}`);
  }
  for (const vazio of [{ porcentagens: {} }, {}, null, "18", 18, [], { porcentagens: null }, { porcentagens: "18" }, { porcentagens: ["18"] }]) erro(vazio);
  // Sem ponto no app não há onde pôr a porcentagem.
  assert.match(erro({ porcentagens: { A032: "18" } }, []), /Cadastre o seu ponto/);
  assert.match(erro({ porcentagem: "18" }, []), /Cadastre o seu ponto/);
});

test("o pedido da tela antiga (uma porcentagem só) vale apenas para quem tem UM ponto", () => {
  assert.deepEqual(porcentagensDoPedido({ porcentagem: "18,5" }, ["A032"]), { porPonto: { A032: 1850 } });
  const dois = porcentagensDoPedido({ porcentagem: "18,5" }, ["A032", "A063"]);
  assert.ok("erro" in dois);
  assert.match("erro" in dois ? dois.erro : "", /cada ponto tem a sua porcentagem/);
  const ruim = porcentagensDoPedido({ porcentagem: "cem" }, ["A032"]);
  assert.ok("erro" in ruim);
  // Com os dois campos, vale o de cada ponto.
  assert.deepEqual(porcentagensDoPedido({ porcentagem: "50", porcentagens: { A063: "20" } }, ["A032", "A063"]), { porPonto: { A063: 2000 } });
});

test("todos os pontos do app entram na MESMA leitura, e o prazo cresce com eles", () => {
  assert.equal(MAX_PONTOS_POR_LEITURA, 10);
  // Até 3 pontos, os 12 s de sempre; cada ponto a mais ganha 2 s; nunca mais de 20 s.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 50].map(prazoDoTicketMs), [12_000, 12_000, 12_000, 12_000, 14_000, 16_000, 18_000, 20_000, 20_000, 20_000, 20_000]);
});
