-- Tarifas oficiais OpenAI (USD por 1M de tokens, contexto curto), conferidas em developers.openai.com/api/docs/pricing em 2026-10-13.
INSERT INTO public.ai_model_prices (provider, model, vigente_desde, entrada_usd_milhao, cache_usd_milhao, saida_usd_milhao, fonte)
VALUES
  ('openai', 'gpt-4.1-mini', '2026-10-13T00:00:00Z', 0.40, 0.10, 1.60, 'https://developers.openai.com/api/docs/pricing'),
  ('openai', 'gpt-4.1', '2026-10-13T00:00:00Z', 2.00, 0.50, 8.00, 'https://developers.openai.com/api/docs/pricing'),
  ('openai', 'gpt-5-mini', '2026-10-13T00:00:00Z', 0.25, 0.025, 2.00, 'https://developers.openai.com/api/docs/pricing'),
  ('openai', 'gpt-5', '2026-10-13T00:00:00Z', 1.25, 0.125, 10.00, 'https://developers.openai.com/api/docs/pricing')
ON CONFLICT (provider, model, vigente_desde) DO NOTHING;
