import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { brl } from "../src/lib/frete";
import { SERVICOS } from "../src/lib/servicos";
import {
  CABECALHO_DA_TELA,
  FALTA_PORCENTAGEM,
  SEM_SALDO,
  VERSAO_DA_TELA,
  avisoDaPagina,
  cartaoDoTicket,
  horaDaLeitura,
  hojeEmBrasiliaISO,
  listaDePontos,
  resumoParaATela,
  rotuloDaSemana,
  saldoDoInicio,
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
  porcentagem: 18,
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
  semPorcentagem: [],
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
  assert.deepEqual(card, { modo: "numeros", viagens: "4", bruto: brl(2223.9342), comissao: brl(400.308156), faltaPorcentagem: false, nota: null, velho: false });
  // Dinheiro no formato do app (o mesmo da calculadora de frete).
  assert.match(card.modo === "numeros" ? card.bruto : "", /^R\$\s2\.223,93$/);
  assert.match(card.modo === "numeros" ? card.comissao : "", /^R\$\s400,31$/);
});

test("semana sem viagem é zero de verdade (não “sem leitura”)", () => {
  const card = cartaoDoTicket(resumo({ conta: { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 }, pontos: [ponto("A777", 0)] }), AGORA);
  assert.deepEqual(card, { modo: "numeros", viagens: "0", bruto: brl(0), comissao: brl(0), faltaPorcentagem: false, nota: null, velho: false });
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

/* ------------------------------------------- uma porcentagem para cada ponto */

/** Dois pontos lidos; o B702 ainda sem a porcentagem dele: o saldo soma viagens e bruto, e a comissão fica em branco. */
const faltandoUma = (extra: Partial<ResumoDoTicket> = {}) =>
  resumo({
    porcentagem: null,
    semPorcentagem: ["B702"],
    totalPontos: 2,
    conta: { viagens: 5, bruto: 2790.94, comissao: null, toneladas: 153.48 },
    pontos: [ponto("A777", 3), ponto("B702", 2, { porcentagem: null, conta: { viagens: 2, bruto: 1084.32, comissao: null, toneladas: 61.42 } })],
    ...extra,
  });

test("falta a porcentagem de um ponto: o card mostra viagens e bruto, e “Falta %” no lugar da comissão", () => {
  const card = cartaoDoTicket(faltandoUma(), AGORA);
  assert.deepEqual(card, { modo: "numeros", viagens: "5", bruto: brl(2790.94), comissao: "Falta %", faltaPorcentagem: true, nota: "Cadastre a % do B702", velho: false });
  assert.equal(FALTA_PORCENTAGEM, "Falta %");
  // Nunca um valor em dinheiro (nem R$ 0,00) no lugar da comissão que não foi somada.
  assert.ok(card.modo === "numeros" && !/R\$|\d/.test(card.comissao), JSON.stringify(card));

  // Dois ou mais pontos sem porcentagem: a nota conta quantos.
  const duas = cartaoDoTicket(faltandoUma({ semPorcentagem: ["B702", "M703"], totalPontos: 3 }), AGORA);
  assert.deepEqual(duas.modo === "numeros" && [duas.comissao, duas.nota], ["Falta %", "Cadastre a % de 2 pontos"]);

  // Leitura antiga: a nota é a hora dela (o “Falta %” continua no lugar da comissão).
  const velha = cartaoDoTicket(faltandoUma({ recente: false, lidoEm: "2026-11-11T12:10:00Z" }), AGORA);
  assert.deepEqual(velha.modo === "numeros" && [velha.comissao, velha.faltaPorcentagem, velha.nota, velha.velho], ["Falta %", true, "Lido 09:10", true]);

  // Soma parcial E porcentagem faltando (o ponto recém-cadastrado: sem leitura e sem porcentagem): o card
  // diz que a soma não é de todos — o “Falta %” já está no lugar da comissão, e a página diz de qual ponto.
  const parcial = cartaoDoTicket(faltandoUma({ totalPontos: 3, completo: false, pontos: [ponto("A777", 3), ponto("B702", 2, { porcentagem: null }), ponto("M703", null)] }), AGORA);
  assert.deepEqual(parcial.modo === "numeros" && [parcial.comissao, parcial.faltaPorcentagem, parcial.nota], ["Falta %", true, "2 de 3 pontos"]);

  // Pontos com porcentagens DIFERENTES e todas cadastradas: a comissão aparece, sem nota.
  const cadaUmComASua = cartaoDoTicket(
    resumo({ porcentagem: null, totalPontos: 2, conta: { viagens: 5, bruto: 2790.94, comissao: 554.27, toneladas: 153.48 }, pontos: [ponto("A777", 3), ponto("B702", 2, { porcentagem: 22 })] }),
    AGORA,
  );
  assert.deepEqual(cadaUmComASua, { modo: "numeros", viagens: "5", bruto: brl(2790.94), comissao: brl(554.27), faltaPorcentagem: false, nota: null, velho: false });
});

test("falta a porcentagem de um ponto: o aviso da página diz de qual — sem peso nem valor", () => {
  const aviso = avisoDaPagina(faltandoUma(), AGORA);
  assert.equal(aviso?.tom, "atencao");
  assert.equal(aviso?.texto, "Falta a porcentagem do B702. A comissão aparece quando todos os pontos tiverem a sua.");
  assert.match(avisoDaPagina(faltandoUma({ semPorcentagem: ["B702", "M703", "A705"] }), AGORA)?.texto ?? "", /^Falta a porcentagem do B702, do M703 e do A705\./);
  assert.ok(!/R\$|2\.790|1\.084|153,48/.test(aviso?.texto ?? ""));
  // Falta a porcentagem E falta ler um ponto: o aviso diz as duas coisas (o saldo ainda não é o de todos os pontos).
  const asDuas = avisoDaPagina(
    faltandoUma({ semPorcentagem: ["M703"], totalPontos: 3, completo: false, pontos: [ponto("A777", 3), ponto("B702", 2), ponto("M703", null, { porcentagem: null })] }),
    AGORA,
  );
  assert.equal(asDuas?.tom, "atencao");
  assert.equal(
    asDuas?.texto,
    "Falta a porcentagem do M703. A comissão aparece quando todos os pontos tiverem a sua. A soma é de 2 de 3 pontos. Falta ler: M703 — entra nas próximas leituras.",
  );
  // Só falta ler (as porcentagens estão todas): um ponto “entra”, dois “entram” nas próximas leituras.
  const doisSemLer = avisoDaPagina(resumo({ totalPontos: 3, pontos: [ponto("A777", 4), ponto("B702", null), ponto("M703", null)], completo: false }), AGORA);
  assert.deepEqual([doisSemLer?.tom, doisSemLer?.texto], ["info", "A soma é de 1 de 3 pontos. Falta ler: B702, M703 — entram nas próximas leituras."]);
  // Antes disso vêm os avisos de leitura (sem leitura, leitura antiga): a porcentagem que falta aparece no próprio bloco dela.
  assert.match(avisoDaPagina(faltandoUma({ recente: false, lidoEm: "2026-11-11T12:10:00Z" }), AGORA)?.texto ?? "", /são da leitura de 09:10/);
  assert.equal(listaDePontos([]), "");
  assert.equal(listaDePontos(["A063"]), "do A063");
  assert.equal(listaDePontos(["A063", "B702"]), "do A063 e do B702");
  assert.equal(listaDePontos(["A063", "B702", "M703"]), "do A063, do B702 e do M703");
});

test("tela aberta antes da porcentagem por ponto (sem recarregar) nunca recebe uma comissão em branco", () => {
  // A tela de agora se apresenta; recebe o resumo como ele é.
  const falta = faltandoUma();
  assert.equal(resumoParaATela(falta, VERSAO_DA_TELA), falta);
  assert.equal(resumoParaATela(falta, "3"), falta, "uma tela mais nova também sabe");
  // A tela antiga escreveria a comissão em branco como R$ 0,00: para ela, é como quem ainda não cadastrou a porcentagem.
  for (const antiga of [null, "", "1", "abc"]) {
    const visto = resumoParaATela(falta, antiga);
    assert.equal(visto.ligado, false, `tela “${antiga}”`);
    assert.equal(cartaoDoTicket(visto, AGORA).modo, "texto");
    assert.deepEqual(cartaoDoTicket(visto, AGORA), { modo: "texto", texto: "Cadastre sua porcentagem" });
  }
  // Com todas as porcentagens cadastradas, a tela antiga recebe tudo como sempre (os números são números).
  const emDia = resumo();
  assert.equal(resumoParaATela(emDia, null), emDia);
  const desligado = resumo({ ligado: false, semPorcentagem: ["A777"] });
  assert.equal(resumoParaATela(desligado, null), desligado);
  assert.equal(CABECALHO_DA_TELA, "x-saldo-de-ganhos");
  // As duas telas (card e página) mandam o cabeçalho em todo pedido; a rota usa só ele para decidir.
  const gancho = ler("src/components/consulta/useResumoDoTicket.ts");
  assert.match(gancho, /headers: \{ \[CABECALHO_DA_TELA\]: VERSAO_DA_TELA \}/);
  const tela = ler("src/components/consulta/ConsultaPontoApp.tsx");
  assert.match(tela, /headers: \{ \[CABECALHO_DA_TELA\]: VERSAO_DA_TELA, /);
  assert.equal((tela.match(/fetch\(/g) ?? []).length, 1, "a página fala com a API num lugar só");
  const rota = ler("src/app/api/tickets/route.ts");
  assert.match(rota, /resumoParaATela\(resumo, req\.headers\.get\(CABECALHO_DA_TELA\)\)/);
  // GET, POST e PUT devolvem o resumo passando por ela.
  assert.equal((rota.match(/paraATela\(req, /g) ?? []).length, 3);
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
  assert.match(servicos, /ticket=\{s\.id === "consulta-ponto" \? ticket : undefined\}/, "só o card do Saldo de Ganhos recebe os números");
  for (const rotulo of [">Viagens<", ">Bruto<", ">Comissão<"]) assert.ok(servicos.includes(rotulo), `o card sem ${rotulo}`);
  // Dinheiro nunca é cortado com “…”: em card estreito o valor desce para a linha de baixo.
  const numeros = servicos.slice(servicos.indexOf("function NumerosDoTicket"), servicos.indexOf("function CartaoServico"));
  assert.ok(!/\btruncate\b|line-clamp|text-ellipsis|overflow-hidden/.test(numeros), "os números do card não podem ser cortados");
  assert.match(numeros, /flex-wrap/);
  assert.match(numeros, /whitespace-nowrap/);
  // “Falta %” não é dinheiro: aparece na cor de aviso (âmbar), e não na cor da comissão.
  assert.match(numeros, /\$\{c\.faltaPorcentagem \? "text-ambar" : "text-ouro"\}`\}>\{c\.comissao\}</);
  // Quem consulta o servidor é a tela inicial, UMA vez só: o mesmo resumo vai para este card e para o
  // “Você vai receber” do cartão do número (dois pedidos por minuto, não; dois números diferentes, nunca).
  const inicio = ler("src/components/MonitorApp.tsx");
  assert.ok(!/useResumoDoTicket/.test(servicos), "o card dos SERVIÇOS não consulta por conta própria");
  assert.equal((inicio.match(/useResumoDoTicket\(/g) ?? []).length, 1);
  assert.match(inicio, /const ticket = useResumoDoTicket\(motoristaId !== null, 60_000, motoristaId\);/);
  assert.match(inicio, /const cartaoTicket = motorista && ticket\.resumo \? cartaoDoTicket\(ticket\.resumo, ticket\.agora\) : null;/);
  assert.match(inicio, /<Servicos onSemLink=\{semLink\} ticket=\{cartaoTicket\} \/>/);
  // Visitante sem cadastro não consulta o servidor.
  const gancho = ler("src/components/consulta/useResumoDoTicket.ts");
  assert.match(gancho, /if \(!ativo\) return;/);
  assert.match(gancho, /fetch\("\/api\/tickets", \{ cache: "no-store", headers: /);
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
  // Mais de um ponto: uma porcentagem para CADA ponto (uma linha por ponto, “Cadastrar” / “Trocar”).
  for (const trecho of ["Porcentagem de cada ponto", "Cadastrar", "Trocar", "Cada ponto tem a sua porcentagem. O saldo é um só"]) {
    assert.ok(tela.includes(trecho), `a página sem “${trecho}”`);
  }
  assert.match(tela, /const varios = pontos\.length > 1;/);
  // O ponto sem porcentagem abre sozinho para o motorista digitar.
  assert.match(tela, /const primeiroSemPorcentagem = resumo\?\.semPorcentagem\[0\] \?\? null;/);
  assert.match(tela, /pontos\.find\(\(p\) => p\.codigo === escolhido\) \?\? pontos\.find\(\(p\) => p\.codigo === primeiroSemPorcentagem\) \?\? null/);
  // O que foi digitado vale só para o ponto em que foi digitado (a tela nunca leva o número de um ponto para outro).
  assert.match(tela, /const texto = emEdicao && digitado\?\.codigo === emEdicao\.codigo \? digitado\.texto : null;/);
  // A comissão do saldo nunca aparece pela metade: “Falta %” no lugar dela.
  assert.match(tela, /resumo\.conta\.comissao === null \? FALTA_PORCENTAGEM : brl\(resumo\.conta\.comissao\)/);
  // As três ações da API, e nenhuma credencial do portal nesta tela. A porcentagem vai com o código do ponto.
  assert.match(tela, /chamar\("POST", "salvar", \{ porcentagens: \{ \[emEdicao\.codigo\]: campo \} \}\)/);
  assert.ok(!/\{ porcentagem: campo \}/.test(tela), "a página ainda manda uma porcentagem só para tudo");
  assert.match(tela, /chamar\("PUT", "atualizar"\)/);
  assert.match(tela, /chamar\("DELETE", "desligar"\)/);
  assert.ok(!/senha|cpf/i.test(tela.replace(/o CPF e a senha do Portal do Motorista/g, "")), "a página da consulta não lida com CPF nem senha");
  // Quem não tem o acesso ao portal é levado ao cadastro dele.
  assert.match(tela, /href="\/\?portal=1"/);
  assert.match(ler("src/components/MonitorApp.tsx"), /searchParams\.get\("portal"\) === "1"/);
  // Mesma largura e mesmo fundo das outras telas do app.
  assert.ok(tela.includes("largura-aparelho") && tela.includes("fundo-app") && tela.includes("bg-fundo"));
});

test("a tabela de viagens: o peso nunca encosta no valor, e em tela estreita nada é cortado", () => {
  const tela = ler("src/components/consulta/ConsultaPontoApp.tsx");
  const tabela = tela.slice(tela.indexOf("function ViagensDoPonto"), tela.indexOf("function EditorDaPorcentagem"));
  assert.ok(tabela.length > 500, "não achei a tabela de viagens na página");
  // Todo número tem um respiro à esquerda e não quebra no meio (antes, em 360 px, a tela mostrava “29,92017,29”).
  const numeros = tabela.match(/<t[dh] className="[^"]*text-right[^"]*"/g) ?? [];
  assert.equal(numeros.length, 8, "três colunas de número no cabeçalho, três em cada viagem e duas no total");
  for (const celula of numeros) assert.match(celula, /\bpl-2\b/, `número sem respiro à esquerda: ${celula}`);
  for (const celula of numeros.filter((c) => c.startsWith("<td"))) assert.match(celula, /whitespace-nowrap/, `número que pode quebrar no meio: ${celula}`);
  // Com menos de 360 px a coluna Valor some (cabeçalho, viagem e total) e o valor por tonelada desce para baixo do peso.
  assert.equal((tabela.match(/className="hidden [^"]*min-\[360px\]:table-cell"/g) ?? []).length, 3);
  assert.match(tabela, /<span className="block">\{toneladas\(v\.quant\)\}<\/span>\s*<span className="block [^"]*min-\[360px\]:hidden">× \{num\(v\.valor\)\}<\/span>/);
  // Na lista de pontos, o bruto e a comissão quebram como blocos inteiros: o valor nunca fica longe do rótulo.
  assert.match(tela, /<span className="inline-block">\s*Bruto <span className="font-bold text-white">\{brl\(p\.conta\.bruto\)\}<\/span> ·&nbsp;\s*<\/span>/);
  assert.match(tela, /<span className="inline-block">\s*Comissão\{varios \? ` \$\{num\(p\.porcentagem\)\}%` : ""\} <span className="font-bold text-ouro">\{brl\(p\.conta\.comissao\)\}<\/span>\s*<\/span>/);
});

/* --------------------------------- “Você vai receber”, no cartão do número */

test("o cartão do início mostra a MESMA comissão do card dos SERVIÇOS — todos os pontos somados", () => {
  const logado = { logado: true, carregado: true };
  const emDia = saldoDoInicio(resumo(), AGORA, logado);
  assert.deepEqual(emDia, { valor: brl(400.308156), temValor: true, nota: null, atencao: false, velho: false });
  const card = cartaoDoTicket(resumo(), AGORA);
  assert.equal(emDia.valor, card.modo === "numeros" ? card.comissao : "");

  // Dois pontos, cada um com a sua porcentagem: o valor é a soma dos dois (não o do ponto que está na tela).
  const dois = resumo({ porcentagem: null, totalPontos: 2, conta: { viagens: 5, bruto: 2790.94, comissao: 554.27, toneladas: 153.48 }, pontos: [ponto("A777", 3), ponto("B702", 2, { porcentagem: 22 })] });
  assert.deepEqual(saldoDoInicio(dois, AGORA, logado), { valor: brl(554.27), temValor: true, nota: null, atencao: false, velho: false });
  // A função nem recebe o ponto mostrado: o saldo não muda ao passar de um ponto para outro.
  assert.equal(saldoDoInicio.length, 3);
});

test("no cartão do início, “R$ 0,00” só aparece quando o zero é de verdade", () => {
  const logado = { logado: true, carregado: true };
  // Semana lida, nenhuma viagem: zero de verdade.
  const zero = saldoDoInicio(resumo({ conta: { viagens: 0, bruto: 0, comissao: 0, toneladas: 0 }, pontos: [ponto("A777", 0)] }), AGORA, logado);
  assert.deepEqual(zero, { valor: brl(0), temValor: true, nota: null, atencao: false, velho: false });
  assert.match(zero.valor, /^R\$\s0,00$/);

  // Todo o resto é um traço — com o que falta escrito embaixo, nas palavras do card dos SERVIÇOS.
  const traco = (r: ResumoDoTicket | null, situacao = logado) => {
    const s = saldoDoInicio(r, AGORA, situacao);
    assert.equal(s.valor, SEM_SALDO);
    assert.equal(s.temValor, false);
    assert.ok(!/\d/.test(s.valor), `“${s.valor}” parece dinheiro`);
    // O que falta fazer é dito sem alarde (cinza); âmbar fica para o que deu errado.
    assert.equal(s.atencao, false, `“${s.nota}” em cor de aviso`);
    assert.equal(s.velho, false);
    return s.nota;
  };
  const semLeitura = { semana: null, pontos: [ponto("A777", null)], completo: false, lidoEm: null, recente: false };
  assert.equal(SEM_SALDO, "R$ —");
  assert.equal(traco(resumo({ ligado: false, porcentagem: null, ...semLeitura, pontos: [] })), "Cadastre sua porcentagem");
  assert.equal(traco(resumo({ temAcesso: false, ...semLeitura })), "Falta o acesso ao portal");
  assert.equal(traco(resumo({ totalPontos: 0, ...semLeitura, pontos: [] })), "Cadastre o seu ponto");
  assert.equal(traco(resumo(semLeitura)), "Lendo o portal…");
  assert.equal(traco(resumo({ ...semLeitura, erro: "o portal pediu o login de novo" })), "Sem leitura do portal");
  assert.equal(traco(resumo({ disponivel: false })), "Leitura do Ticket desligada");
  // Visitante (sem cadastro neste aparelho, ou o servidor não reconheceu): nada de dinheiro, mesmo que sobre um resumo.
  assert.equal(traco(null, { logado: false, carregado: false }), "Entre no app para ver o seu saldo");
  assert.equal(traco(resumo(), { logado: false, carregado: true }), "Entre no app para ver o seu saldo");
  // A primeira consulta ainda não voltou: o traço, sem texto piscando.
  assert.equal(traco(null, { logado: true, carregado: false }), null);
  // Voltou sem resposta (sem rede, servidor fora): diz isso, em cor de aviso.
  assert.deepEqual(saldoDoInicio(null, AGORA, logado), { valor: SEM_SALDO, temValor: false, nota: "Não consegui carregar agora", atencao: true, velho: false });
});

test("no cartão do início, valor pela metade ou velho nunca passa por valor de agora", () => {
  const logado = { logado: true, carregado: true };
  // Falta a porcentagem de um ponto: “Falta %” no lugar do dinheiro, e de qual ponto.
  assert.deepEqual(saldoDoInicio(faltandoUma(), AGORA, logado), { valor: "Falta %", temValor: false, nota: "Cadastre a % do B702", atencao: true, velho: false });
  // Leitura antiga: o valor aparece com a hora dela.
  assert.deepEqual(saldoDoInicio(resumo({ recente: false, lidoEm: "2026-11-11T12:10:00Z" }), AGORA, logado), {
    valor: brl(400.308156),
    temValor: true,
    nota: "Lido 09:10",
    atencao: true,
    velho: true,
  });
  // Soma de parte dos pontos: o valor aparece, e a nota diz de quantos (não é aviso: os outros entram na próxima leitura).
  const parcial = resumo({ totalPontos: 3, pontos: [ponto("A777", 4), ponto("B702", null), ponto("M703", null)], completo: false });
  assert.deepEqual(saldoDoInicio(parcial, AGORA, logado), { valor: brl(400.308156), temValor: true, nota: "1 de 3 pontos", atencao: false, velho: false });
});

test("o saldo lido para um motorista nunca aparece para outro no mesmo aparelho", () => {
  const gancho = ler("src/components/consulta/useResumoDoTicket.ts");
  // O que a consulta deixou fica guardado junto com o dono; só vale para o motorista que está na tela.
  assert.match(gancho, /export function useResumoDoTicket\(ativo: boolean, intervaloMs = 60_000, dono: number \| null = null\)/);
  assert.match(gancho, /const meu = ativo && guardado\.dono === dono;/);
  assert.match(gancho, /resumo: meu \? guardado\.resumo : null,/);
  assert.match(gancho, /carregado: meu && guardado\.carregado,/);
  // A resposta que chega depois da troca de motorista é descartada (antes e depois de ler o corpo).
  assert.match(gancho, /const outro = \(\) => donoAtual\.current !== de;/);
  assert.equal((gancho.match(/if \(outro\(\)\) return;/g) ?? []).length, 2);
  // Motorista novo: consulta nova na hora (o dono está nas dependências do efeito).
  assert.match(gancho, /\}, \[ativo, carregar, intervaloMs, dono\]\);/);
  // A página do Saldo de Ganhos não muda de dono: continua chamando sem ele.
  assert.match(ler("src/components/consulta/ConsultaPontoApp.tsx"), /useResumoDoTicket\(true\)/);
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
  // A porcentagem só é salva para os pontos que ESTE motorista tem no app (a lista vem do banco, pelo id da sessão).
  const post = verbos[1];
  assert.match(post, /const codigos = await codigosDoMotorista\(m\.id\);\s+const pedido = porcentagensDoPedido\(await req\.json\(\)\.catch\(\(\) => \(\{\}\)\), codigos\);/);
  assert.match(post, /if \("erro" in pedido\) return NextResponse\.json\(\{ erro: pedido\.erro \}, \{ status: 400, headers: CAB \}\);\s+await salvarPorcentagensDoTicket\(m\.id, pedido\.porPonto\);/);
  // Nada daqui entra no portal com CPF e senha: a leitura usa a sessão guardada.
  for (const proibido of ["monitorarMotorista", "lerPortalDoMotorista", "credenciaisDoMotorista", "salvarAcessoPortal"]) {
    assert.ok(!rota.includes(proibido), `a rota dos tickets não pode chamar ${proibido}`);
  }
  const lib = ler("src/lib/portal-ticket.ts");
  for (const proibido of ["monitorarMotorista", "lerPortalDoMotorista", "credenciaisDoMotorista", "lerEGuardarPortal"]) {
    assert.ok(!lib.includes(proibido), `portal-ticket.ts não pode chamar ${proibido}`);
  }
});
