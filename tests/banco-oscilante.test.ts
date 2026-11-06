import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ESPERA_ENTRE_TENTATIVAS_MS,
  PRAZO_RETENTATIVA_MS,
  TENTATIVAS_CONEXAO,
  comBanco,
  erroTransitorioDeConexao,
} from "../src/db";

const ler = (arquivo: string) => readFileSync(arquivo, "utf8");

/** Erro no formato que o pg entrega numa falha de handshake com o Supabase. */
function erroPg(mensagem: string, code?: string) {
  return Object.assign(new Error(mensagem), code ? { code } : {});
}

// ---------------------------------------------------------------- classificação

test("reconhece as duas recusas do pooler do Supabase como falha de conexão", () => {
  // Supavisor em waiting_for_secrets depois de reiniciar o projeto.
  assert.equal(
    erroTransitorioDeConexao(
      erroPg(
        "Authentication credentials are invalid. Please reconnect with fresh credentials to restore pool functionality.",
        "28P01",
      ),
    ),
    true,
  );
  // PAM do Supabase (host que não aceita a senha no handshake).
  assert.equal(erroTransitorioDeConexao(erroPg('PAM authentication failed for user "postgres"', "28000")), true);
  // Sem ficha de erro: só a mensagem, como chega em algumas versões do pg.
  assert.equal(erroTransitorioDeConexao(new Error("Connection terminated unexpectedly")), true);
  assert.equal(erroTransitorioDeConexao(new Error("timeout exceeded when trying to connect")), true);
  // O pg encobre a causa: a classificação precisa olhar o `cause`.
  const comCausa = new Error("Failed query: select 1");
  (comCausa as Error & { cause?: unknown }).cause = erroPg("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED");
  assert.equal(erroTransitorioDeConexao(comCausa), true);
});

test("NÃO repete erro de SQL: repetir poderia gravar a mesma coisa duas vezes", () => {
  const semTabela = erroPg('relation "pontos" does not exist', "42P01");
  const chaveDuplicada = erroPg("duplicate key value violates unique constraint", "23505");
  const sintaxe = erroPg('syntax error at or near "selec"', "42601");
  const permissao = erroPg("permission denied for table pontos", "42501");
  for (const erro of [semTabela, chaveDuplicada, sintaxe, permissao]) {
    assert.equal(erroTransitorioDeConexao(erro), false, `${erro.code} não é falha de conexão`);
  }
  assert.equal(erroTransitorioDeConexao(null), false);
  assert.equal(erroTransitorioDeConexao("texto solto"), false);
});

// ------------------------------------------------------------------- comBanco

test("comBanco repete a leitura quando o pooler recusa e devolve o resultado", async () => {
  let tentativas = 0;
  const resultado = await comBanco(async () => {
    tentativas += 1;
    if (tentativas < 3) throw erroPg('PAM authentication failed for user "postgres"', "28000");
    return "ok";
  });
  assert.equal(resultado, "ok");
  assert.equal(tentativas, 3);
});

test("comBanco desiste rápido em erro de SQL (uma única execução)", async () => {
  let tentativas = 0;
  await assert.rejects(
    comBanco(async () => {
      tentativas += 1;
      throw erroPg('relation "pontos" does not exist', "42P01");
    }),
  );
  assert.equal(tentativas, 1, "erro de SQL não pode ser reexecutado");
});

test("comBanco para no limite de tentativas e mantém o último erro", async () => {
  let tentativas = 0;
  await assert.rejects(
    comBanco(async () => {
      tentativas += 1;
      throw erroPg("Connection terminated unexpectedly", "08006");
    }),
    /Connection terminated unexpectedly/,
  );
  assert.equal(tentativas, TENTATIVAS_CONEXAO);
});

// ------------------------------------------------------------------ orçamento

test("as novas tentativas cabem no limite de 10 s da função serverless", () => {
  assert.ok(TENTATIVAS_CONEXAO >= 2, "uma oscilação passageira precisa de pelo menos uma segunda chance");
  assert.ok(ESPERA_ENTRE_TENTATIVAS_MS >= 100, "espera curta demais só repete o erro na mesma janela");
  assert.ok(PRAZO_RETENTATIVA_MS < 10_000, "o retry não pode estourar o tempo da função");
  const piorCaso = ESPERA_ENTRE_TENTATIVAS_MS * (2 + 3) * TENTATIVAS_CONEXAO;
  assert.ok(piorCaso <= PRAZO_RETENTATIVA_MS, "backoff quadrático + jitter precisa caber no prazo");
});

// ------------------------------------------------------------- rotas tolerantes

test("rotas do app não estouram 500 vazio quando o banco oscila", () => {
  const chat = ler("src/app/api/chat/route.ts");
  assert.ok(chat.includes("comBanco"), "chat deve repetir a leitura em falha de conexão");
  assert.ok(
    /catch[\s\S]{0,400}mensagens: \[\], erro/.test(chat),
    "chat precisa responder lista vazia (200) em vez de 500 sem corpo",
  );

  const figurinhas = ler("src/app/api/figurinhas/route.ts");
  assert.ok(/catch[\s\S]{0,400}categorias: \[\], figurinhas: \[\]/.test(figurinhas), "catálogo não pode sumir com 500");

  const motoristas = ler("src/app/api/motoristas/route.ts");
  assert.ok(motoristas.includes("indisponivel"), "contagem de motoristas deve degradar sem erro");

  const chave = ler("src/app/api/push/chave/route.ts");
  assert.ok(!/await chavePublica\(\)/.test(chave), "chave VAPID precisa de catch: sem ela não há aviso no celular");

  const estado = ler("src/lib/estado.ts");
  assert.ok(
    /catch[\s\S]{0,200}estadoInicialOffline\(\)/.test(estado),
    "montarEstado deve cair no estado vazio em vez de derrubar a rota",
  );
});
