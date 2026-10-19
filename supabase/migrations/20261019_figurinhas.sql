-- Figurinhas personalizadas do chat dos motoristas: catálogo central + categorias.
-- Recurso ADICIONAL — nenhuma tabela ou coluna existente é alterada.
-- Pode ser aplicada de novo: tudo é criado somente se ainda não existir.
BEGIN;
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
ALTER TABLE public.figurinha_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figurinhas_catalogo ENABLE ROW LEVEL SECURITY;
COMMIT;
