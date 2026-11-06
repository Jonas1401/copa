import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Pool } from "pg";
import {
  CONNECTION_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
  descartarConexoesOciosasVencidas,
} from "../src/db";
import { estadoInicialOffline } from "../src/lib/estado";

const ler = (arquivo: string) => readFileSync(arquivo, "utf8");

test("pool PostgreSQL evita travamento serverless ('timeout exceeded when trying to connect')", () => {
  assert.ok(CONNECTION_TIMEOUT_MS > 0 && CONNECTION_TIMEOUT_MS <= 5_000, "prazo de conexão deve ficar bem abaixo de 10 s");
  assert.ok(QUERY_TIMEOUT_MS > 0 && QUERY_TIMEOUT_MS <= 8_000, "consulta sem query_timeout trava vaga do pool para sempre");
  assert.ok(IDLE_TIMEOUT_MS > 0 && IDLE_TIMEOUT_MS <= 10_000, "conexão ociosa longa vira socket zumbi após freeze da função");
  assert.ok(
    CONNECTION_TIMEOUT_MS + QUERY_TIMEOUT_MS <= 10_000,
    "conexão + leitura precisa caber no teto de 10 s da função serverless",
  );

  const fonteDb = ler("src/db/index.ts");
  assert.ok(
    !fonteDb.includes('process.env.NODE_ENV !== "production"'),
    "singleton do pool precisa valer também em produção",
  );
  assert.ok(
    !fonteDb.includes("max: usaPooler ? 1"),
    "max: 1 trava todo o processo quando uma única consulta atrasa",
  );
});

test("descartarConexoesOciosasVencidas remove conexões congeladas ou encerradas antes do reuso", () => {
  let destruidos = 0;
  const removidos: unknown[] = [];
  const vencido = {
    __idleSince: 1_000,
    connection: { stream: { destroyed: false, writableEnded: false, destroy: () => { destruidos += 1; } } },
  };
  const encerrado = {
    __idleSince: 9_500,
    connection: { stream: { destroyed: true, writableEnded: false, destroy: () => { destruidos += 1; } } },
  };
  const saudavel = {
    __idleSince: 9_500,
    connection: { stream: { destroyed: false, writableEnded: false, destroy: () => { destruidos += 1; } } },
  };

  const itens: { client: unknown }[] = [{ client: vencido }, { client: encerrado }, { client: saudavel }];
  const poolFalso = {
    _idle: itens,
    _remove(c: unknown) {
      removidos.push(c);
      poolFalso._idle = poolFalso._idle.filter((i: { client: unknown }) => i.client !== c);
    },
  };

  const qtd = descartarConexoesOciosasVencidas(poolFalso as unknown as Pool, 1_000 + IDLE_TIMEOUT_MS + 50);
  assert.equal(qtd, 2);
  assert.equal(destruidos, 2);
  assert.deepEqual(removidos, [vencido, encerrado]);
  assert.equal(poolFalso._idle.length, 1);
  assert.equal(poolFalso._idle[0].client, saudavel);
});

test("estadoInicialOffline entrega estrutura válida do monitor sem tocar no banco", () => {
  const estado = estadoInicialOffline();
  assert.equal(estado.online, false);
  assert.equal(estado.temLeitura, false);
  assert.equal(estado.fila.length, 6);
  assert.deepEqual(estado.pontos, []);
  assert.ok(estado.site.geral.startsWith("https://"));
});

test("página inicial abre em contingência quando DATABASE_URL existe mas o banco oscila", () => {
  const home = ler("src/app/page.tsx");
  assert.ok(home.includes("if (!temBancoConfigurado)"), "AguardandoBanco deve ficar restrito a ambiente sem banco configurado");
  assert.ok(home.includes("estadoInicialOffline()"), "abertura precisa cair em estadoInicialOffline quando o banco oscila");
  assert.ok(home.includes("PRAZO_ABERTURA_MS"), "abertura precisa limitar espera de SSR abaixo do timeout da Vercel");

  const estado = ler("src/lib/estado.ts");
  assert.ok(estado.includes("esquemaBasePronto"), "garantirTabelas deve consultar catálogo antes de rodar DDL");
  assert.ok(estado.includes("__copalinksTabelasPromessa"), "garantirTabelas deve deduplicar chamadas concorrentes");
});
