import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LETRA_DA_SEGUNDA_LINHA,
  SELO,
  SEM_RESPOSTA_MS,
  VAO_NUMERO_SELO,
  VAO_NUMERO_SELO_VW,
  larguraDoCodigoEm,
  larguraDoSaldoEm,
  letraDoCodigoVw,
  letraDoSaldo,
  letraDoSaldoPx,
  letraDoSeloPx,
  medidasDoSelo,
  monitorEmDia,
} from "../src/lib/cartao-inicio";

/**
 * O CARTÃO DO NÚMERO na tela inicial (11/11/2026): o quadro do ponto, o número
 * com o selo do status AO LADO, uma linha fina e o saldo (“Você vai receber”).
 * Os dois quadros da fila (TRUCK e CAVALO/C) viraram dois cartões, embaixo.
 * A faixa “Último escalado” saiu; “Atualizado há… · ONLINE” só aparece quando
 * há o que avisar.
 *
 * Aqui: as contas de tamanho (o selo cabe sempre ao lado do número; o dinheiro
 * cabe sempre inteiro numa linha) e a montagem da tela. Sem rede e sem banco.
 */

const ler = (p: string) => readFileSync(p, "utf8");
const TELA = ler("src/components/MonitorApp.tsx");
/** Do começo do cartão do número até o fim dele. */
const INICIO_DO_CARTAO = TELA.indexOf('data-cartao="numero"');
const FIM_DO_CARTAO = TELA.indexOf("</motion.section>", INICIO_DO_CARTAO);
const CARTAO = TELA.slice(INICIO_DO_CARTAO, FIM_DO_CARTAO);

/** Larguras de tela, em px: do celular mais estreito que o app atende (320) ao teto da coluna (768). */
const LARGURAS = [320, 340, 360, 375, 393, 412, 430, 480, 600, 768];
/** O que sobra para o número, o vão e o selo: a tela menos margens (24), bordas (2), folgas do cartão (24) e o recuo do número (8). */
const linhaDoNumero = (largura: number) => largura - 58;
/** O que sobra para o valor: a tela menos margens, bordas, folgas do cartão e o recuo do valor (11). */
const linhaDoSaldo = (largura: number) => largura - 61;

/** A largura do número na tela, com os mesmos limites das classes dele. */
const numeroPx = (codigo: string, largura: number) => {
  const [min, max] = codigo.length > 3 ? [50, 66] : [64, 92];
  return larguraDoCodigoEm(codigo) * Math.max(min, Math.min((letraDoCodigoVw(codigo) * largura) / 100, max));
};

test("a largura do número bate com a medida na fonte do app (Archivo 900, letras apertadas em 0,04 em)", () => {
  // Medido no Chromium, a 100 px: A32 = 199,2 · A196 = 261,9 · A6 = 136,5 · B171 = 261,9 · M100 = 281,3 · M88 = 218,6.
  const medidas: [string, number][] = [["A32", 1.992], ["A196", 2.619], ["A6", 1.365], ["B171", 2.619], ["M100", 2.813], ["M88", 2.186], ["A888", 2.619]];
  for (const [codigo, em] of medidas) assert.ok(Math.abs(larguraDoCodigoEm(codigo) - em) < 0.012, `${codigo}: ${larguraDoCodigoEm(codigo)} ≠ ${em}`);
  // Letra de um livro que ainda não existe conta como a mais larga (nunca de menos).
  assert.ok(larguraDoCodigoEm("W32") >= larguraDoCodigoEm("M32"));
  // O tamanho da letra é o das classes do número: 21,5vw até 3 caracteres, 15,5vw com 4.
  assert.equal(letraDoCodigoVw("A32"), 21.5);
  assert.equal(letraDoCodigoVw("A196"), 15.5);
  assert.match(CARTAO, /alvo && alvo\.codigo\.length > 3\s+\? "text-\[clamp\(50px,15\.5vw,66px\)\]"\s+: "text-\[clamp\(64px,21\.5vw,92px\)\]"/);
});

