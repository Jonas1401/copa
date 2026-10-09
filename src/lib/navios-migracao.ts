import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Mesmo DDL da migração 20261008_navios_composio.sql. Só roda no servidor. */
let pronta: Promise<void> | null = null;
export async function garantirTabelasNavios() {
  if (!pronta) {
    pronta = db.execute(sql.raw(`-- Monitor de navios em segundo plano. Migração aditiva, sem alterar o visual.
-- Execute depois das tabelas base do CopaLinks (configuracao, subscriptions).
-- O servidor também aplica este DDL idempotente na primeira execução.
CREATE TABLE IF NOT EXISTS navios_monitor_fontes (
  fonte TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  dados TEXT,
  texto_fonte TEXT,
  revisao INTEGER NOT NULL DEFAULT 0,
  lido_em TIMESTAMP WITH TIME ZONE,
  tentativa_em TIMESTAMP WITH TIME ZONE,
  leitura_ate TIMESTAMP WITH TIME ZONE,
  token_leitura TEXT,
  erro TEXT
);
CREATE TABLE IF NOT EXISTS navios_monitor_eventos (
  id SERIAL PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  fonte TEXT NOT NULL,
  navio TEXT NOT NULL,
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  mensagem_id INTEGER,
  criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  publicado_em TIMESTAMP WITH TIME ZONE,
  push_em TIMESTAMP WITH TIME ZONE,
  envio_ate TIMESTAMP WITH TIME ZONE,
  tentativas INTEGER NOT NULL DEFAULT 0,
  erro TEXT
);
CREATE INDEX IF NOT EXISTS navios_monitor_eventos_pendentes_idx
  ON navios_monitor_eventos (id) WHERE push_em IS NULL;
-- Recibo por aparelho: uma falha em um aparelho não duplica o aviso nos outros.
CREATE TABLE IF NOT EXISTS push_entregas (
  id SERIAL PRIMARY KEY,
  tag TEXT NOT NULL,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  aceita_em TIMESTAMP WITH TIME ZONE,
  enviando_ate TIMESTAMP WITH TIME ZONE,
  criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT push_entrega_unica UNIQUE (tag, subscription_id)
);
CREATE INDEX IF NOT EXISTS push_entregas_criado_em_idx ON push_entregas (criado_em);
-- Dados são acessados exclusivamente pelo backend, não pelo anon do Supabase.
ALTER TABLE navios_monitor_fontes ENABLE ROW LEVEL SECURITY;
ALTER TABLE navios_monitor_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_entregas ENABLE ROW LEVEL SECURITY;
`)).then(() => undefined).catch((e) => {
      pronta = null; // Falha não é confundida com migração aplicada.
      throw e;
    });
  }
  return pronta;
}
