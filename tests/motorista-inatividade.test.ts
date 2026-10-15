import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contaInativaParaExcluir, DIAS_INATIVIDADE } from "../src/lib/motorista-inatividade";

const MS_DIA = 24 * 60 * 60 * 1000;
const agora = new Date("2026-10-15T12:00:00.000Z");
const criado = (dias: number) => new Date(agora.getTime() - dias * MS_DIA);

test("15 dias: inativo sem número sai da contagem; com número permanece", () => {
  assert.equal(DIAS_INATIVIDADE, 15);

  assert.equal(
    contaInativaParaExcluir({
      ultimoAcessoEm: criado(15),
      criadoEm: criado(40),
      temNumeroMonitorado: false,
      agora,
    }),
    false,
    "no 15º dia o cadastro ainda permanece",
  );

  assert.equal(
    contaInativaParaExcluir({
      ultimoAcessoEm: criado(15 + 1 / 24),
      criadoEm: criado(40),
      temNumeroMonitorado: false,
      agora,
    }),
    true,
    "passou de 15 dias sem entrar e sem número: exclui",
  );

  assert.equal(
    contaInativaParaExcluir({
      ultimoAcessoEm: criado(30),
      criadoEm: criado(40),
      temNumeroMonitorado: true,
      agora,
    }),
    false,
    "quem monitora um número não é excluído",
  );

  assert.equal(
    contaInativaParaExcluir({
      ultimoAcessoEm: criado(1),
      criadoEm: criado(40),
      temNumeroMonitorado: false,
      agora,
    }),
    false,
    "entrou ontem: permanece mesmo sem número",
  );

  assert.equal(
    contaInativaParaExcluir({
      ultimoAcessoEm: null,
      criadoEm: criado(16),
      temNumeroMonitorado: false,
      agora,
    }),
    true,
    "sem data de acesso, vale a data de cadastro",
  );
});

test("o cron grava o último acesso e limpa cadastros inativos", () => {
  const cron = readFileSync("src/app/api/cron/route.ts", "utf8");
  assert.ok(cron.includes("limparMotoristasInativos"), "cron precisa excluir inativos");

  const sessao = readFileSync("src/lib/motorista-sessao.ts", "utf8");
  assert.ok(sessao.includes("registrarAcessoMotorista"), "abrir o app precisa gravar a data");
  assert.ok(sessao.includes("ultimoAcessoEm"), "sessão grava ultimoAcessoEm");

  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.ok(schema.includes("ultimoAcessoEm"), "motoristas tem a data do último acesso");

  const admin = readFileSync("src/components/admin/CartaoMotoristasAdmin.tsx", "utf8");
  assert.ok(admin.includes("último acesso"), "admin mostra a data do último acesso");

  const cadastro = readFileSync("src/app/api/motoristas/route.ts", "utf8");
  assert.ok(cadastro.includes("ultimoAcessoEm"), "cadastro já nasce com a data de entrada");
});