test("na tela de 412 px o selo tem o tamanho do desenho: 17 px, ao lado do A32", () => {
  const m = medidasDoSelo("A32", "ESCALADO");
  assert.deepEqual(m.linhas, ["ESCALADO"]);
  const letra = letraDoSeloPx(m, 412);
  assert.ok(Math.abs(letra - 17.1) < 0.05, `letra de ${letra} px`);
  // O selo do desenho tem uns 154 px: folga, bolinha, vão, “ESCALADO”, folga.
  const selo = (m.seloEm / 1.02) * letra + 2;
  assert.ok(Math.abs(selo - 154) < 2, `selo de ${selo} px`);
  // E é esse o tamanho que vai para a tela (a mesma conta, escrita em CSS).
  assert.equal(m.letra, "clamp(9px, min(4.15vw, calc((53.772vw - 62px) / 9.068)), 18px)");
  assert.deepEqual(SELO, { folga: 0.82, bolinha: 0.8, vao: 0.78 });
  assert.equal(VAO_NUMERO_SELO, "min(3.4vw, 15px)");
});

test("o selo cabe SEMPRE ao lado do número — em qualquer tela, com qualquer ponto e qualquer status do app", () => {
  const codigos = ["A6", "A32", "A99", "A196", "A888", "B22", "B171", "M88", "M100", "M888"];
  const estados: [string, string | null][] = [
    ["ATIVO", "0 na frente"],
    ["ATIVO", "154 na frente"],
    ["ATIVO", "sem leitura da fila"],
    ["ATIVO", "Varrendo…"],
    ["ATIVO", null],
    ["NA VEZ", null],
    ["SAIU", null],
    ["DISPENSA", null],
    ["ESCALADO", null],
    ["EM ATENDIMENTO", null],
    ["AGUARDANDO", null],
  ];
  let menor = Infinity;
  for (const largura of LARGURAS) {
    for (const codigo of codigos) {
      for (const [status, segunda] of estados) {
        const m = medidasDoSelo(codigo, status, segunda);
        const letra = letraDoSeloPx(m, largura);
        menor = Math.min(menor, letra);
        // A largura de verdade do selo (sem a sobra de 2% da conta), com a borda.
        const selo = (m.seloEm / 1.02) * letra + 2;
        const vao = Math.min((VAO_NUMERO_SELO_VW * largura) / 100, 15);
        const sobra = linhaDoNumero(largura) - numeroPx(codigo, largura) - vao - selo;
        assert.ok(sobra >= 0, `${largura} px, ${codigo}, ${status} ${segunda ?? ""}: faltam ${(-sobra).toFixed(1)} px (letra de ${letra.toFixed(1)} px)`);
        // Nunca maior do que o desenho.
        assert.ok(letra <= 18);
      }
    }
  }
  // A letra só chega ao piso (9 px) no pior caso de todos: tela de 320 px, livro M, “EM ATENDIMENTO”.
  assert.equal(menor, 9);
  assert.ok(letraDoSeloPx(medidasDoSelo("A32", "ESCALADO"), 360) > 14);
  assert.ok(letraDoSeloPx(medidasDoSelo("A32", "ATIVO", "12 na frente"), 320) > 13);
});

