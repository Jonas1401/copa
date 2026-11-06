import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";

/**
 * A migração manual do Supabase (SQL Editor) precisa criar TODAS as tabelas,
 * colunas, UNIQUE e índices do schema.ts — senão o app quebra num deploy em que
 * o banco não tenha permissão de DDL. Conferimos aqui o TEXTO do SQL: é rápido,
 * roda no `npm test` e não precisa de banco.
 *
 * A conferência contra um PostgreSQL de verdade é o `npm run db:checar`.
 */
const sql = readFileSync("supabase/migrations/20261106_atualizacao_completa.sql", "utf8");
const normalizado = sql.replace(/\s+/g, " ");

function semComentarios(texto: string) {
  return texto.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
}

const ddl = semComentarios(sql);

/** Corpo de cada CREATE TABLE [IF NOT EXISTS] public.x ( ... ); */
function corpoDaTabela(nome: string): string | null {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${nome} \\(([\\s\\S]*?)\\);`);
  const m = ddl.match(re);
  return m ? m[1] : null;
}

/**
 * Definição declarada de cada coluna, juntando o CREATE TABLE com os
 * ALTER TABLE … ADD COLUMN IF NOT EXISTS (colunas adicionadas depois).
 */
function colunasDeclaradas(nome: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const corpo = corpoDaTabela(nome);
  assert.ok(corpo, `corpo da tabela ${nome}`);
  for (const linha of corpo!.split(/,(?![^()]*\))/)) {
    const m = linha.trim().match(/^([a-z0-9_]+) (.+)$/);
    if (m) mapa.set(m[1], m[2]);
  }
  const alter = new RegExp(`ALTER TABLE public\\.${nome} ([\\s\\S]*?);`, "g");
  for (const bloco of ddl.matchAll(alter)) {
    for (const m of bloco[1].matchAll(/ADD COLUMN IF NOT EXISTS ([a-z0-9_]+) ([^,]+)/g)) {
      mapa.set(m[1], m[2]);
    }
  }
  return mapa;
}

const tabelas = Object.values(schema).filter(
  (v) => v && typeof v === "object" && (v as Record<symbol, unknown>)[Symbol.for("drizzle:IsDrizzleTable")],
);
const configs = tabelas.map((t) => getTableConfig(t as never));

test("migração cria as 44 tabelas do schema.ts (e nenhuma sobra)", () => {
  const criadas = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+) \(/g)].map((m) => m[1]);
  assert.equal(configs.length, 44);
  assert.deepEqual([...criadas].sort(), configs.map((c) => c.name).sort());
  assert.equal(new Set(criadas).size, criadas.length, "nenhuma tabela repetida");
});

test("toda coluna existe, com NOT NULL e default quando o schema.ts pede", () => {
  const faltando: string[] = [];
  const semNotNull: string[] = [];
  const semDefault: string[] = [];
  for (const cfg of configs) {
    const colunas = colunasDeclaradas(cfg.name);
    for (const col of cfg.columns) {
      const def = colunas.get(col.name);
      if (!def) {
        faltando.push(`${cfg.name}.${col.name}`);
        continue;
      }
      if (col.notNull && !col.hasDefault && !col.primary && !/NOT NULL/.test(def)) {
        semNotNull.push(`${cfg.name}.${col.name}`);
      }
      if (col.hasDefault && !col.primary && !/DEFAULT/.test(def)) semDefault.push(`${cfg.name}.${col.name}`);
    }
    const sobrando = [...colunas.keys()].filter((c) => !cfg.columns.some((col) => col.name === c));
    assert.deepEqual(sobrando, [], `${cfg.name}: coluna na migração que o schema.ts não conhece`);
  }
  assert.deepEqual(faltando, [], "colunas faltando na migração");
  assert.deepEqual(semNotNull, [], "colunas que deveriam ser NOT NULL");
  assert.deepEqual(semDefault, [], "colunas que deveriam ter DEFAULT");
});

test("UNIQUE e índices do schema.ts estão na migração", () => {
  const faltandoUnicas: string[] = [];
  const faltandoIndices: string[] = [];
  for (const cfg of configs) {
    for (const u of cfg.uniqueConstraints) {
      if (!ddl.includes(`CONSTRAINT ${u.name} UNIQUE`)) faltandoUnicas.push(`${cfg.name}:${u.name}`);
    }
    for (const i of cfg.indexes) {
      if (!normalizado.includes(`CREATE INDEX IF NOT EXISTS ${i.config.name} `)) {
        faltandoIndices.push(`${cfg.name}:${i.config.name}`);
      }
    }
  }
  assert.deepEqual(faltandoUnicas, [], "UNIQUE faltando");
  assert.deepEqual(faltandoIndices, [], "índices faltando");
});

test("migração é idempotente e aditiva: nada de DROP de coluna/tabela", () => {
  // Só pode existir o DROP CONSTRAINT IF EXISTS da regra antiga de ponto único.
  const drops = [...ddl.matchAll(/DROP\s+(COLUMN|TABLE|INDEX|SCHEMA|TYPE)\b/gi)].map((m) => m[0]);
  assert.deepEqual(drops, [], "nenhum DROP destrutivo");
  assert.match(ddl, /ALTER TABLE public\.pontos DROP CONSTRAINT IF EXISTS ponto_unico/);

  // Todo CREATE TABLE/INDEX usa IF NOT EXISTS e todo ADD COLUMN usa IF NOT EXISTS.
  assert.equal(/CREATE TABLE (?!IF NOT EXISTS)/.test(ddl), false);
  assert.equal(/CREATE INDEX (?!IF NOT EXISTS)/.test(ddl), false);
  assert.equal(/ADD COLUMN (?!IF NOT EXISTS)/.test(ddl), false);

  // Transação única: ou aplica tudo, ou nada.
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("RLS habilitada em todas as tabelas e anon/authenticated sem acesso", () => {
  const comRls = new Set(
    [...ddl.matchAll(/ALTER TABLE public\.([a-z0-9_]+) ENABLE ROW LEVEL SECURITY/g)].map((m) => m[1]),
  );
  assert.deepEqual(
    configs.map((c) => c.name).filter((n) => !comRls.has(n)),
    [],
    "tabelas sem RLS",
  );
  assert.match(ddl, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/);
  assert.match(ddl, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated/);
  // RLS sem policy = nada liberado para o navegador.
  assert.equal(/CREATE POLICY/.test(ddl), false);
});

test("o SQL não traz nenhum segredo (senha, chave, URL de projeto)", () => {
  assert.equal(/postgres(ql)?:\/\//i.test(sql), false, "nenhuma string de conexão");
  assert.equal(/eyJ[A-Za-z0-9_-]{10,}/.test(sql), false, "nenhum JWT");
  assert.equal(/service_role|apikey/i.test(sql), false, "nenhuma chave de API");
  assert.equal(/dhlwytthbnarxwioqhdr/.test(sql), false, "nenhum project ref do Supabase");
});
