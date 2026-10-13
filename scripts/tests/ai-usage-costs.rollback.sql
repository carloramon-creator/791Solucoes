BEGIN;

DO $$
DECLARE
    tenant uuid := '11111111-1111-4111-8111-111111111111';
    usuario uuid := '33333333-3333-4333-8333-333333333333';
    operacao uuid := gen_random_uuid();
    evento uuid := gen_random_uuid();
    custo numeric;
    report jsonb;
BEGIN
    INSERT INTO public.ai_usage_events (
        id, tenant_id, usuario_id, operacao_id, funcao, provider, model, tentativa, status,
        tokens_entrada, tokens_cache, tokens_saida, tokens_total, created_at
    ) VALUES (
        evento, tenant, usuario, operacao, 'credito.analise', 'openai', 'gpt-4o-mini', 1, 'concluida',
        17, 0, 5, 22, '2098-10-01T02:59:59Z'
    );
    SELECT custo_estimado_usd INTO custo FROM public.ai_usage_events WHERE id = evento;
    ASSERT custo = 0.00000555, 'wrong sub-cent price';
    INSERT INTO public.ai_usage_events (
        id, tenant_id, usuario_id, operacao_id, funcao, provider, model, tentativa, status,
        tokens_entrada, tokens_cache, tokens_saida, tokens_total, created_at
    ) VALUES (
        gen_random_uuid(), tenant, usuario, operacao, 'credito.analise', 'openai', 'gpt-4o-mini', 2, 'concluida',
        100, 40, 20, 120, '2098-10-01T03:00:00Z'
    );
    report := public.ai_usage_report('2098-09-01T03:00:00Z', '2098-11-01T03:00:00Z', tenant, NULL, 1);
    ASSERT (report->'tenants'->0->>'custo_estimado_usd')::numeric = 0.00002955, 'cached input counted twice';
    ASSERT (report->'tenants'->0->>'custo_medio_operacao_usd')::numeric = 0.00002955, 'cross-month operation duplicated in average';
    ASSERT (report->'tenants'->0->>'custo_medio_chamada_usd')::numeric = 0.000014775, 'wrong per-call average';
    ASSERT (report->'tenants'->0->>'operacoes')::integer = 1, 'retries counted as new analyses';
    ASSERT (report->'tenants'->0->>'tentativas_extras')::integer = 1, 'retry not reported';
    ASSERT (report->'tenants'->0->>'custo_tentativas_usd')::numeric = 0.000024, 'wrong retry cost';
    ASSERT jsonb_array_length(report->'mensal') = 2, 'Brasilia month boundary ignored';
    ASSERT (report->'mensal'->0->>'mes') = '2098-10', 'wrong latest month';
    ASSERT (report->'funcoes'->0->>'funcao') = 'credito.analise', 'wrong function summary';

    -- A new future tariff must not reprice the completed historical event.
    INSERT INTO public.ai_model_prices (
        provider, model, vigente_desde, entrada_usd_milhao, cache_usd_milhao, saida_usd_milhao, fonte
    ) VALUES ('openai', 'gpt-4o-mini', '2098-10-02T00:00:00Z', 1, 0.5, 2, 'fixture');
    UPDATE public.ai_usage_events SET status = 'concluida', tarifa_entrada_usd_milhao = 999 WHERE id = evento;
    ASSERT (SELECT custo_estimado_usd FROM public.ai_usage_events WHERE id = evento) = custo, 'historical price mutated';
    INSERT INTO public.ai_usage_events (
        id, tenant_id, usuario_id, funcao, provider, model, tentativa, status,
        tokens_entrada, tokens_cache, tokens_saida, tokens_total, created_at
    ) VALUES (
        gen_random_uuid(), tenant, usuario, 'estoque.analise', 'openai', 'gpt-4o-mini', 1, 'concluida',
        100, 0, 20, 120, '2098-10-03T10:00:00Z'
    );
    ASSERT (SELECT custo_estimado_usd FROM public.ai_usage_events WHERE tenant_id = tenant AND funcao = 'estoque.analise' AND created_at = '2098-10-03T10:00:00Z') = 0.00014, 'new tariff not used';

    INSERT INTO public.ai_usage_events (
        id, tenant_id, usuario_id, funcao, provider, model, tentativa, status,
        tokens_entrada, tokens_cache, tokens_saida, tokens_total, created_at
    ) VALUES
        (gen_random_uuid(), tenant, usuario, 'financeiro.custos', 'gemini', 'unknown-model', 1, 'concluida', 10, 0, 5, 15, '2098-10-04T10:00:00Z'),
        (gen_random_uuid(), tenant, usuario, 'financeiro.custos', 'openai', 'gpt-4o-mini', 1, 'erro', NULL, NULL, NULL, NULL, '2098-10-04T11:00:00Z'),
        (gen_random_uuid(), tenant, usuario, 'financeiro.custos', 'openai', 'gpt-4o-mini', 1, 'concluida', 10, 11, 5, 15, '2098-10-04T12:00:00Z');
    report := public.ai_usage_report('2098-10-04T03:00:00Z', '2098-10-05T03:00:00Z', tenant, 'financeiro.custos', 1);
    ASSERT (report->'tenants'->0->>'custo_estimado_usd') IS NULL, 'unknown tariff/usage became zero';
    ASSERT (report->'tenants'->0->>'chamadas_com_custo')::integer = 0, 'invalid/missing usage priced';
    ASSERT (report->'tenants'->0->>'custo_medio_operacao_usd') IS NULL, 'unknown operation cost in mean';

    INSERT INTO public.ai_usage_events (
        id, tenant_id, usuario_id, funcao, provider, model, tentativa, status,
        tokens_entrada, tokens_cache, tokens_saida, tokens_total, created_at
    )
    SELECT gen_random_uuid(), tenant, usuario, 'credito.validacao', 'openai', 'gpt-4o-mini', 1,
        'concluida', 17, 0, 5, 22, '2098-08-01T10:00:00Z'::timestamptz
    FROM generate_series(1,55);
    report := public.ai_usage_report('2098-08-01T03:00:00Z', '2098-08-02T03:00:00Z', tenant, NULL, 2);
    ASSERT jsonb_array_length(report->'eventos') = 5, 'wrong detail pagination';
    ASSERT (report->'tenants'->0->>'custo_estimado_usd')::numeric = 55 * 0.00000555, 'cost summary truncated to page';
    ASSERT NOT has_table_privilege('authenticated', 'public.ai_model_prices', 'SELECT'), 'tenant can read tariffs';
END $$;

ROLLBACK;
SELECT 'OK: precise USD costs, cache, retries, monthly timezone, historical tariffs, unknowns and pagination; fixtures rolled back' AS result;
