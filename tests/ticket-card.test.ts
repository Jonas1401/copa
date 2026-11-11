import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { brl } from "../src/lib/frete";
import { SERVICOS } from "../src/lib/servicos";
import {
  avisoDaPagina,
  cartaoDoTicket,
  horaDaLeitura,
  hojeEmBrasiliaISO,
  rotuloDaSemana,
  textoDeViagens,
  type PontoDoResumo,
  type ResumoDoTicket,
} from "../src/lib/ticket-card";

/**
 * O card “Saldo de Ganhos” (SERVIÇOS) e os textos da página: viagens, valor
 * bruto e comissão da semana, lidos na aba “Ticket” do Portal do Motorista.
 * Só regras de tela — sem rede e sem banco. Dados inventados.
 */

const ler = (p: string) => readFileSync(p, "utf8");
/** Quarta-feira, 11/11/2026, 11:45 em Brasília. */
const AGORA = Date.parse("2026-11-11T14:45:00Z");
const SEMANA = { inicio: "2026-11-09", fim: "2026-11-16" };

const ponto = (codigo: string, viagens: number | null, extra: Partial<PontoDoResumo> = {}): PontoDoResumo => ({
  codigo,
  viagens: viagens === null ? null : Array.from({ length: viagens }, (_, i) => ({ quant: 30, valor: 20, servico: "FRETE ATE 5 KM", data: "2026-11-10", hora: `0${i}:00` })),
  conta: viagens === null ? null : { viagens, bruto: viagens * 600, comissao: viagens * 108, toneladas: viagens * 30 },
  lidoEm: viagens === null ? null : "2026-11-11T14:42:00Z",
  tentativaEm: "2026-11-11T14:42:00Z",
  erro: null,
  ...extra,
});

const resumo = (extra: Partial<ResumoDoTicket> = {}): ResumoDoTicket => ({
  disponivel: true,
  ligado: true,
  porcentagem: 18,
  temAcesso: true,
  totalPontos: 1,
  semana: SEMANA,
  conta: { viagens: 4, bruto: 2223.9342, comissao: 400.308156, toneladas: 121.98 },
  pontos: [ponto("A777", 4)],
  completo: true,
  lidoEm: "2026-11-11T14:42:00Z",
  recente: true,
  tentativaEm: "2026-11-11T14:42:00Z",
  erro: null,
  intervaloMin: 5,
  diagnostico: [],
  ...extra,
});

test("com leitura em dia, o card mostra só três números: viagens, bruto e comissão", () => {
  const card = cartaoDoTicket(resumo(), AGORA);
  assert.deepEqual(card, { modo: "numeros", viagens: "4", bruto: brl(2223.9342), comissao: brl(400.308156), nota: null, velho: false });
  // Dinheiro no formato do app (o mesmo da calculadora de frete).
  assert.match(card.modo === "numeros" ? card.bruto : "", /^R\$\s2\.223,93$/);
  assert.match(card.modo === "numeros" ? card.comissao : "", /^R\$\s400,31$/);
});

test("semana sem viagem é zero de verdade (não “sem leitura”)", () => {
  const card = cartaoDoTicket(resumo({ conta: { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 }, pontos: [ponto("A777", 0)] }), AGORA);
  assert.deepEqual(card, { modo: "numeros", viagens: "0", bruto: brl(0), comissao: brl(0), nota: null, velho: false });
});

test("sem leitura, o card diz em poucas palavras o que falta — nunca um número", () => {
  const texto = (r: ResumoDoTicket | null) => {
    const c = cartaoDoTicket(r, AGORA);
    assert.equal(c.modo, "texto");
    return c.modo === "texto" ? c.texto : "";
  };
  const semLeitura = { semana: null, pontos: [ponto("A777", null)], completo: false, lidoEm: null, recente: false };
  assert.equal(texto(null), "Viagens da semana");
  assert.equal(texto(resumo({ disponivel: false })), "Viagens da semana");
  assert.equal(texto(resumo({ ligado: false, porcentagem: null, ...semLeitura, pontos: [] })), "Cadastre sua porcentagem");
  assert.equal(texto(resumo({ temAcesso: false, ...semLeitura })), "Falta o acesso ao portal");
  assert.equal(texto(resumo({ totalPontos: 0, ...semLeitura, pontos: [] })), "Cadastre o seu ponto");
  assert.equal(texto(resumo(semLeitura)), "Lendo o portal…");
  assert.equal(texto(resumo({ ...semLeitura, erro: "o portal pediu o login de novo" })), "Sem leitura do portal");
});

