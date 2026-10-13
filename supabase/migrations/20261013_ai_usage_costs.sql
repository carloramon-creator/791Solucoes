BEGIN;

CREATE TABLE public.ai_model_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    model text NOT NULL,
    vigente_desde timestamptz NOT NULL,
    entrada_usd_milhao numeric(16,8) NOT NULL CHECK (entrada_usd_milhao >= 0),
    cache_usd_milhao numeric(16,8) NOT NULL CHECK (cache_usd_milhao >= 0),
    saida_usd_milhao numeric(16,8) NOT NULL CHECK (saida_usd_milhao >= 0),
    fonte text NOT NULL,
    UNIQUE (provider, model, vigente_desde)
);
ALTER TABLE public.ai_model_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_model_prices FROM anon, authenticated;
GRANT SELECT, INSERT ON public.ai_model_prices TO service_role;

INSERT INTO public.ai_model_prices (
    provider, model, vigente_desde, entrada_usd_milhao, cache_usd_milhao, saida_usd_milhao, fonte
)
SELECT 'openai', model, '2026-10-13T00:00:00Z', 0.15, 0.075, 0.60,
    'https://developers.openai.com/api/docs/models/gpt-4o-mini'
FROM unnest(ARRAY['gpt-4o-mini', 'gpt-4o-mini-2024-07-18']) AS model;

ALTER TABLE public.ai_usage_events
    ADD COLUMN operacao_id uuid,
    ADD COLUMN tarifa_id uuid REFERENCES public.ai_model_prices(id),
    ADD COLUMN tarifa_entrada_usd_milhao numeric(16,8),
    ADD COLUMN tarifa_cache_usd_milhao numeric(16,8),
    ADD COLUMN tarifa_saida_usd_milhao numeric(16,8),
    ADD COLUMN custo_estimado_usd numeric(24,12) CHECK (custo_estimado_usd >= 0);

CREATE FUNCTION public.ai_usage_calcular_custo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE tarifa public.ai_model_prices;
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.operacao_id := COALESCE(NEW.operacao_id, NEW.id);
        SELECT * INTO tarifa FROM public.ai_model_prices
        WHERE provider = NEW.provider AND model = NEW.model AND vigente_desde <= NEW.created_at
        ORDER BY vigente_desde DESC LIMIT 1;
        NEW.tarifa_id := tarifa.id;
        NEW.tarifa_entrada_usd_milhao := tarifa.entrada_usd_milhao;
        NEW.tarifa_cache_usd_milhao := tarifa.cache_usd_milhao;
        NEW.tarifa_saida_usd_milhao := tarifa.saida_usd_milhao;
    ELSE
        NEW.tarifa_id := OLD.tarifa_id;
        NEW.tarifa_entrada_usd_milhao := OLD.tarifa_entrada_usd_milhao;
        NEW.tarifa_cache_usd_milhao := OLD.tarifa_cache_usd_milhao;
        NEW.tarifa_saida_usd_milhao := OLD.tarifa_saida_usd_milhao;
        NEW.operacao_id := OLD.operacao_id;
    END IF;
    NEW.custo_estimado_usd := NULL;
    IF NEW.tarifa_id IS NOT NULL
        AND NEW.tokens_entrada IS NOT NULL AND NEW.tokens_saida IS NOT NULL
        AND NEW.tokens_cache IS NOT NULL AND NEW.tokens_cache <= NEW.tokens_entrada THEN
        NEW.custo_estimado_usd := (
            (NEW.tokens_entrada - NEW.tokens_cache) * NEW.tarifa_entrada_usd_milhao
            + NEW.tokens_cache * NEW.tarifa_cache_usd_milhao
            + NEW.tokens_saida * NEW.tarifa_saida_usd_milhao
        ) / 1000000;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_calcular_custo() FROM PUBLIC;

-- Existing recorded tokens can be priced; no unrecorded calls are reconstructed.
UPDATE public.ai_usage_events e SET
    operacao_id = e.id,
    tarifa_id = p.id,
    tarifa_entrada_usd_milhao = p.entrada_usd_milhao,
    tarifa_cache_usd_milhao = p.cache_usd_milhao,
    tarifa_saida_usd_milhao = p.saida_usd_milhao
FROM public.ai_model_prices p
WHERE p.provider = e.provider AND p.model = e.model
    AND p.vigente_desde <= e.created_at;