test("status comprido de várias palavras quebra DENTRO do selo; os outros ficam numa linha", () => {
  assert.deepEqual(medidasDoSelo("A32", "EM ATENDIMENTO").linhas, ["EM", "ATENDIMENTO"]);
  assert.deepEqual(medidasDoSelo("A32", "NA VEZ").linhas, ["NA VEZ"]);
  assert.deepEqual(medidasDoSelo("A32", "  dispensa ").linhas, ["DISPENSA"]);
  // A conta usa a palavra mais comprida — e a linha de baixo, quando ela é a mais larga.
  assert.equal(medidasDoSelo("A32", "EM ATENDIMENTO").textoEm, 7.48);
  assert.equal(medidasDoSelo("A32", "ATIVO").textoEm, 3.06);
  // Numa linha só, a conta é a do texto inteiro (as duas palavras e o espaço): “NA VEZ” = 1,45 + 0,24 + 2,02.
  assert.equal(medidasDoSelo("A32", "NA VEZ").textoEm, 3.71);
  assert.equal(medidasDoSelo("A32", "ATIVO", "sem leitura da fila").textoEm, 5.82);
  assert.ok(medidasDoSelo("A32", "ATIVO", "154 na frente").textoEm > medidasDoSelo("A32", "ATIVO", "2 na frente").textoEm);
  // Status que o app ainda não conhece: cada letra conta como larga (o selo encolhe; nunca estoura).
  const novo = medidasDoSelo("A32", "BLOQUEADO");
  assert.ok(novo.textoEm > medidasDoSelo("A32", "ESCALADO").textoEm);
  assert.equal(LETRA_DA_SEGUNDA_LINHA, 0.676);
});

test("a tela: o selo fica no MESMO botão do número, com a letra calculada", () => {
  // Entre o número e o selo não fecha botão nenhum: os dois são irmãos na mesma linha.
  const doNumeroAoSelo = CARTAO.slice(CARTAO.indexOf("data-numero"), CARTAO.indexOf("data-selo"));
  assert.ok(doNumeroAoSelo.length > 0 && !doNumeroAoSelo.includes("</button>"));
  assert.match(CARTAO, /style=\{\{ columnGap: VAO_NUMERO_SELO \}\}/);
  assert.match(CARTAO, /fontSize: selo\.letra,/);
  assert.match(CARTAO, /gap: `\$\{SELO\.vao\}em`,/);
  assert.match(CARTAO, /paddingInline: `\$\{SELO\.folga\}em`,/);
  assert.match(CARTAO, /<Led cor=\{corLedAlvo\} pulsante tamanho=\{`\$\{SELO\.bolinha\}em`\} \/>/);
  assert.match(TELA, /const selo = alvo \? medidasDoSelo\(alvo\.codigo, textoDoSelo, segundaLinhaDoSelo\) : null;/);
  // Se um dia não couber (fonte de reserva mais larga), o selo desce inteiro — nunca é cortado.
  assert.match(CARTAO, /className="flex w-full flex-wrap items-center gap-y-2 pl-2 text-left"/);
  // “N na frente” continua embaixo de ATIVO.
  assert.match(TELA, /\? `\$\{alvo\.naFrente\} na frente`/);
  assert.match(CARTAO, /\{segundaLinhaDoSelo\}/);
  // O número ficou logo abaixo do rótulo (era `mt-5`).
  assert.ok(!/className="mt-5"/.test(CARTAO));
});

test("a largura do valor bate com a medida na fonte do app (Archivo 900)", () => {
  // Medido no Chromium, em “em”: R$ 0,00 = 3,903 · R$ 1.234,56 = 6,237 · R$ 88.888,88 = 6,904 · R$ 888.888,88 = 7,571.
  const medidas: [string, number][] = [["R$ 0,00", 3.903], ["R$ 1.234,56", 6.237], ["R$ 88.888,88", 6.904], ["R$ 888.888,88", 7.571]];
  for (const [valor, em] of medidas) assert.ok(Math.abs(larguraDoSaldoEm(valor) - em) < 0.01, `${valor}: ${larguraDoSaldoEm(valor)} ≠ ${em}`);
  // “Falta %” (3,90 em) e “R$ —” (2,57 em) contam como o “R$ 0,00”: nunca de menos.
  assert.equal(larguraDoSaldoEm("Falta %"), 4);
  assert.equal(larguraDoSaldoEm("R$ —"), 4);
  // O espaço do “R$” pode vir como espaço comum ou espaço duro (o `Intl` usa o duro).
  assert.equal(larguraDoSaldoEm("R$\u00a00,00"), larguraDoSaldoEm("R$ 0,00"));
  // Texto comprido fora do formato (não deveria existir): conta de sobra, para encolher em vez de sair do cartão.
  assert.ok(larguraDoSaldoEm("-R$ 12.345,67") > larguraDoSaldoEm("R$ 12.345,67"));
  assert.ok(larguraDoSaldoEm("Sem leitura do portal") > 14);
});

