-- CopaLinks — ATUALIZAÇÃO COMPLETA DO SUPABASE (06/11/2026)
--
-- Um único arquivo para deixar o banco do Supabase com TODAS as tabelas,
-- colunas, índices e restrições que o app usa hoje (base + chat com mídia,
-- reações, silenciados, figurinhas, navios/Composio, push por aparelho,
-- eSIM, IA com imagem, último acesso do motorista).
--
-- Como aplicar:
--   1. Supabase → SQL Editor → New query;
--   2. cole TODO este arquivo e clique em Run;
--   3. repita quantas vezes quiser — é 100% idempotente
--      (IF NOT EXISTS / IF EXISTS em tudo). Nenhum dado é apagado.
--
-- O app também cria o esquema sozinho na primeira abertura (garantirTabelas),
-- mas isso exige permissão de DDL na conta da DATABASE_URL. Rodando este
-- arquivo uma vez, o deploy novo já encontra o banco pronto.
--
-- Observação: o backend acessa o PostgreSQL direto (Drizzle). O Supabase não
-- expõe nada por PostgREST/anon — todas as tabelas ficam com RLS habilitada
-- e sem policy, e os privilégios de anon/authenticated são revogados.

BEGIN;

/* ===================================================== 1. FILA / PONTOS ==== */

CREATE TABLE IF NOT EXISTS public.pontos (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  livro TEXT NOT NULL,
  numero INTEGER NOT NULL,
  na_frente INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'AGUARDANDO',
  origem TEXT NOT NULL DEFAULT 'manual',
  visto_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chamado_em TIMESTAMPTZ,
  saida_em TIMESTAMPTZ,
  ordem INTEGER NOT NULL DEFAULT 0,
  motorista_id INTEGER,
  alerta_perto INTEGER,
  CONSTRAINT ponto_unico_motorista UNIQUE (motorista_id, tipo, livro, numero)
);

