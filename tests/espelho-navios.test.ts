import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  atualizacaoSinprapar,
  emissaoAppa,
  linhasAppa,
  montarAtracados,
  montarManobras,
  montarPainelEspelho,
  painelReferencia,
  mapaDeCargas,
} from "../src/lib/espelho-navios";
import { paginaAppa, paginaSinprapar } from "./navios-fixture";

const ler = (p: string) => readFileSync(p, "utf8");
const td = (c: string[]) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`;
const th = (c: string[]) => `<tr>${c.map((x) => `<th>${x}</th>`).join("")}</tr>`;

/** Mesmo formato da APPA: 22 colunas em ATRACADOS e 13 na linha rowspan. */
const CAB_ATRACADOS = [
  "", "Programação", "DUV", "Berço", "Embarcação", "IMO", "LOA", "DWT", "Bordo",
  "Sentido", "Agência", "Operador", "Mercadoria", "Atracação", "Chegada",
  "Janela Operacional", "Prancha (t/dia)", "Tons/Dia", "Previsto", "Realizado",
  "Saldo Operador", "Saldo Total",
];

function paginaAtracados(): string {
  const principal = (item: string, prog: string, berco: string, nome: string, imo: string, mercadoria: string, previsto: string, saldoOp: string, saldoTotal: string) => {
    const c = [item, prog, "0445422026", berco, nome, imo, "189,99", "37.009,00", "BE", "Imp", "ORION", "ROCHA TERMINAIS PORTUARIOS E LOGISTICA S.A.", mercadoria, "07/11/2026 01:20", "05/11/2026 06:36", "", "6.500,000", "996,000 Tons.", previsto, "996,000 Tons.", saldoOp, saldoTotal];
    return td(c);
  };
  return `<html><body><table>
    ${th(["ATRACADOS"])}
    ${th(CAB_ATRACADOS)}
    ${principal("1", "80596", "215", "NC BRUMA", "9612777", "CONTÊINERES (CONTENTORES) INCL", "1.050 Movs.", "1.050 Movs.", "1.050 Movs.")}
    ${principal("2", "80974", "208", "GULLWING", "9595981", "UREIA", "19.800,000 Tons.", "18.803,660 Tons.", "18.803,660 Tons.")}
    ${principal("8", "80875", "209", "KOSMAN", "9630731", "CLORETOS DE POTASSIO", "19.588,000 Tons.", "4.319,160 Tons.", "12.960,920 Tons.")}
    ${td(["BB", "Imp", "ZPORT", "ROCHA TERMINAIS PORTUARIOS E LOGISTICA S.A.", "CLORETOS DE POTASSIO", "05/11/2026 18:10", "31/10/2026 09:00", "05/11/2026 18:10 - 12/11/2026 14:27", "4.962,376", "17.773,000 Tons.", "32.000,000 Tons.", "23.358,000 Tons.", "8.641,760 Tons."])}
    ${principal("4", "80939", "204", "IOLCOS LEGACY", "9425136", "AÇÚCAR", "77.000,000 Tons.", "22.765,350 Tons.", "22.765,350 Tons.")}
  </table>${paginaAppa({
    PROGRAMADOS: [
      { "Programação": "10", "Berço": "211", "Embarcação": "OSLEEN", IMO: "9278739", Mercadoria: "UREIA", Previsto: "26.399,000 Tons." },
      { "Programação": "8", "Berço": "200", "Embarcação": "PITT ISLAND", IMO: "9615157", Mercadoria: "ADUBOS OU FERTILIZANTES C/NITR", Previsto: "10.690,000 Tons." },
      { "Programação": "9", "Berço": "214", "Embarcação": "GEORGE H", IMO: "9842255", Mercadoria: "FARELO DE SOJA", Previsto: "68.000,000 Tons." },
    ],
  })}</body></html>`;
}

function paginaManobras(): string {
  return paginaSinprapar([
    { data: "07/11", hora: "13:55", navio: "PITT ISLAND", manobra: "EA: FOSPAR EXT BB", calado: "8,90", imo: "9615157", situacao: "EM ANDAMENTO" },
    { data: "07/11", hora: "18:00", navio: "OSLEEN", manobra: "EF:", calado: "10,20", imo: "9278739", situacao: "A CONFIRMAR" },
    { data: "09/11", hora: "18:00", navio: "GULLWING", manobra: "DS: AZ08 BE", calado: "0,00", imo: "9595981", situacao: "PREVISTA" },
    { data: "09/11", hora: "21:30", navio: "GEORGE H", manobra: "DS: AZ14 BB", calado: "12,45", imo: "9842255", situacao: "PREVISTA" },
  ]);
}

test("cópia do COPALINKS lê exatamente as duas fontes e só mostra fertilizantes", () => {
  const fonte = ler("src/lib/espelho-navios.ts");
  assert.ok(fonte.includes("URL_LINEUP") && fonte.includes("URL_MANOBRAS"), "sem as 2 fontes oficiais");
  assert.ok(!/https?:\/\//.test(fonte.slice(fonte.indexOf("const CABECALHOS"))), "URL extra inventada no módulo");

  const linhas = linhasAppa(paginaAtracados());
  const atracados = montarAtracados(linhas);
  assert.deepEqual(atracados.map((a) => a.nome).sort(), ["GULLWING", "KOSMAN"], "contêiner e açúcar não podem entrar");
  const gullwing = atracados.find((a) => a.nome === "GULLWING")!;
  assert.equal(gullwing.operadoras.length, 1);
  assert.equal(gullwing.saldoTotal, "18.803,660 Tons.");
  assert.equal(gullwing.descarregado, 5, "5% descarregado, como na referência");

  const kosman = atracados.find((a) => a.nome === "KOSMAN")!;
  assert.equal(kosman.operadoras.length, 2, "linha rowspan da APPA vira a 2ª operadora");
  assert.equal(kosman.operadoras[1].nome, "ROCHA TERMINAIS PORTUARIOS E LOGISTICA S.A.");
  assert.equal(kosman.operadoras[1].saldo, "8.641,760 Tons.");
  assert.equal(kosman.saldoTotal, "12.960,920 Tons.");
  assert.equal(kosman.descarregado, 75, "75% descarregado, como na referência");
  assert.equal(gullwing.porto, "PARANAGUÁ");
});

test("manobras: cruza SINPRAPAR com a carga da APPA e mantém código, berço e explicação", () => {
  const linhas = linhasAppa(paginaAtracados());
  const atracados = montarAtracados(linhas);
  const manobras = montarManobras(paginaManobras(), mapaDeCargas(linhas), atracados);
  assert.deepEqual(manobras.map((m) => m.nome), ["PITT ISLAND", "OSLEEN", "GULLWING"], "navio de soja fica de fora");
  assert.equal(manobras[0].mercadoria, "ADUBOS OU FERTILIZANTES C/NITR");
  assert.equal(manobras[0].acao, "Atracar");
  assert.equal(manobras[0].estado, "Em manobra");
  assert.equal(manobras[0].linha, "07/11 13:55·EA— Entrada e Atracação: FOSPAR EXT BB");
  assert.match(manobras[0].explicacao, /encosta no berço/);
  assert.equal(manobras[1].linha, "07/11 18:00·EF— Entrada e Fundeio");
  assert.equal(manobras[2].acao, "Desatracar");
  assert.equal(manobras[2].estado, "Atracado");
  assert.equal(manobras[2].linha, "09/11 18:00·DS— Desatracação e Saída: AZ08 BE");
});

test("carimbos das fontes e modo ao vivo / parcial / referência", () => {
  const appa = `<html>Emissão: 07/11/2026 14:16<br>Período selecionado: 07/11/2026 14:05${paginaAtracados()}</html>`;
  const sin = `<html>Última Atualização : 07/11/2026 14:10${paginaManobras()}</html>`;
  assert.equal(emissaoAppa(appa), "07/11/2026 14:16");
  assert.equal(atualizacaoSinprapar(sin), "07/11/2026 14:10");

  const vivo = montarPainelEspelho({ appaHtml: appa, sinpraparHtml: sin }, Date.UTC(2026, 10, 7, 17, 20));
  assert.equal(vivo.modo, "ao-vivo");
  assert.deepEqual(vivo.fontes.map((f) => f.estado), ["ao-vivo", "ao-vivo"]);
  assert.equal(vivo.atracados.length, 2);
  assert.equal(vivo.manobras.length, 3);
  assert.equal(vivo.aviso, null);

  const parcial = montarPainelEspelho({ appaHtml: appa, sinpraparErro: "timeout" });
  assert.equal(parcial.modo, "parcial");
  assert.equal(parcial.fontes[1].estado, "referencia");
  assert.equal(parcial.manobras.length, 11, "manobras preservadas da última leitura gravada");

  const referencia = montarPainelEspelho({ appaErro: "offline", sinpraparErro: "offline" });
  assert.equal(referencia.modo, "referencia");
  assert.equal(referencia.atracados.length, 3);
  assert.equal(referencia.manobras.length, 11);
  assert.match(referencia.aviso ?? "", /Sem conexão/);
  assert.equal(painelReferencia().aviso, "Conectando às fontes oficiais…");
});

test("acesso pela aba Sobre, pelo próprio ícone e rotas da cópia idêntica", () => {
  const sobre = ler("src/components/MonitorApp.tsx");
  assert.ok(sobre.includes('href="/navios"'), "aba Sobre sem link para a cópia");
  assert.ok(sobre.includes('href="/navios/sinprapar"'), "aba Sobre sem link para as manobras");
  assert.match(sobre, /cópia idêntica/i);

  const nav = ler("src/components/inicio/NavInferior.tsx");
  assert.ok(nav.includes('href="/navios"'), "ícone Sobre sem atalho direto para a cópia");
  assert.match(nav, /cópia do COPALINKS/i);

  const tela = ler("src/components/espelho/EspelhoNaviosApp.tsx");
  assert.match(tela, /SINPRAPAR\s*<\/h1>/, "cabeçalho SINPRAPAR diferente da referência");
  assert.ok(tela.includes("Manobras previstas — fertilizantes"));
  assert.ok(tela.includes("Navios Atracados</h1>"), "título acessível da tela inicial ausente");

  assert.ok(ler("src/app/navios/page.tsx").includes('vista="atracados"'));
  assert.ok(ler("src/app/navios/sinprapar/page.tsx").includes('vista="manobras"'));
  assert.ok(ler("src/app/api/navios/espelho/route.ts").includes("lerPainelEspelho"));
  assert.ok(ler("src/app/sinprapar/page.tsx").includes("/navios/sinprapar"));
});