test("o dinheiro cabe SEMPRE inteiro numa linha — e, enquanto cabe, tem o tamanho do desenho", () => {
  // Na tela de 412 px: 12vw ≈ 49 px, o mesmo “Você vai receber” do Cálculo de Frete.
  assert.ok(Math.abs(letraDoSaldoPx("R$ 0,00", 412) - 49.44) < 0.01);
  assert.equal(letraDoSaldo("R$ 0,00"), "clamp(28px, min(12vw, calc((100vw - 72px) / 3.904)), 54px)");
  assert.match(ler("src/components/frete/FreteApp.tsx"), /text-\[clamp\(38px,12vw,54px\)\]/);
  const valores = ["R$ 0,00", "R$ 9,99", "R$ 507,92", "R$ 1.234,56", "R$ 12.345,67", "R$ 99.999,99", "R$ 888.888,88", "Falta %", "R$ —"];
  for (const largura of LARGURAS) {
    for (const valor of valores) {
      const letra = letraDoSaldoPx(valor, largura);
      const sobra = linhaDoSaldo(largura) - letra * larguraDoSaldoEm(valor);
      assert.ok(sobra >= 0, `${largura} px, ${valor}: faltam ${(-sobra).toFixed(1)} px (letra de ${letra.toFixed(1)} px)`);
      assert.ok(letra >= 28 && letra <= 54);
    }
    // Até R$ 9.999,99 o valor nunca encolhe: é sempre o tamanho do desenho.
    for (const valor of ["R$ 0,00", "R$ 507,92", "R$ 9.999,99"]) assert.equal(letraDoSaldoPx(valor, largura), Math.min(54, (12 * largura) / 100));
  }
  // Valor maior encolhe só o que precisa.
  assert.ok(letraDoSaldoPx("R$ 12.345,67", 412) > 49);
  assert.ok(letraDoSaldoPx("R$ 888.888,88", 360) > 37);
});

