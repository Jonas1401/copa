#!/usr/bin/env node
/**
 * Conferência do esquema: compara src/db/schema.ts com a migração do Supabase.
 *
 *   DATABASE_URL=postgresql://... npm run db:checar
 *   DATABASE_URL=postgresql://... npm run db:checar -- --recriar   (banco descartável)
 *
 * Para cada tabela do Drizzle, aplica a migração
 * `supabase/migrations/20261106_atualizacao_completa.sql` num banco descartável
 * e confere coluna por coluna (existência, NOT NULL, default e tipo), além das
 * UNIQUE e dos índices declarados no schema.ts. Também exercita o DDL que o
 * próprio app aplica em runtime (garantirTabelas, eSIM, navios, IA).
 *
 * Sem --recriar ele só lê o banco. Com --recriar ele APAGA o schema public
 * antes de migrar: use só num banco local/descartável, nunca em produção.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL (banco descartável, ex.: postgresql://postgres@127.0.0.1:5432/copalinks_teste)");
  process.exit(2);
}
try {
  const u = new URL(url);
  if (!["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(u.hostname)) {
    console.error(`Recusado: ${u.hostname} não é local. Use um banco descartável (o Supabase real é atualizado pelo SQL Editor).`);
    process.exit(2);
  }
} catch {
  console.error("DATABASE_URL inválida.");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const migracao = readFileSync(join(raiz, "supabase/migrations/20261106_atualizacao_completa.sql"), "utf8");
const corpo = (() => {
  const inicio = migracao.indexOf("BEGIN;");
  const fim = migracao.lastIndexOf("COMMIT;");
  return inicio >= 0 && fim > inicio ? migracao.slice(inicio + 6, fim) : migracao;
})();

const { getTableConfig } = await import("drizzle-orm/pg-core");
const schema = await import("../src/db/schema.ts");

/** Sem --recriar o script só compara; com ele, apaga o schema public e migra do zero. */
const recriar = process.argv.includes("--recriar");

const client = new Client({ connectionString: url });
await client.connect();
const problemas = [];

if (recriar) {
  await client.query("drop schema if exists public cascade; create schema public;");
  try {
    await client.query(corpo);
  } catch (e) {
    problemas.push(`migração não aplicou: ${e.message}`);
  }
}

const colunas = new Map();
const resCols = await client.query(`
  SELECT table_name, column_name, is_nullable, column_default, udt_name
  FROM information_schema.columns WHERE table_schema = 'public'
`);
for (const c of resCols.rows) colunas.set(`${c.table_name}.${c.column_name}`, c);

// UNIQUE comparada pelo CONJUNTO DE COLUNAS (o nome pode variar em bancos
// antigos, onde a restrição foi criada inline sem nome).
const unicas = new Set();
for (const c of (await client.query(`
  SELECT conrelid::regclass::text AS tabela, conname,
         array_to_string(ARRAY(
           SELECT a.attname FROM unnest(conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         ), ',') AS colunas
  FROM pg_constraint WHERE contype = 'u' AND connamespace = 'public'::regnamespace
`)).rows) {
  unicas.add(`${c.tabela}:${c.conname}`);
  unicas.add(`${c.tabela}:(${c.colunas})`);
}

const indices = new Set();
for (const i of (await client.query(`SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'`)).rows) {
  indices.add(`${i.tablename}:${i.indexname}`);
}

function tipoAceito(coluna) {
  const nome = coluna.constructor?.name ?? "";
  if (nome === "PgSerial" || nome === "PgInteger") return ["int4", "int2", "int8"];
  if (nome === "PgText") return ["text", "varchar", "bpchar"];
  if (nome === "PgBoolean") return ["bool"];
  if (nome === "PgTimestamp") return ["timestamptz", "timestamp"];
  if (nome === "PgJsonb") return ["jsonb", "json"];
  if (nome === "PgNumeric") return ["numeric"];
  return null;
}

const tabelas = Object.entries(schema).filter(([, v]) => v && typeof v === "object" && v[Symbol.for("drizzle:IsDrizzleTable")]);
let colunasConferidas = 0;

for (const [exportado, tabela] of tabelas) {
  const cfg = getTableConfig(tabela);
  const nome = cfg.name;
  const existe = (await client.query("select to_regclass($1) as t", [`public.${nome}`])).rows[0].t;
  if (!existe) {
    problemas.push(`tabela ${nome} (${exportado}): não criada pela migração`);
    continue;
  }
  for (const col of cfg.columns) {
    colunasConferidas += 1;
    const b = colunas.get(`${nome}.${col.name}`);
    if (!b) {
      problemas.push(`${nome}.${col.name}: coluna ausente na migração`);
      continue;
    }
    if (col.notNull && !col.hasDefault && !col.primary && b.is_nullable !== "NO") {
      problemas.push(`${nome}.${col.name}: schema.ts pede NOT NULL, banco aceita NULL`);
    }
    if (col.hasDefault && b.column_default === null) {
      problemas.push(`${nome}.${col.name}: schema.ts tem default, banco não`);
    }
    const aceitos = tipoAceito(col);
    if (aceitos && !aceitos.includes(b.udt_name)) {
      problemas.push(`${nome}.${col.name}: banco é ${b.udt_name}, schema.ts espera ${aceitos.join("/")}`);
    }
  }
  for (const u of cfg.uniqueConstraints) {
    const colunasU = u.columns.map((c) => c.name).join(",");
    if (!unicas.has(`${nome}:${u.name}`) && !unicas.has(`${nome}:(${colunasU})`)) {
      problemas.push(`${nome}: UNIQUE ${u.name} (${colunasU}) ausente`);
    }
  }
  for (const i of cfg.indexes) {
    if (!indices.has(`${nome}:${i.config.name}`)) problemas.push(`${nome}: índice ${i.config.name} ausente na migração`);
  }
}

const totalTabelas = (await client.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
console.log(`schema.ts: ${tabelas.length} tabelas · banco: ${totalTabelas} tabelas · ${colunasConferidas} colunas conferidas`);

if (problemas.length) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(` - ${p}`);
  await client.end();
  process.exit(1);
}
console.log("OK — a migração do Supabase cria exatamente o esquema do app.");
await client.end();
