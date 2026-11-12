import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretarTickets } from "../src/lib/portal-ticket-parse";
import { contaDoPonto, viagensValidas } from "../src/lib/portal-ticket";
import { calcular } from "../src/lib/frete";
import { criarPortalFalso, BASE_FALSA, CPF_FALSO, SENHA_FALSA, telaStatus, type LancamentoFalso, type TicketFalso } from "./portal-fixture";
import { lerPortalDoMotorista, lerTicketsComSessao, sessaoVazia } from "../src/lib/portal-copadubo";

// Os números visíveis da foto; o nome do motorista é fictício. A foto tem
// rolagem horizontal, portanto não prova quantas colunas existem no HTML.
const pesos = ["29.700", "30.200", "31.080", "31.420", "30.620", "29.620", "25.940", "23.000", "27.620", "27.160"];
const viagens: LancamentoFalso[] = pesos.map((quant, i) => ({ quant, valor: i < 6 ? "17.59" : "18.24", servico: "FRETE ATE 5 KM", data: "10/11/2026", hora: "12:00" }));
const semana = { inicio: "2026-11-09", fim: "2026-11-16" };
const linhas = pesos.map((q, i) => `<tr><td>A032</td><td>${q}</td><td>${i < 6 ? "17.59" : "18.24"}</td><td>FRETE ATE 5 KM</td></tr>`).join("\n");
const pagina = `<!doctype html><html><body><h2>Lançamentos</h2><table><thead><tr><th>PONTO</th><th>QUANT</th><th>VALOR</th><th>SERVIÇO</th></tr></thead><tbody>${linhas}<tr><td colspan="2">Motorista: PESSOA FICTÍCIA</td><td colspan="2">Total: 10 - 286.360</td></tr></tbody></table><p>Total Geral: 10 viagens - 286.360</p></body></html>`;
const ler = (html = pagina) => interpretarTickets(html, { codigo: "A032", ...semana });

test("foto com viagens: quatro colunas, total sem unidade e conta da calculadora", () => {
  const resultado = ler();
  assert.ok(resultado.ok, resultado.ok ? "" : resultado.motivo);
  assert.equal(resultado.lancamentos.length, 10);
  assert.ok(resultado.lancamentos.every((v) => v.data === null && v.hora === null));
  assert.deepEqual(resultado.lancamentos.map((v) => v.quant), pesos.map(Number));
  const conta = contaDoPonto(resultado.lancamentos, 20);
  const calculadora = calcular({ ponto: "A032", cargas: resultado.lancamentos.map((v, i) => ({ ...v, id: String(i), subtotal: v.quant * v.valor, linha: "", confianca: "alta" as const })) }, 20);
  assert.equal(conta.viagens, 10);
  assert.ok(Math.abs(conta.toneladas - 286.36) < 1e-9);
  assert.equal(conta.bruto, 5104.49);
  assert.equal(conta.comissao, 1020.90);
  assert.equal(conta.bruto, Number(calculadora.bruto.toFixed(2)));
  assert.equal(conta.comissao, Number(calculadora.ganho.toFixed(2)));
  assert.equal(viagensValidas(resultado.lancamentos)?.length, 10);
  assert.equal(viagensValidas([{ ...resultado.lancamentos[0], hora: "12:00" }]), null);
});

test("foto: recusa total ausente, divergente, linha incompleta ou outro ponto", () => {
  for (const html of [
    pagina.replace(/<p>Total Geral.*?<\/p>/, ""),
    pagina.replace("10 viagens - 286.360", "9 viagens - 286.360"),
    pagina.replace("10 viagens - 286.360", "10 viagens - 285.360"),
    pagina.replace("Total: 10 - 286.360", "Total: 9 - 286.360"),
    pagina.replace("<td>29.700</td>", "<td>incompleto</td>"),
    pagina.replace("<td>A032</td>", "<td>A033</td>"),
    pagina.replace(linhas.split("\n")[0], ""),
  ]) assert.equal(ler(html).ok, false);
});

test("leitura automática usa a sessão e calcula os dados lidos sem abrir PDF", async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  const tickets: TicketFalso = { pontos: ["A032"], semanas: ["09/11/2026 - 16/11/2026"], lancamentos: { "0|0": viagens }, quatroColunas: true, comTotal: true };
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([{ codigo: "A032", situacao: "ATIVO", linhas: ["Ativado hoje, 19:50"], botao: "Entrar na dispensa" }]) }, tickets });
  const sessao = sessaoVazia();
  assert.equal((await lerPortalDoMotorista({ cpf: CPF_FALSO, senha: SENHA_FALSA }, null, { buscar: portal.buscar, codigo: "A032", codigos: ["A032"], sessao })).ok, true);
  const resultado = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A032"], agora: new Date("2026-11-11T13:00:00Z") });
  assert.deepEqual(resultado.falhas, {});
  assert.equal(contaDoPonto(resultado.pontos.A032, 20).bruto, 5104.49);
  assert.ok(!portal.pedidos.some((p) => /pdf/i.test(p.caminho)));
});

test("com colunas fora da foto, o HTML completo mantém data e hora", async () => {
  const { telaTickets } = await import("./portal-fixture");
  const html = telaTickets({ pontos: ["A032"], semanas: ["09/11/2026 - 16/11/2026"], lancamentos: { "0|0": viagens }, comTotal: true }, 0, 0);
  const resultado = ler(html);
  assert.ok(resultado.ok, resultado.ok ? "" : resultado.motivo);
  assert.equal(resultado.lancamentos.length, 10);
  assert.equal(resultado.lancamentos[0].data, "2026-11-10");
  assert.equal(resultado.lancamentos[0].hora, "12:00");
  assert.equal(contaDoPonto(resultado.lancamentos, 20).bruto, 5104.49);
});

test("opções repetidas sem data e hora não são somadas nem deduplicadas por adivinhação", async () => {
  process.env.PORTAL_MOTORISTA_URL = BASE_FALSA;
  const tickets: TicketFalso = { pontos: ["A032", "A032"], semanas: ["09/11/2026 - 16/11/2026"], lancamentos: { "0|0": viagens, "1|0": viagens }, quatroColunas: true, comTotal: true };
  const portal = criarPortalFalso({ telas: { "moto/status": telaStatus([{ codigo: "A032", situacao: "ATIVO", linhas: ["Ativado hoje, 19:50"], botao: "Entrar na dispensa" }]) }, tickets });
  const sessao = sessaoVazia();
  assert.equal((await lerPortalDoMotorista({ cpf: CPF_FALSO, senha: SENHA_FALSA }, null, { buscar: portal.buscar, codigo: "A032", codigos: ["A032"], sessao })).ok, true);
  const resultado = await lerTicketsComSessao(sessao, { buscar: portal.buscar, codigos: ["A032"], agora: new Date("2026-11-11T13:00:00Z") });
  assert.equal(resultado.pontos.A032, undefined);
  assert.match(resultado.falhas.A032, /não informa data e hora/);
});