test("a tela: “Você vai receber” fica dentro do cartão do número, abre o Saldo de Ganhos e nunca corta o dinheiro", () => {
  const saldo = CARTAO.slice(CARTAO.indexOf("<Link"), CARTAO.indexOf("</Link>"));
  assert.match(saldo, /href="\/consulta-ponto"/);
  assert.match(saldo, /data-saldo\b/);
  assert.match(saldo, /<Wallet size=\{24\} strokeWidth=\{2\} className="shrink-0 text-ouro" aria-hidden \/>\s+Você vai receber/);
  // Uma linha fina separa o número do saldo.
  assert.match(saldo, /block border-t border-\[#183341\]/);
  // O valor: numa linha só, com a letra calculada; nada de “…”, nada escondido.
  assert.match(saldo, /style=\{\{ fontSize: letraDoSaldo\(saldo\.valor\) \}\}/);
  assert.match(saldo, /whitespace-nowrap/);
  assert.ok(!/\btruncate\b|line-clamp|text-ellipsis|overflow-hidden/.test(saldo), "o saldo não pode ser cortado");
  // Dinheiro em ouro; “Falta %” em âmbar (não é dinheiro); o traço, apagado. Leitura antiga, mais apagada.
  assert.match(saldo, /saldo\.temValor \? "text-ouro" : saldo\.valor === FALTA_PORCENTAGEM \? "text-ambar" : "text-ouro\/45"/);
  assert.match(saldo, /\$\{saldo\.velho \? "opacity-70" : ""\}/);
  // A linha miúda só existe quando há o que dizer.
  assert.match(saldo, /\{saldo\.nota && \(/);
  assert.match(saldo, /saldo\.atencao \? "text-ambar" : "text-gelo\/70"/);
  // O valor vem do Saldo de Ganhos (todos os pontos) — a conta não recebe o ponto que está na tela.
  assert.match(TELA, /const saldo = saldoDoInicio\(ticket\.resumo, ticket\.agora, \{\s+logado: Boolean\(motorista\) && !ticket\.naoLogado,\s+carregado: ticket\.carregado,\s+\}\);/);
});

test("a tela: a faixa “Último escalado” saiu, e os dois quadros da fila são dois cartões embaixo do cartão do número", () => {
  assert.ok(!/Último escalado/.test(TELA), "a faixa “Último escalado” ainda está na tela inicial");
  assert.ok(!/ultimoEscalado|ultimoQuando|haQuanto/.test(TELA));
  // Dentro do cartão do número não há quadro da fila.
  assert.ok(!CARTAO.includes("<FaixaInfo"));
  const depois = TELA.slice(FIM_DO_CARTAO);
  const faixas = [...depois.matchAll(/<FaixaInfo\s+faixa="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(faixas, ["truck", "cavalo"]);
  assert.equal((TELA.match(/<FaixaInfo\b/g) ?? []).length, 2);
  // Cada quadro é um cartão com a mesma moldura do cartão do número, 14 px abaixo dele e 13 px um do outro.
  const faixa = TELA.slice(TELA.indexOf("function FaixaInfo("), TELA.indexOf("function LinhaDaLeitura("));
  assert.match(faixa, /data-faixa=\{faixa\}/);
  assert.match(faixa, /className="cartao-monitor flex min-h-\[67px\] w-full items-center /);
  // As medidas do desenho valem na tela de 412 px (anel de 48, vãos de 15, letras de 14,5 e 13, número de 33);
  // em tela estreita encolhem juntas, para o texto não encostar no número.
  for (const medida of ["gap-[clamp(10px,3.64vw,15px)]", "h-[clamp(40px,11.65vw,48px)]", "text-[clamp(13px,3.52vw,14.5px)]", "text-[clamp(11.5px,3.16vw,13px)]", "text-[clamp(26px,8.1vw,35px)]"]) {
    assert.ok(faixa.includes(medida), `o quadro da fila sem ${medida}`);
  }
  const em412 = (vw: number) => (vw * 412) / 100;
  assert.ok(Math.abs(em412(3.64) - 15) < 0.05 && Math.abs(em412(11.65) - 48) < 0.05 && Math.abs(em412(3.52) - 14.5) < 0.05 && Math.abs(em412(3.16) - 13) < 0.05);
  assert.match(depois, /<div className="mt-3\.5 flex flex-col gap-\[13px\]">\s+<FaixaInfo/);
  // O “último escalado” de cada quadro continua na linha de baixo dele (vem de `cardDaFila`).
  assert.match(depois, /sub=\{cardFila\.truck\.sub\}/);
  assert.match(depois, /sub=\{cardFila\.cavalo\.sub\}/);
  assert.match(depois, /valor=\{cardFila\.truck\.valor\}/);
  assert.match(depois, /valor=\{cardFila\.cavalo\.valor\}/);
});

test("a leitura do monitor só aparece quando há o que avisar", () => {
  assert.equal(SEM_RESPOSTA_MS, 60_000);
  // Em dia: há leitura, o servidor está lendo o site e este aparelho recebeu resposta há pouco.
  assert.equal(monitorEmDia({ temLeitura: true, online: true }, 0), true);
  assert.equal(monitorEmDia({ temLeitura: true, online: true }, 60_000), true);
  assert.equal(monitorEmDia({ online: true }, 5_000), true);
  // Sem a 1ª leitura; o servidor sem ler o site (ou com leitura velha); o aparelho sem resposta há mais de 1 minuto.
  assert.equal(monitorEmDia({ temLeitura: false, online: true }, 0), false);
  assert.equal(monitorEmDia({ temLeitura: true, online: false }, 0), false);
  assert.equal(monitorEmDia({ temLeitura: true, online: true }, 60_001), false);

  // Na tela: fora do cartão do número…
  assert.ok(!/Atualizado há|ONLINE|OFFLINE|linhaDaLeitura/.test(CARTAO), "o rodapé “Atualizado há… · ONLINE” voltou para dentro do cartão");
  // …embaixo dos quadros da fila, só com aviso (e nunca duas vezes: com o painel aberto ela está lá dentro).
  assert.match(TELA, /\{avisarLeitura && !expandido && <div className="mt-2\.5">\{linhaDaLeitura\}<\/div>\}/);
  assert.match(TELA, /\{blocoSeusPontos\}\s+\{\/\* a leitura do monitor e o botão de reler ficam aqui dentro \*\/\}\s+\{linhaDaLeitura\}/);
  assert.equal((TELA.match(/\{linhaDaLeitura\}/g) ?? []).length, 2);
  // Ao abrir o app o aviso espera a 1ª resposta (ou 8 s): não pisca toda vez.
  assert.match(TELA, /const leituraEmDia = monitorEmDia\(\{ temLeitura: estado\.temLeitura, online: quadroEmDia \}, semRespostaMs\);/);
  // Cada livro tem a sua leitura: a linha fala do livro do ponto que está na tela.
  assert.match(TELA, /const leituraDoQuadro = cardFila\.lidoEm \?\? estado\.atualizadoEm;/);
  assert.match(TELA, /const quadroEmDia = estado\.online && !cardFila\.velha;/);
  assert.match(TELA, /const semConexao = estado\.temLeitura !== false && quadroEmDia && !leituraEmDia;/);
  assert.match(TELA, /`Atualizado há \$\{decorrido\(leituraDoQuadro, agora \+ desvioRelogio\)\}`/);
  assert.match(TELA, /`Última leitura real da fila: \$\{hora\(leituraDoQuadro\)\}`/);
  assert.ok(!/decorrido\(estado\.atualizadoEm|hora\(estado\.atualizadoEm/.test(TELA), "a hora geral (a mais antiga entre os livros) não vai mais direto para a tela");
  assert.match(TELA, /const avisarLeitura = !leituraEmDia && \(respondeu \|\| semRespostaMs > 8000\);/);
  // O tempo sem resposta só conta com a tela aberta (voltando do segundo plano, cada volta vale no máximo 2 s)…
  assert.match(TELA, /const passo = Math\.min\(Math\.max\(0, agoraMs - anterior\), 2000\);/);
  assert.match(TELA, /setSemRespostaMs\(\(ms\) => ms \+ passo\);/);
  // …e zera a cada resposta do monitor (a varredura de 5 s e o botão de reler).
  assert.equal((TELA.match(/setSemRespostaMs\(0\);/g) ?? []).length, 2);
  // Os textos de sempre, e o botão continua relendo o monitor.
  assert.match(TELA, /selo=\{leituraEmDia \? "ONLINE" : semConexao \? "SEM CONEXÃO" : "OFFLINE"\}/);
  assert.match(TELA, /\? "Aguardando 1ª leitura"\s+: `Atualizado há \$\{decorrido\(leituraDoQuadro, agora \+ desvioRelogio\)\}`/);
  assert.match(TELA, /onReler=\{atualizar\}/);
});

test("o painel de cadastrar ponto abre logo abaixo do cartão do número, antes dos quadros da fila", () => {
  const fimDoCartao = FIM_DO_CARTAO;
  const painel = TELA.indexOf("{expandido && (", fimDoCartao);
  const quadros = TELA.indexOf('<FaixaInfo', fimDoCartao);
  const servicos = TELA.indexOf("<Servicos ", fimDoCartao);
  assert.ok(fimDoCartao > 0 && painel > fimDoCartao && quadros > painel && servicos > quadros);
  // O aviso de saída (acesso ao portal) fica depois dos quadros, antes dos SERVIÇOS.
  const chamada = TELA.indexOf("{chamadaPortal && (", fimDoCartao);
  assert.ok(chamada > quadros && chamada < servicos);
});
