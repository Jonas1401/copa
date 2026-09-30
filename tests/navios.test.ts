import assert from "node:assert/strict";
import { test } from "node:test";
import { ehFertilizante, extremosDaMare, linhaNavio, parseLineupAppa, parseManobrasSinprapar, portoDoBerco, toneladasDe } from "../src/lib/navios";
import { eventosFertilizantes, textoPadrao } from "../src/lib/navios-aviso";
import { paginaAppa, paginaSinprapar } from "./navios-fixture";

test("fertilizantes: reconhece todos os tipos e ignora outras cargas", () => {
  for (const m of ["UREIA", "SULFATO DE AMONIO", "CLORETOS DE POTASSIO", "MAP", "DAP", "ADUBOS OU FERTILIZANTES C/NITR", "FERTILIZ.MINER.QUIM.C/NITROGEN", "NITRATO DE AMONIO", "SUPERFOSFATO TRIPLO", "NPK 04-14-08", "ROCHA FOSFATICA", "KCL GRANULADO"])
    assert.ok(ehFertilizante(m), m);
  for (const m of ["SOJA", "FARELO DE SOJA", "MILHO", "AÇÚCAR", "CONTÊINERES (CONTENTORES) INCL", "OLEO DIESEL", "ACIDO SULFURICO", "MAPA", "VEICULOS"])
    assert.ok(!ehFertilizante(m), m);
});

test("toneladas, porto e line-up da APPA", () => {
  assert.equal(toneladasDe("60.000,000 Tons."), 60000);
  assert.equal(toneladasDe("900 Movs."), null);
  assert.equal(portoDoBerco("499"), "Antonina");
  assert.equal(portoDoBerco("211"), "Paranaguá");
  const l = parseLineupAppa(paginaAppa({
    ATRACADOS: [{ "Programação": "1", "Berço": "114", "Embarcação": "ZY IDOL", IMO: "1016472", Sentido: "Imp", Mercadoria: "UREIA", "Atracação": "25/09/2026 15:54", Previsto: "32.219,000 Tons.", "Saldo Total": "16.763,000 Tons." }],
    PROGRAMADOS: [{ "Programação": "2", "Berço": "211", "Embarcação": "LEO. K", IMO: "9842736", Sentido: "Imp", Mercadoria: "MAP", ETB: "02/10/2026 08:00", Previsto: "70.000,000 Tons." }],
  }));
  assert.equal(l.length, 2, "legenda não vira navio");
  assert.deepEqual([l[0].secao, l[0].toneladas, l[0].saldoToneladas, l[0].berco], ["ATRACADOS", 32219, 16763, "114"]);
  assert.deepEqual([l[1].secao, l[1].etb, l[1].mercadoria], ["PROGRAMADOS", "02/10/2026 08:00", "MAP"]);
  assert.match(linhaNavio(l[0]), /ZY IDOL.*berço 114.*UREIA.*32\.219 t previstas.*saldo 16\.763 t.*importação/);
});

test("manobras do SINPRAPAR e marés", () => {
  const m = parseManobrasSinprapar(paginaSinprapar([
    { data: "01/10", hora: "02:00", navio: "LEO. K", manobra: "AT: F93/AZ211 BB", calado: "11,40", imo: "9842736", situacao: "CONFIRMADA" },
  ]));
  assert.equal(m.length, 1, "cabeçalho ignorado");
  assert.deepEqual([m[0].codigo, m[0].calado, m[0].situacao, m[0].descricao], ["AT", 11.4, "CONFIRMADA", "atracação (do fundeio para o berço)"]);
  const h = ["2026-10-01T00:00", "2026-10-01T01:00", "2026-10-01T02:00", "2026-10-01T03:00", "2026-10-01T04:00", "2026-10-01T05:00"];
  const x = extremosDaMare(h, [0.1, 0.5, 0.7, 0.4, -0.2, 0.0]);
  assert.deepEqual(x.map((e) => [e.tipo, e.hora.slice(11), e.alturaM]), [["preamar", "02:00", 0.7], ["baixa-mar", "04:00", -0.2]]);
});

test("eventos: programado, manobra confirmada e atracado — só fertilizantes", () => {
  const lineup = parseLineupAppa(paginaAppa({
    ATRACADOS: [{ "Programação": "1", "Berço": "114", "Embarcação": "ZY IDOL", IMO: "1", Mercadoria: "UREIA", Previsto: "32.219,000 Tons." },
                { "Programação": "9", "Berço": "204", "Embarcação": "OCEAN AZALEA", IMO: "9", Mercadoria: "AÇÚCAR" }],
    PROGRAMADOS: [{ "Programação": "2", "Berço": "211", "Embarcação": "LEO. K", IMO: "2", Mercadoria: "MAP", Previsto: "70.000,000 Tons." }],
    "AO LARGO": [{ "Programação": "3", "Berço": "200", "Embarcação": "JING LU HAI", IMO: "3", Mercadoria: "SULFATO DE AMONIO" }],
  }));
  const man = parseManobrasSinprapar(paginaSinprapar([
    { data: "01/10", hora: "02:00", navio: "LEO. K", manobra: "AT: F93/AZ211", calado: "11,40", imo: "2", situacao: "CONFIRMADA" },
    { data: "01/10", hora: "05:00", navio: "JING LU HAI", manobra: "EA: AZ200", calado: "10,00", imo: "3", situacao: "A CONFIRMAR" },
  ]));
  const ev = eventosFertilizantes(lineup, man);
  assert.deepEqual(ev.map((e) => e.chave).sort(), ["A:1", "M:2:01/10 02:00", "P:2"], "açúcar e manobra 'a confirmar' não avisam");
  const t = textoPadrao(ev.find((e) => e.tipo === "manobra")!, [{ hora: "2026-10-01T03:00", tipo: "preamar", alturaM: 0.7 }]);
  assert.match(t, /LEO\. K.*berço 211.*01\/10 às 02:00.*map \(70\.000 t\).*preamar.*03:00/);
});
