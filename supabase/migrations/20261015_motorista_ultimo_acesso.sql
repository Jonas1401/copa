-- Data da última entrada no app + índice para a limpeza de cadastros inativos.
-- Pode ser aplicada de novo: a coluna só é criada se ainda não existir.
-- Quem já estava cadastrado ganha a data de agora, para não ser excluído no
-- primeiro cron após o deploy.
BEGIN;
ALTER TABLE public.motoristas
  ADD COLUMN IF NOT EXISTS ultimo_acesso_em TIMESTAMPTZ;
UPDATE public.motoristas
  SET ultimo_acesso_em = NOW()
  WHERE ultimo_acesso_em IS NULL;
CREATE INDEX IF NOT EXISTS motoristas_ultimo_acesso_em_idx
  ON public.motoristas (ultimo_acesso_em);
COMMIT;
