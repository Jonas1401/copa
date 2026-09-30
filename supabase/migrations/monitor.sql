-- CopaLinks / Monitor WhatsApp (PostgreSQL / Supabase).
-- Pode ser aplicada novamente: nenhuma tabela da fila nem dado existente é removido.
-- Executar uma vez no SQL Editor do Supabase, ou deixar garantirTabelas() criar
-- as mesmas tabelas no primeiro acesso. O backend usa Drizzle ORM.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_codes (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT monitor_codes_dono_codigo_unico UNIQUE (motorista_id, codigo)
);
CREATE INDEX IF NOT EXISTS monitor_codes_codigo_ativo_idx ON public.monitor_codes(codigo, ativo);

CREATE TABLE IF NOT EXISTS public.monitor_pair_codes (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  motorista_id INTEGER REFERENCES public.motoristas(id) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_pair_codes_expira_em_idx ON public.monitor_pair_codes(expira_em);

CREATE TABLE IF NOT EXISTS public.monitor_devices (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  motorista_id INTEGER REFERENCES public.motoristas(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  fcm_token TEXT,
  nome TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  ultimo_contato_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_devices_tipo_ativo_idx ON public.monitor_devices(tipo, ativo);
CREATE INDEX IF NOT EXISTS monitor_devices_motorista_idx ON public.monitor_devices(motorista_id);

CREATE TABLE IF NOT EXISTS public.monitor_messages (
  id SERIAL PRIMARY KEY,
  monitor_device_id INTEGER NOT NULL REFERENCES public.monitor_devices(id),
  event_id TEXT NOT NULL,
  origem TEXT NOT NULL,
  codigos JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT monitor_messages_device_event_unique UNIQUE (monitor_device_id, event_id)
);
CREATE INDEX IF NOT EXISTS monitor_messages_criado_em_idx ON public.monitor_messages(criado_em);

CREATE TABLE IF NOT EXISTS public.monitor_deliveries (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES public.monitor_messages(id),
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES public.monitor_devices(id),
  codigo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT monitor_deliveries_unique UNIQUE (message_id, device_id, codigo)
);
CREATE INDEX IF NOT EXISTS monitor_deliveries_motorista_data_idx ON public.monitor_deliveries(motorista_id, criado_em);
ALTER TABLE public.monitor_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_pair_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_deliveries ENABLE ROW LEVEL SECURITY;
COMMIT;

-- Segurança: o navegador e o APK não consultam as tabelas diretamente.
-- Acesso somente pelo backend Next.js, que verifica sessão httpOnly de
-- motorista/administrador ou segredo por aparelho pareado.
REVOKE ALL ON TABLE public.monitor_codes, public.monitor_pair_codes,
  public.monitor_devices, public.monitor_messages, public.monitor_deliveries
  FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.monitor_codes_id_seq, public.monitor_pair_codes_id_seq,
  public.monitor_devices_id_seq, public.monitor_messages_id_seq,
  public.monitor_deliveries_id_seq FROM anon, authenticated;
