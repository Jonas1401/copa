import { sql } from "drizzle-orm";
import { db } from "@/db";
import { garantirTabelas } from "@/lib/estado";

let schemaPromise: Promise<void> | null = null;

/** Tabelas do piloto são criadas de forma compatível com a inicialização atual do app. */
export async function garantirSchemaEsim() {
  await garantirTabelas();
  if (!schemaPromise) {
    schemaPromise = db.execute(sql`
      CREATE TABLE IF NOT EXISTS esim_users (
        id SERIAL PRIMARY KEY,
        motorista_id INTEGER UNIQUE REFERENCES motoristas(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esim_users_email_idx ON esim_users (email);

      CREATE TABLE IF NOT EXISTS esim_plans (
        id SERIAL PRIMARY KEY,
        provider_package_id TEXT NOT NULL UNIQUE,
        provider_product_id TEXT,
        provider_product_code TEXT,
        provider_product_name TEXT NOT NULL,
        code TEXT,
        name TEXT NOT NULL,
        wholesale_price NUMERIC(19,6) NOT NULL,
        retail_reference_price NUMERIC(19,6),
        currency TEXT NOT NULL DEFAULT 'USD',
        data_amount NUMERIC(19,6),
        data_unit TEXT,
        duration_days INTEGER,
        source TEXT NOT NULL DEFAULT 'nexa',
        available BOOLEAN NOT NULL DEFAULT FALSE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        synced_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esim_plans_active_idx ON esim_plans (active, available);

      CREATE TABLE IF NOT EXISTS esim_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES esim_users(id),
        plan_id INTEGER NOT NULL REFERENCES esim_plans(id),
        status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
        currency TEXT NOT NULL DEFAULT 'USD',
        cost_amount NUMERIC(19,6) NOT NULL,
        amount NUMERIC(19,2) NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        provider_order_code TEXT UNIQUE,
        provider_callback_url TEXT,
        provider_status_code INTEGER,
        error_code TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esim_orders_user_idx ON esim_orders (user_id, created_at);
      CREATE INDEX IF NOT EXISTS esim_orders_status_idx ON esim_orders (status);

      CREATE TABLE IF NOT EXISTS esim_payments (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL UNIQUE REFERENCES esim_orders(id) ON DELETE CASCADE,
        gateway TEXT NOT NULL DEFAULT 'unconfigured',
        gateway_payment_id TEXT UNIQUE,
        method TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        amount NUMERIC(19,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esim_payments_status_idx ON esim_payments (status);

      CREATE TABLE IF NOT EXISTS esims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES esim_users(id),
        order_id INTEGER NOT NULL REFERENCES esim_orders(id) ON DELETE CASCADE,
        plan_id INTEGER NOT NULL REFERENCES esim_plans(id),
        iccid TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'PENDING',
        provider_status TEXT,
        qr_code TEXT,
        qr_url TEXT,
        activation_code TEXT,
        installation_url TEXT,
        smdp TEXT,
        expires_at TIMESTAMP WITH TIME ZONE,
        total_data_amount NUMERIC(19,6),
        total_data_unit TEXT,
        source TEXT NOT NULL DEFAULT 'nexa',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esims_user_idx ON esims (user_id, created_at);
      CREATE INDEX IF NOT EXISTS esims_order_idx ON esims (order_id);

      CREATE TABLE IF NOT EXISTS esim_usage (
        id SERIAL PRIMARY KEY,
        esim_id INTEGER NOT NULL REFERENCES esims(id) ON DELETE CASCADE,
        used_amount NUMERIC(19,6),
        remaining_amount NUMERIC(19,6),
        data_unit TEXT,
        provider_payload_hash TEXT,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        queried_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esim_usage_esim_idx ON esim_usage (esim_id, queried_at);

      CREATE TABLE IF NOT EXISTS esim_topups (
        id SERIAL PRIMARY KEY,
        esim_id INTEGER NOT NULL REFERENCES esims(id) ON DELETE CASCADE,
        plan_id INTEGER REFERENCES esim_plans(id),
        payment_id INTEGER REFERENCES esim_payments(id),
        provider_topup_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        amount NUMERIC(19,2),
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esim_topups_esim_idx ON esim_topups (esim_id, created_at);

      CREATE TABLE IF NOT EXISTS esim_webhook_events (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        provider_event_id TEXT,
        provider_order_code TEXT,
        event_type TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        result TEXT NOT NULL DEFAULT '',
        pending_payload JSONB,
        received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT esim_webhook_events_provider_hash_unique UNIQUE (provider, event_hash),
        CONSTRAINT esim_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
      );
      CREATE INDEX IF NOT EXISTS esim_webhook_events_status_idx ON esim_webhook_events (status, received_at);

      CREATE TABLE IF NOT EXISTS esim_api_errors (
        id SERIAL PRIMARY KEY,
        request_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        http_status INTEGER,
        provider_error_code TEXT,
        message TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS esim_api_errors_created_idx ON esim_api_errors (created_at);

      CREATE TABLE IF NOT EXISTS esim_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      -- No acesso PostgREST/anon, ninguém lê os dados; somente o backend privilegiado opera.
      ALTER TABLE esim_users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_plans ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_payments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esims ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_usage ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_topups ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_webhook_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_api_errors ENABLE ROW LEVEL SECURITY;
      ALTER TABLE esim_settings ENABLE ROW LEVEL SECURITY;
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}
