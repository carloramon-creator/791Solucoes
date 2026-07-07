-- Tabela de prompts editáveis da análise de crédito na Holding
CREATE TABLE IF NOT EXISTS public.ai_prompt_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  versao INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_configs_chave
  ON public.ai_prompt_configs (chave);