test("leitura antiga nunca aparece como se fosse de agora: o card leva a hora dela", () => {
  // Lida hoje, mas há mais tempo do que a validade.
  const hoje = cartaoDoTicket(resumo({ recente: false, lidoEm: "2026-11-11T12:10:00Z" }), AGORA);
  assert.equal(hoje.modo, "numeros");
  assert.deepEqual(hoje.modo === "numeros" && [hoje.nota, hoje.velho], ["Lido 09:10", true]);
  // Lida ontem: a nota traz o dia.
  const ontem = cartaoDoTicket(resumo({ recente: false, lidoEm: "2026-11-10T21:30:00Z" }), AGORA);
  assert.deepEqual(ontem.modo === "numeros" && [ontem.nota, ontem.velho], ["Lido 10/11 18:30", true]);
});

test("soma parcial (nem todos os pontos lidos na semana) é dita no card", () => {
  const parcial = resumo({ totalPontos: 3, pontos: [ponto("A777", 4), ponto("B702", null), ponto("M703", null)], completo: false });
  const card = cartaoDoTicket(parcial, AGORA);
  assert.deepEqual(card.modo === "numeros" && [card.nota, card.velho], ["1 de 3 pontos", false]);
});

test("a hora da leitura é a de Brasília, e o rótulo da semana é dia/mês", () => {
  assert.equal(horaDaLeitura("2026-11-11T14:42:00Z", AGORA), "11:42");
  assert.equal(horaDaLeitura("2026-11-11T02:59:00Z", AGORA), "10/11 23:59", "02:59 UTC ainda é o dia anterior em Brasília");
  assert.equal(horaDaLeitura("isto não é data", AGORA), "—");
  assert.equal(hojeEmBrasiliaISO(Date.parse("2026-11-12T02:30:00Z")), "2026-11-11");
  assert.equal(rotuloDaSemana(SEMANA), "09/11 a 16/11");
  assert.equal(textoDeViagens(0), "Nenhuma viagem");
  assert.equal(textoDeViagens(1), "1 viagem");
  assert.equal(textoDeViagens(19), "19 viagens");
});

test("o aviso da página: um só, o mais importante — e nenhum quando está tudo em dia", () => {
  assert.equal(avisoDaPagina(resumo(), AGORA), null);
  assert.match(avisoDaPagina(resumo({ disponivel: false }), AGORA)?.texto ?? "", /desligada neste servidor/);
  const semAcesso = avisoDaPagina(resumo({ temAcesso: false }), AGORA);
  assert.equal(semAcesso?.acao, "portal");
  assert.match(semAcesso?.texto ?? "", /cadastre o CPF e a senha do Portal do Motorista/);
  assert.equal(avisoDaPagina(resumo({ totalPontos: 0, pontos: [] }), AGORA)?.acao, "inicio");
  // Quem ainda não cadastrou a porcentagem não leva aviso: o formulário já está na tela.
  assert.equal(avisoDaPagina(resumo({ ligado: false, porcentagem: null, semana: null, pontos: [] }), AGORA), null);

  const semLeitura = { semana: null, pontos: [ponto("A777", null)], completo: false, lidoEm: null, recente: false };
  assert.match(avisoDaPagina(resumo(semLeitura), AGORA)?.texto ?? "", /as viagens aparecem em até 5 minutos/);
  const comErro = avisoDaPagina(resumo({ ...semLeitura, erro: "a tela do Ticket mudou" }), AGORA);
  assert.equal(comErro?.tom, "atencao");
  assert.match(comErro?.texto ?? "", /Ainda não consegui ler as viagens no portal: a tela do Ticket mudou/);

  const velha = avisoDaPagina(resumo({ recente: false, lidoEm: "2026-11-11T12:10:00Z", erro: "o portal respondeu 503" }), AGORA);
  assert.match(velha?.texto ?? "", /Estes números são da leitura de 09:10 — a última tentativa não veio: o portal respondeu 503/);

  // Semana guardada que não é mais a de hoje (leitura parada desde a semana passada, mas marcada como recente por engano).
  const outraSemana = avisoDaPagina(resumo({ semana: { inicio: "2026-11-02", fim: "2026-11-08" } }), AGORA);
  assert.match(outraSemana?.texto ?? "", /são da semana 02\/11 a 08\/11/);

  const parcial = avisoDaPagina(resumo({ totalPontos: 3, pontos: [ponto("A777", 4), ponto("B702", null, { erro: "a lista do portal não tem o B702" }), ponto("M703", null)], completo: false }), AGORA);
  assert.equal(parcial?.tom, "info");
  assert.match(parcial?.texto ?? "", /A soma é de 1 de 3 pontos\. Falta ler: B702, M703 \(B702: a lista do portal não tem o B702\)/);
});