-- Bancos antigos tinham um único ponto por número no app inteiro; hoje cada
-- motorista monitora os próprios pontos (mesmo número em dois motoristas).
ALTER TABLE public.pontos DROP CONSTRAINT IF EXISTS ponto_unico;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ponto_unico_motorista' AND conrelid = 'public.pontos'::regclass
  ) THEN
    ALTER TABLE public.pontos
      ADD CONSTRAINT ponto_unico_motorista UNIQUE (motorista_id, tipo, livro, numero);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.amostras (
  id SERIAL PRIMARY KEY,
  origem TEXT NOT NULL,
  dados JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.eventos (
  id SERIAL PRIMARY KEY,
  codigo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  livro TEXT NOT NULL,
  numero INTEGER NOT NULL,
  acao TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* ============================================== 2. MOTORISTAS E SESSÕES ==== */

CREATE TABLE IF NOT EXISTS public.motoristas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  ponto_tipo TEXT,
  ponto_livro TEXT,
  ponto_numero INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acesso_em TIMESTAMPTZ
);

-- Exclusão automática de cadastro inativo (15 dias sem abrir o app).
ALTER TABLE public.motoristas
  ADD COLUMN IF NOT EXISTS ultimo_acesso_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS motoristas_ultimo_acesso_em_idx
  ON public.motoristas (ultimo_acesso_em);

CREATE TABLE IF NOT EXISTS public.motorista_sessoes (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS motorista_sessoes_motorista_id_idx
  ON public.motorista_sessoes (motorista_id);

-- Alerta individual do administrador para um motorista (tela cheia no app).
CREATE TABLE IF NOT EXISTS public.alertas_motorista (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  mensagem TEXT NOT NULL,
  admin_nome TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolvido_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS alertas_motorista_motorista_idx
  ON public.alertas_motorista (motorista_id);

-- Regras de segurança enviadas após a saída para o trabalho.
CREATE TABLE IF NOT EXISTS public.regras_envios (
  chave TEXT PRIMARY KEY,
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  enviadas INTEGER NOT NULL DEFAULT 0,
  ultimo_envio_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* ============================================== 3. NOTIFICAÇÕES (PUSH) ==== */

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  dispositivo TEXT NOT NULL DEFAULT '',
  ativa INTEGER NOT NULL DEFAULT 1,
  motorista_id INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_envio_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.testes_push (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  pedido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviar_apos TIMESTAMPTZ NOT NULL,
  processado_em TIMESTAMPTZ,
  resultado TEXT
);
CREATE INDEX IF NOT EXISTS testes_push_endpoint_idx ON public.testes_push (endpoint);

CREATE TABLE IF NOT EXISTS public.notificacoes (
  id SERIAL PRIMARY KEY,
  tag TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  corpo TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recibo por aparelho: uma falha em um aparelho não duplica o aviso nos outros.
CREATE TABLE IF NOT EXISTS public.push_entregas (
  id SERIAL PRIMARY KEY,
  tag TEXT NOT NULL,
  subscription_id INTEGER NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  aceita_em TIMESTAMPTZ,
  enviando_ate TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_entrega_unica UNIQUE (tag, subscription_id)
);
CREATE INDEX IF NOT EXISTS push_entregas_criado_em_idx
  ON public.push_entregas (criado_em);

/* =================================================== 4. CONFIGURAÇÃO ====== */

CREATE TABLE IF NOT EXISTS public.configuracao (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* ============================================== 5. ADMINISTRAÇÃO ========== */

CREATE TABLE IF NOT EXISTS public.admins (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acesso_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.admin_sessoes (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys cifradas (AES-256-GCM); final4 só para exibir "••••1234".
CREATE TABLE IF NOT EXISTS public.segredos (
  chave TEXT PRIMARY KEY,
  cifrado TEXT NOT NULL,
  final4 TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_por INTEGER
);

CREATE TABLE IF NOT EXISTS public.integracoes_status (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  verificado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.auditoria (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER,
  admin_nome TEXT NOT NULL,
  integracao TEXT NOT NULL,
  acao TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* ========================================================== 6. CHAT ====== */

CREATE TABLE IF NOT EXISTS public.chat_mensagens (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  texto TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'texto',
  media_nome TEXT,
  media_tipo TEXT,
  media_dados TEXT,
  duracao_segundos INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migração aditiva do chat (áudio, imagem, arquivo, figurinha).
ALTER TABLE public.chat_mensagens
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'texto',
  ADD COLUMN IF NOT EXISTS media_nome TEXT,
  ADD COLUMN IF NOT EXISTS media_tipo TEXT,
  ADD COLUMN IF NOT EXISTS media_dados TEXT,
  ADD COLUMN IF NOT EXISTS duracao_segundos INTEGER;

-- Curtidas com emoji: uma reação por motorista em cada mensagem.
CREATE TABLE IF NOT EXISTS public.chat_reacoes (
  id SERIAL PRIMARY KEY,
  mensagem_id INTEGER NOT NULL REFERENCES public.chat_mensagens(id) ON DELETE CASCADE,
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_reacao_unica UNIQUE (mensagem_id, motorista_id)
);
CREATE INDEX IF NOT EXISTS chat_reacoes_mensagem_idx
  ON public.chat_reacoes (mensagem_id);

-- Quem silenciou SÓ as notificações do chat.
CREATE TABLE IF NOT EXISTS public.chat_silenciados (
  motorista_id INTEGER PRIMARY KEY REFERENCES public.motoristas(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* ================================= 7. FIGURINHAS PERSONALIZADAS ========== */

CREATE TABLE IF NOT EXISTS public.figurinha_categorias (
  chave TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  pacote TEXT NOT NULL DEFAULT 'copalinks',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.figurinhas_catalogo (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL REFERENCES public.figurinha_categorias(chave) ON DELETE RESTRICT,
  mime TEXT NOT NULL,
  dados TEXT NOT NULL,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  ordem INTEGER NOT NULL DEFAULT 0,
  pacote TEXT NOT NULL DEFAULT 'copalinks',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS figurinhas_catalogo_categoria_idx
  ON public.figurinhas_catalogo (categoria, ordem);

/* ================================================= 8. ASSISTENTE IA ====== */

CREATE TABLE IF NOT EXISTS public.ia_mensagens (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL,
  papel TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ia_mensagens_motorista_idx
  ON public.ia_mensagens (motorista_id, id);

-- Imagens da conversa (JPEG em base64), adicionadas depois.
ALTER TABLE public.ia_mensagens
  ADD COLUMN IF NOT EXISTS imagem_dados TEXT;

/* ================================ 9. MONITOR WHATSAPP (Android) ========== */

CREATE TABLE IF NOT EXISTS public.monitor_codes (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitor_codes_dono_codigo_unico UNIQUE (motorista_id, codigo)
);
CREATE INDEX IF NOT EXISTS monitor_codes_codigo_ativo_idx
  ON public.monitor_codes (codigo, ativo);

CREATE TABLE IF NOT EXISTS public.monitor_pair_codes (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  motorista_id INTEGER REFERENCES public.motoristas(id) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS monitor_pair_codes_expira_em_idx
  ON public.monitor_pair_codes (expira_em);

CREATE TABLE IF NOT EXISTS public.monitor_devices (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  motorista_id INTEGER REFERENCES public.motoristas(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  fcm_token TEXT,
  nome TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  ultimo_contato_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS monitor_devices_tipo_ativo_idx
  ON public.monitor_devices (tipo, ativo);
CREATE INDEX IF NOT EXISTS monitor_devices_motorista_idx
  ON public.monitor_devices (motorista_id);

CREATE TABLE IF NOT EXISTS public.monitor_messages (
  id SERIAL PRIMARY KEY,
  monitor_device_id INTEGER NOT NULL REFERENCES public.monitor_devices(id),
  event_id TEXT NOT NULL,
  origem TEXT NOT NULL,
  codigos JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitor_messages_device_event_unique UNIQUE (monitor_device_id, event_id)
);
CREATE INDEX IF NOT EXISTS monitor_messages_criado_em_idx
  ON public.monitor_messages (criado_em);

CREATE TABLE IF NOT EXISTS public.monitor_deliveries (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES public.monitor_messages(id),
  motorista_id INTEGER NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES public.monitor_devices(id),
  codigo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitor_deliveries_unique UNIQUE (message_id, device_id, codigo)
);
CREATE INDEX IF NOT EXISTS monitor_deliveries_motorista_data_idx
  ON public.monitor_deliveries (motorista_id, criado_em);

/* ========================= 10. NAVIOS / COMPOSIO + AVISOS DE CLIMA ====== */

-- Leituras literais das fontes do Composio (monitor de navios em 2º plano).
CREATE TABLE IF NOT EXISTS public.navios_monitor_fontes (
  fonte TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  dados TEXT,
  texto_fonte TEXT,
  revisao INTEGER NOT NULL DEFAULT 0,
  lido_em TIMESTAMPTZ,
  tentativa_em TIMESTAMPTZ,
  leitura_ate TIMESTAMPTZ,
  token_leitura TEXT,
  erro TEXT
);

-- Fila durável de avisos de navios (cada evento sai uma vez só).
CREATE TABLE IF NOT EXISTS public.navios_monitor_eventos (
  id SERIAL PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  fonte TEXT NOT NULL,
  navio TEXT NOT NULL,
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  mensagem_id INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  publicado_em TIMESTAMPTZ,
  push_em TIMESTAMPTZ,
  envio_ate TIMESTAMPTZ,
  tentativas INTEGER NOT NULL DEFAULT 0,
  erro TEXT
);
CREATE INDEX IF NOT EXISTS navios_monitor_eventos_pendentes_idx
  ON public.navios_monitor_eventos (id) WHERE push_em IS NULL;

-- Avisos de navios de fertilizantes já enviados.
CREATE TABLE IF NOT EXISTS public.navios_avisos (
  chave TEXT PRIMARY KEY,
  navio TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RADAR da previsão: uma linha por mudança publicada no chat.
CREATE TABLE IF NOT EXISTS public.clima_mudancas (
  id SERIAL PRIMARY KEY,
  assinatura TEXT NOT NULL UNIQUE,
  resumo TEXT NOT NULL,
  grave INTEGER NOT NULL DEFAULT 0,
  mensagem_id INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clima_mudancas_criado_em_idx
  ON public.clima_mudancas (criado_em);

/* ================================== 11. BANNER PERSONALIZADO ============= */

CREATE TABLE IF NOT EXISTS public.banners_motorista (
  motorista_id INTEGER PRIMARY KEY REFERENCES public.motoristas(id) ON DELETE CASCADE,
  imagem TEXT NOT NULL,
  via TEXT NOT NULL,
  versao TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.banner_fontes (
  token TEXT PRIMARY KEY,
  imagem TEXT NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL
);

/* ============================ 12. INTERNET / eSIM (piloto admin) ========= */

CREATE TABLE IF NOT EXISTS public.esim_users (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER REFERENCES public.motoristas(id) ON DELETE SET NULL,
  CONSTRAINT esim_users_motorista_id_unique UNIQUE (motorista_id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esim_users_email_idx ON public.esim_users (email);

CREATE TABLE IF NOT EXISTS public.esim_plans (
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
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esim_plans_active_idx
  ON public.esim_plans (active, available);

CREATE TABLE IF NOT EXISTS public.esim_orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.esim_users(id),
  plan_id INTEGER NOT NULL REFERENCES public.esim_plans(id),
  status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
  currency TEXT NOT NULL DEFAULT 'USD',
  cost_amount NUMERIC(19,6) NOT NULL,
  amount NUMERIC(19,2) NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_order_code TEXT UNIQUE,
  provider_callback_url TEXT,
  provider_status_code INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esim_orders_user_idx
  ON public.esim_orders (user_id, created_at);
CREATE INDEX IF NOT EXISTS esim_orders_status_idx
  ON public.esim_orders (status);

CREATE TABLE IF NOT EXISTS public.esim_payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES public.esim_orders(id) ON DELETE CASCADE,
  gateway TEXT NOT NULL DEFAULT 'unconfigured',
  gateway_payment_id TEXT UNIQUE,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  amount NUMERIC(19,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esim_payments_status_idx
  ON public.esim_payments (status);

CREATE TABLE IF NOT EXISTS public.esims (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.esim_users(id),
  order_id INTEGER NOT NULL REFERENCES public.esim_orders(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES public.esim_plans(id),
  iccid TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  provider_status TEXT,
  qr_code TEXT,
  qr_url TEXT,
  activation_code TEXT,
  installation_url TEXT,
  smdp TEXT,
  expires_at TIMESTAMPTZ,
  total_data_amount NUMERIC(19,6),
  total_data_unit TEXT,
  source TEXT NOT NULL DEFAULT 'nexa',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esims_user_idx
  ON public.esims (user_id, created_at);
CREATE INDEX IF NOT EXISTS esims_order_idx
  ON public.esims (order_id);

CREATE TABLE IF NOT EXISTS public.esim_usage (
  id SERIAL PRIMARY KEY,
  esim_id INTEGER NOT NULL REFERENCES public.esims(id) ON DELETE CASCADE,
  used_amount NUMERIC(19,6),
  remaining_amount NUMERIC(19,6),
  data_unit TEXT,
  provider_payload_hash TEXT,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  queried_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esim_usage_esim_idx
  ON public.esim_usage (esim_id, queried_at);

CREATE TABLE IF NOT EXISTS public.esim_topups (
  id SERIAL PRIMARY KEY,
  esim_id INTEGER NOT NULL REFERENCES public.esims(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES public.esim_plans(id),
  payment_id INTEGER REFERENCES public.esim_payments(id),
  provider_topup_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount NUMERIC(19,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esim_topups_esim_idx
  ON public.esim_topups (esim_id, created_at);

CREATE TABLE IF NOT EXISTS public.esim_webhook_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  provider_event_id TEXT,
  provider_order_code TEXT,
  event_type TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  result TEXT NOT NULL DEFAULT '',
  pending_payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT esim_webhook_events_provider_hash_unique UNIQUE (provider, event_hash),
  CONSTRAINT esim_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS esim_webhook_events_status_idx
  ON public.esim_webhook_events (status, received_at);

CREATE TABLE IF NOT EXISTS public.esim_api_errors (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  http_status INTEGER,
  provider_error_code TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS esim_api_errors_created_idx
  ON public.esim_api_errors (created_at);

CREATE TABLE IF NOT EXISTS public.esim_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================ 12.1 PORTAL DO MOTORISTA (07/11/2026) ====== */
-- O motorista cadastra no app o PRÓPRIO CPF e a senha do
-- portal.copadubo.com.br. `cpf` e `senha_cifrada` são AES-256-GCM (mesma
-- chave mestra do cofre de API Keys): quem lê a tabela não lê o segredo.
CREATE TABLE IF NOT EXISTS public.portal_motorista_acessos (
  motorista_id INTEGER PRIMARY KEY,
  cpf TEXT NOT NULL,
  cpf_final TEXT NOT NULL,
  senha_cifrada TEXT NOT NULL,
  senha_final4 TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma linha por leitura da página de status (seções/linhas, o que mudou e o
-- diagnóstico da tentativa). Histórico de 7 dias.
CREATE TABLE IF NOT EXISTS public.portal_leituras (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  login_recusado INTEGER NOT NULL DEFAULT 0,
  captcha INTEGER NOT NULL DEFAULT 0,
  status_http INTEGER,
  titulo TEXT,
  total_linhas INTEGER NOT NULL DEFAULT 0,
  secoes JSONB,
  sinais JSONB,
  hash TEXT,
  novas JSONB,
  removidas JSONB,
  diagnostico TEXT,
  ms INTEGER NOT NULL DEFAULT 0,
  avisado INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS portal_leituras_motorista_idx
  ON public.portal_leituras (motorista_id, id DESC);
CREATE INDEX IF NOT EXISTS portal_leituras_criado_idx
  ON public.portal_leituras (criado_em);

-- Avisos de SAÍDA do ponto (trabalho para onde saiu / dispensa). O modo de
-- teste fica em `configuracao` (portal_saida_modo).
CREATE TABLE IF NOT EXISTS public.portal_eventos (
  id SERIAL PRIMARY KEY,
  motorista_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  codigo TEXT,
  turno TEXT,
  motivo TEXT,
  tipo_trabalho TEXT,
  livro TEXT,
  destino TEXT NOT NULL DEFAULT 'nenhum',
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  diagnostico TEXT,
  modo TEXT NOT NULL DEFAULT 'desligado',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS portal_eventos_motorista_idx
  ON public.portal_eventos (motorista_id, id DESC);
CREATE INDEX IF NOT EXISTS portal_eventos_criado_idx
  ON public.portal_eventos (criado_em);

-- Avisos de saída ESPERANDO a consulta ao portal (10/11/2026). Quando o ponto
-- some do quadro, a saída entra aqui; o app entra no portal com a conta do
-- motorista, lê a situação do ponto (ATIVO / ESCALADO / EM DISPENSA) e só
-- então envia o aviso. Uma linha por ponto, apagada assim que o aviso sai.
CREATE TABLE IF NOT EXISTS public.portal_saidas_pendentes (
  id SERIAL PRIMARY KEY,
  ponto_id INTEGER NOT NULL,
  motorista_id INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  livro TEXT NOT NULL,
  numero INTEGER NOT NULL,
  codigo_na_vez TEXT NOT NULL,
  saida_por_ultimo INTEGER NOT NULL DEFAULT 0,
  tentativas INTEGER NOT NULL DEFAULT 0,
  proxima_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  em_andamento_ate TIMESTAMPTZ,
  ultimo_status TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portal_saida_pendente_ponto UNIQUE (ponto_id)
);
CREATE INDEX IF NOT EXISTS portal_saidas_pendentes_proxima_idx
  ON public.portal_saidas_pendentes (proxima_em);

-- Monitoramento pelo STATUS do portal (10/11/2026). A sessão aberta no portal
-- fica cifrada como a senha e é reaproveitada entre as leituras (o login só se
-- repete quando o portal pedir); `proxima_leitura_em` marca a próxima leitura.
ALTER TABLE public.portal_motorista_acessos
  ADD COLUMN IF NOT EXISTS sessao_cifrada TEXT,
  ADD COLUMN IF NOT EXISTS proxima_leitura_em TIMESTAMPTZ;

-- Situação de cada ponto no portal (ATIVO / ESCALADO / EM DISPENSA), como o app
-- leu pela última vez. A troca desta situação decide os avisos de saída e de
-- volta. Uma linha por ponto.
CREATE TABLE IF NOT EXISTS public.portal_situacoes (
  ponto_id INTEGER PRIMARY KEY,
  motorista_id INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  turno TEXT NOT NULL,
  mudou_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS portal_situacoes_motorista_idx
  ON public.portal_situacoes (motorista_id);

-- A fila lida na aba “Fila” do portal (a Tela de Ativos), uma linha por livro.
-- O quadro público foi desligado: a fila do app (card principal, posição dos
-- pontos, avisos de vez) vem daqui. Guarda só a fila geral — os pontos de cada
-- quadro, na ordem, e o último escalado — e, para o diagnóstico, qual conta
-- abriu a tela.
CREATE TABLE IF NOT EXISTS public.portal_fila (
  livro TEXT PRIMARY KEY,
  dados JSONB,
  lido_em TIMESTAMPTZ,
  motorista_id INTEGER,
  tentativa_em TIMESTAMPTZ,
  erro TEXT,
  diagnostico TEXT,
  proxima_leitura_em TIMESTAMPTZ
);

/* ==================================== 13. SEGURANÇA (RLS + PRIVILÉGIOS) ==== */

-- O navegador/APK nunca consulta o banco direto: tudo passa pelo backend
-- Next.js (que usa a DATABASE_URL). RLS sem policy + REVOKE fecham o anon.
ALTER TABLE public.pontos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amostras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motorista_sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_motorista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regras_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testes_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segredos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracoes_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_silenciados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figurinha_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figurinhas_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_pair_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.navios_monitor_fontes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.navios_monitor_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.navios_avisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clima_mudancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners_motorista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banner_fontes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_api_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esim_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_motorista_acessos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_saidas_pendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_situacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_fila ENABLE ROW LEVEL SECURITY;

-- Sem policy, RLS já bloqueia; o REVOKE é a segunda tranca para o PostgREST.
-- Os papéis anon/authenticated só existem no Supabase — num PostgreSQL comum
-- este bloco simplesmente não faz nada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END $$;

COMMIT;

-- Conferência rápida: todas as tabelas do app devem aparecer abaixo (50).
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
