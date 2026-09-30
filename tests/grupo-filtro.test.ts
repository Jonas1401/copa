import assert from "node:assert/strict";
import { test } from "node:test";
import { analisarMensagemGrupo, lerCodigo } from "../src/lib/grupo-filtro";

test("PONTOS NA VEZ: reconhece todos os códigos da lista (exemplo do grupo)", () => {
  const r = analisarMensagemGrupo(
    "PONTOS NA VEZ\n\nCARRETAS TRUCADAS (A):\nA014 - A016 - A017 - A018 - A019 - A021 - A023 - A024...",
  );
  assert.deepEqual(r.naVez, ["A014", "A016", "A017", "A018", "A019", "A021", "A023", "A024"]);
  assert.deepEqual(r.pulados, []);
});

test("TRUCADAS PULADAS: códigos vão para a lista de pulados", () => {
  const r = analisarMensagemGrupo("TRUCADAS PULADAS:\n\nA137 - A140 - A144 - A146 - A147...");
  assert.deepEqual(r.pulados, ["A137", "A140", "A144", "A146", "A147"]);
  assert.deepEqual(r.naVez, []);
});

test("mensagem com as duas listas separa cada código na lista certa", () => {
  const r = analisarMensagemGrupo([
    "*PONTOS NA VEZ*",
    "CARRETAS TRUCADAS (A):",
    "A014 - A016 - A021",
    "A023 - A024",
    "",
    "TRUCADAS PULADAS: A137 - A140",
    "A144 - A146",
    "CARRETAS LS (B):",
    "B010 - B011",
  ].join("\n"));
  assert.deepEqual(r.naVez, ["A014", "A016", "A021", "A023", "A024", "B010", "B011"]);
  assert.deepEqual(r.pulados, ["A137", "A140", "A144", "A146"]);
});

test("mesmo tudo numa linha só, cada código fica com o cabeçalho anterior a ele", () => {
  const r = analisarMensagemGrupo("PONTOS NA VEZ: A014 - A016 TRUCADAS PULADAS: A137 - A140");
  assert.deepEqual(r.naVez, ["A014", "A016"]);
  assert.deepEqual(r.pulados, ["A137", "A140"]);
});

test("código completo: A14≠A140, A19≠A190, A01≠A014 (só vale letra + 3 dígitos)", () => {
  const r = analisarMensagemGrupo("PONTOS NA VEZ\nA140 - A190 - A014");
  assert.deepEqual(r.naVez, ["A140", "A190", "A014"]);
  assert.ok(!r.naVez.includes("A019"), "A190 não vira A019");
  assert.deepEqual(lerCodigo("A140"), { livro: "A", numero: 140 });
  assert.deepEqual(lerCodigo("A014"), { livro: "A", numero: 14 });
  assert.notDeepEqual(lerCodigo("A140"), lerCodigo("A014"));
  // Formatos incompletos ou colados não são aceitos como código.
  assert.deepEqual(analisarMensagemGrupo("PONTOS NA VEZ\nA14 - A01 - A0145 - AA014 - A014B - ABC1234").naVez, []);
  assert.equal(lerCodigo("A14"), null);
  assert.equal(lerCodigo("A000"), null);
});

test("reconhece A001…A199 e dezenas de códigos numa mensagem só", () => {
  const todos = Array.from({ length: 199 }, (_, i) => `A${String(i + 1).padStart(3, "0")}`);
  const r = analisarMensagemGrupo(`PONTOS NA VEZ\nCARRETAS TRUCADAS (A):\n${todos.join(" - ")}`);
  assert.equal(r.naVez.length, 199);
  for (const c of ["A001", "A002", "A014", "A021", "A059", "A134", "A190", "A199"]) assert.ok(r.naVez.includes(c), c);
});

test("mensagem comum do grupo (sem PONTOS NA VEZ nem PULADAS) não gera aviso", () => {
  const r = analisarMensagemGrupo("Bom dia! Motorista do A014 favor comparecer na balança.");
  assert.deepEqual(r, { naVez: [], pulados: [] });
  assert.deepEqual(analisarMensagemGrupo(""), { naVez: [], pulados: [] });
  assert.deepEqual(analisarMensagemGrupo(undefined), { naVez: [], pulados: [] });
});

test("conversa com a palavra 'pulado' não gera 'Ponto pulado' (só título de lista vale)", () => {
  for (const texto of ["Fui pulado de novo, sou o A014", "Pulado o A021? alguém sabe", "A137 foi pulado ontem?"]) {
    assert.deepEqual(analisarMensagemGrupo(texto), { naVez: [], pulados: [] }, texto);
  }
  // Títulos de lista continuam valendo.
  assert.deepEqual(analisarMensagemGrupo("*TRUCADAS PULADAS:*\nA137").pulados, ["A137"]);
  assert.deepEqual(analisarMensagemGrupo("CARRETAS PULADAS (A)\nA140").pulados, ["A140"]);
  assert.deepEqual(analisarMensagemGrupo("PULADOS:\nA144 - A146").pulados, ["A144", "A146"]);
});

test("outro título encerra a lista: códigos de OBS/CANCELADOS não viram 'Ponto na vez'", () => {
  assert.deepEqual(
    analisarMensagemGrupo("PONTOS NA VEZ\nA014 - A016\nOBS: A050 favor comparecer no escritório"),
    { naVez: ["A014", "A016"], pulados: [] },
  );
  assert.deepEqual(
    analisarMensagemGrupo("PONTOS NA VEZ\nA014\nTRUCADAS PULADAS:\nA137\nCANCELADOS:\nA030 - A031"),
    { naVez: ["A014"], pulados: ["A137"] },
  );
  // Linhas informativas e subtítulos de veículo/livro não encerram a lista.
  assert.deepEqual(
    analisarMensagemGrupo("PONTOS NA VEZ\nDATA: 28/09\nATUALIZADO 10:30\nCARRETAS TRUCADAS (A):\nA014 - A016\nTRUCK (B):\nB022\nLIVRO M:\nM069"),
    { naVez: ["A014", "A016", "B022", "M069"], pulados: [] },
  );
});