UPDATE public.ai_usage_events SET operacao_id = id WHERE operacao_id IS NULL;
ALTER TABLE public.ai_usage_events ALTER COLUMN operacao_id SET NOT NULL;

CREATE TRIGGER ai_usage_calcular_custo
BEFORE INSERT OR UPDATE ON public.ai_usage_events
FOR EACH ROW EXECUTE FUNCTION public.ai_usage_calcular_custo();
UPDATE public.ai_usage_events SET tokens_entrada = tokens_entrada;

CREATE OR REPLACE FUNCTION public.ai_usage_report(
    p_inicio timestamptz, p_fim timestamptz, p_tenant uuid DEFAULT NULL,
    p_funcao text DEFAULT NULL, p_pagina integer DEFAULT 1
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
WITH filtrados AS (
    SELECT *, to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes
    FROM public.ai_usage_events
    WHERE created_at >= p_inicio AND created_at < p_fim
      AND (p_tenant IS NULL OR tenant_id = p_tenant)
      AND (p_funcao IS NULL OR funcao = p_funcao)
), por_operacao AS (
    SELECT tenant_id, funcao, mes, operacao_id, grouping(mes) AS todos_meses,
        CASE WHEN count(*) = count(custo_estimado_usd) THEN sum(custo_estimado_usd) END AS custo
    FROM filtrados GROUP BY GROUPING SETS ((tenant_id, funcao, mes, operacao_id), (tenant_id, funcao, operacao_id))
), medias AS (
    SELECT tenant_id, funcao, NULL::text AS mes, grouping(funcao) AS todas_funcoes, 1 AS todos_meses,
        avg(custo) AS custo_medio_operacao_usd, count(custo) AS operacoes_com_custo
    FROM por_operacao WHERE todos_meses = 1
    GROUP BY GROUPING SETS ((tenant_id), (tenant_id, funcao))
    UNION ALL
    SELECT tenant_id, NULL::text, mes, 1, 0, avg(custo), count(custo)
    FROM por_operacao WHERE todos_meses = 0 GROUP BY tenant_id, mes
), totais AS (
    SELECT tenant_id, funcao, mes,
        grouping(funcao) AS todas_funcoes, grouping(mes) AS todos_meses,
        count(*) AS chamadas, count(DISTINCT operacao_id) AS operacoes,
        count(*) FILTER (WHERE tentativa > 1) AS tentativas_extras,
        count(tokens_total) AS chamadas_com_consumo,
        count(custo_estimado_usd) AS chamadas_com_custo,
        count(*) FILTER (WHERE status = 'erro') AS erros,
        count(*) FILTER (WHERE status = 'em_andamento') AS pendentes,
        coalesce(sum(tokens_entrada), 0) AS tokens_entrada,
        coalesce(sum(tokens_saida), 0) AS tokens_saida,
        coalesce(sum(tokens_total), 0) AS tokens_total,
        sum(custo_estimado_usd) AS custo_estimado_usd,
        avg(custo_estimado_usd) AS custo_medio_chamada_usd,
        sum(custo_estimado_usd) FILTER (WHERE tentativa > 1) AS custo_tentativas_usd
    FROM filtrados
    GROUP BY GROUPING SETS ((tenant_id), (tenant_id, funcao), (tenant_id, mes))
), agrupados AS (
    SELECT t.*, m.custo_medio_operacao_usd, m.operacoes_com_custo
    FROM totais t JOIN medias m ON t.tenant_id = m.tenant_id
        AND t.funcao IS NOT DISTINCT FROM m.funcao AND t.mes IS NOT DISTINCT FROM m.mes
        AND t.todas_funcoes = m.todas_funcoes AND t.todos_meses = m.todos_meses
), eventos AS (
    SELECT * FROM filtrados ORDER BY created_at DESC, id
    LIMIT 50 OFFSET (greatest(p_pagina, 1) - 1) * 50
)
SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtrados),
    'tenants', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY custo_estimado_usd DESC NULLS LAST, tenant_id)
        FROM agrupados t WHERE todas_funcoes = 1 AND todos_meses = 1), '[]'::jsonb),
    'funcoes', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY tenant_id, funcao)
        FROM agrupados t WHERE todas_funcoes = 0 AND todos_meses = 1), '[]'::jsonb),
    'mensal', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY mes DESC, tenant_id)
        FROM agrupados t WHERE todas_funcoes = 1 AND todos_meses = 0), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC, id) FROM eventos e), '[]'::jsonb)
);
$$;

COMMIT;
