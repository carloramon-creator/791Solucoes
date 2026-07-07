-- Permite mapear onde cada prompt deve ser aplicado (módulos/rotas de uso)
ALTER TABLE public.ai_prompt_configs
  ADD COLUMN IF NOT EXISTS uso_em TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_ai_prompt_configs_uso_em
  ON public.ai_prompt_configs USING GIN (uso_em);

UPDATE public.ai_prompt_configs
SET uso_em = ARRAY['orcamentos.credito']
WHERE chave = 'credito_analise'
  AND COALESCE(cardinality(uso_em), 0) = 0;

UPDATE public.ai_prompt_configs
SET uso_em = ARRAY['financeiro.custos']
WHERE chave = 'custos_analise'
  AND COALESCE(cardinality(uso_em), 0) = 0;

UPDATE public.ai_prompt_configs
SET uso_em = ARRAY['estoque.analise']
WHERE chave = 'estoque_analise'
  AND COALESCE(cardinality(uso_em), 0) = 0;