test("nenhum aviso de tela traz peso ou valor", () => {
  const casos = [
    resumo({ recente: false, erro: "linha 2: VALOR “999.99” fora do esperado" }),
    resumo({ totalPontos: 2, pontos: [ponto("A777", 4), ponto("B702", null)], completo: false }),
  ];
  for (const r of casos) {
    const texto = avisoDaPagina(r, AGORA)?.texto ?? "";
    assert.ok(!/2\.223|400,3|121,98|R\$/.test(texto), texto);
  }
});

/* ------------------------------------------------------------- a tela ligada */

test("o card “Saldo de Ganhos” abre a página do app (o quadro antigo foi desligado)", () => {
  const card = SERVICOS.find((s) => s.id === "consulta-ponto");
  assert.equal(card?.href, "/consulta-ponto");
  assert.equal(card?.titulo, "Saldo de Ganhos");
  assert.equal(card?.subtitulo, "Viagens da semana");
  // Continua entre os dois cards visíveis sem tocar em “Ver todos”.
  assert.ok(SERVICOS.findIndex((s) => s.id === "consulta-ponto") < 2);
  assert.ok(!ler("src/lib/servicos.ts").includes('href: "https://intranet.copadubo.com.br/ponto/"'), "o card ainda aponta para o quadro desligado");
  assert.match(ler("src/app/consulta-ponto/page.tsx"), /ConsultaPontoApp/);
});

