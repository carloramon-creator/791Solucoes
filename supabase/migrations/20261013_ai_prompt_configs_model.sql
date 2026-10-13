-- Modelo de IA opcional por prompt; vazio usa o modelo padrão do servidor.
ALTER TABLE public.ai_prompt_configs
  ADD COLUMN IF NOT EXISTS modelo TEXT;