test("o nome que aparece é “Saldo de Ganhos”: no card, na página, na aba do navegador e no /admin", () => {
  assert.equal(SERVICOS.find((s) => s.id === "consulta-ponto")?.titulo, "Saldo de Ganhos");
  const tela = ler("src/components/consulta/ConsultaPontoApp.tsx");
  assert.match(tela, /<h1 [^>]*>Saldo de Ganhos<\/h1>/);
  assert.match(tela, /"Saldo de Ganhos desligado\./);
  assert.match(ler("src/app/consulta-ponto/page.tsx"), /title: "Saldo de Ganhos · Viagens da semana · CopaLinks"/);
  assert.match(ler("src/components/admin/CartaoPortalAdmin.tsx"), /Saldo de Ganhos · aba “Ticket” do portal/);
  // O nome antigo não aparece em nenhuma tela (o `id` e a rota `consulta-ponto` são internos e ficaram).
  for (const arquivo of [
    "src/components/consulta/ConsultaPontoApp.tsx",
    "src/app/consulta-ponto/page.tsx",
    "src/components/inicio/Servicos.tsx",
    "src/components/admin/CartaoPortalAdmin.tsx",
    "src/components/MonitorApp.tsx",
    "src/lib/ticket-card.ts",
    "src/app/api/tickets/route.ts",
  ]) {
    assert.ok(!/consulta de ponto/i.test(ler(arquivo)), `${arquivo} ainda fala em “Consulta de Ponto”`);
  }
  assert.ok(!/Desligar a consulta|Consulta desligada/.test(tela), "a página ainda chama o serviço de “consulta”");
  // Em `servicos.ts`, o nome antigo só aparece na nota que explica o `id`.
  assert.equal((ler("src/lib/servicos.ts").match(/Consulta de Ponto/g) ?? []).length, 1);
});

test("o card dos SERVIÇOS mostra os três números do motorista logado", () => {
  const servicos = ler("src/components/inicio/Servicos.tsx");
  assert.match(servicos, /useResumoDoTicket\(logado\)/);
  assert.match(servicos, /ticket=\{s\.id === "consulta-ponto" \? ticket : undefined\}/, "só o card do Saldo de Ganhos recebe os números");
  for (const rotulo of [">Viagens<", ">Bruto<", ">Comissão<"]) assert.ok(servicos.includes(rotulo), `o card sem ${rotulo}`);
  // Dinheiro nunca é cortado com “…”: em card estreito o valor desce para a linha de baixo.
  const numeros = servicos.slice(servicos.indexOf("function NumerosDoTicket"), servicos.indexOf("function CartaoServico"));
  assert.ok(!/\btruncate\b|line-clamp|text-ellipsis|overflow-hidden/.test(numeros), "os números do card não podem ser cortados");
  assert.match(numeros, /flex-wrap/);
  assert.match(numeros, /whitespace-nowrap/);
  assert.match(ler("src/components/MonitorApp.tsx"), /<Servicos onSemLink=\{semLink\} logado=\{Boolean\(motorista\)\} \/>/);
  // Visitante sem cadastro não consulta o servidor.
  const gancho = ler("src/components/consulta/useResumoDoTicket.ts");
  assert.match(gancho, /if \(!ativo\) return;/);
  assert.match(gancho, /fetch\("\/api\/tickets", \{ cache: "no-store" \}\)/);
  // Quem não ligou a consulta (ou não tem cadastro) não repete o pedido de minuto em minuto.
  assert.match(gancho, /semRepeticao\.current = r\.status === 401;/);
  assert.match(gancho, /semRepeticao\.current = !dados\.ligado;/);
  assert.match(gancho, /if \(visivel\(\) && !semRepeticao\.current\) void carregar\(\);/);
  // Uma falha no bloco do Ticket nunca derruba o painel do portal no /admin.
  assert.match(ler("src/app/api/admin/portal/route.ts"), /saudeDoTicket\(\)\.catch\(\(\) => null\)/);
});

test("a página: porcentagem, atualizar, desligar — e os três números", () => {
  const tela = ler("src/components/consulta/ConsultaPontoApp.tsx");
  for (const trecho of ["Sua porcentagem", "Atualizar", "Desligar o Saldo de Ganhos", "Valor bruto", "Comissão", "textoDeViagens(resumo.conta.viagens)"]) {
    assert.ok(tela.includes(trecho), `a página sem “${trecho}”`);
  }
  // As três ações da API, e nenhuma credencial do portal nesta tela.
  assert.match(tela, /chamar\("POST", "salvar", \{ porcentagem: campo \}\)/);
  assert.match(tela, /chamar\("PUT", "atualizar"\)/);
  assert.match(tela, /chamar\("DELETE", "desligar"\)/);
  assert.ok(!/senha|cpf/i.test(tela.replace(/o CPF e a senha do Portal do Motorista/g, "")), "a página da consulta não lida com CPF nem senha");
  // Quem não tem o acesso ao portal é levado ao cadastro dele.
  assert.match(tela, /href="\/\?portal=1"/);
  assert.match(ler("src/components/MonitorApp.tsx"), /searchParams\.get\("portal"\) === "1"/);
  // Mesma largura e mesmo fundo das outras telas do app.
  assert.ok(tela.includes("largura-aparelho") && tela.includes("fundo-app") && tela.includes("bg-fundo"));
});

test("a rota /api/tickets é só do próprio motorista e nunca faz login no portal", () => {
  const rota = ler("src/app/api/tickets/route.ts");
  // Toda ação começa pela sessão do motorista.
  const verbos = rota.split(/export async function /).slice(1);
  assert.deepEqual(verbos.map((v) => v.slice(0, v.indexOf("("))), ["GET", "POST", "PUT", "DELETE"]);
  for (const v of verbos) {
    assert.match(v, /const m = await motoristaDaSessao\(\);\s+if \(!m\) return naoAutorizadoMotorista\(\);/, v.slice(0, 20));
    // …e só usa o id da sessão: nunca um id vindo do pedido.
    assert.ok(!/corpo\?\.(motoristaId|id)\b|searchParams/.test(v), v.slice(0, 20));
  }
  assert.match(rota, /"Cache-Control": "private, no-store"/);
  // Nada daqui entra no portal com CPF e senha: a leitura usa a sessão guardada.
  for (const proibido of ["monitorarMotorista", "lerPortalDoMotorista", "credenciaisDoMotorista", "salvarAcessoPortal"]) {
    assert.ok(!rota.includes(proibido), `a rota dos tickets não pode chamar ${proibido}`);
  }
  const lib = ler("src/lib/portal-ticket.ts");
  for (const proibido of ["monitorarMotorista", "lerPortalDoMotorista", "credenciaisDoMotorista", "lerEGuardarPortal"]) {
    assert.ok(!lib.includes(proibido), `portal-ticket.ts não pode chamar ${proibido}`);
  }
});
