BEGIN;
INSERT INTO public.ai_usage_events (
    id, tenant_id, usuario_id, funcao, provider, model, tentativa, status,
    tokens_entrada, tokens_saida, tokens_total, created_at
)
SELECT gen_random_uuid(), '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333', 'credito.analise', 'openai',
    'gpt-4o-mini', 1, 'concluida', 17, 5, 22, '2099-01-01T10:00:00Z'::timestamptz
FROM generate_series(1,55);
INSERT INTO public.ai_usage_events (
    id, tenant_id, usuario_id, funcao, provider, model, tentativa, status, created_at
) VALUES (
    gen_random_uuid(), '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333', 'estoque.analise', 'openai',
    'gpt-4o-mini', 1, 'erro', '2099-01-01T11:00:00Z'
);
DO $$
DECLARE report jsonb;
BEGIN
    report := public.ai_usage_report('2099-01-01T03:00:00Z', '2099-01-02T03:00:00Z', NULL, NULL, 1);
    ASSERT (report->>'total')::integer = 56, 'wrong full count';
    ASSERT jsonb_array_length(report->'eventos') = 50, 'wrong page size';
    ASSERT jsonb_array_length(report->'tenants') = 2, 'wrong tenant grouping';
    ASSERT (report->'tenants'->0->>'tokens_total')::integer = 1210, 'summary was truncated to page';
    ASSERT (report->'tenants'->0->>'tokens_entrada')::integer = 935, 'wrong prompt count';
    ASSERT (report->'tenants'->1->>'chamadas_com_consumo')::integer = 0, 'unknown usage reported as known';
    ASSERT (report->'tenants'->1->>'erros')::integer = 1, 'error excluded';
    report := public.ai_usage_report('2099-01-01T03:00:00Z', '2099-01-02T03:00:00Z',
        '11111111-1111-4111-8111-111111111111', 'credito.analise', 2);
    ASSERT jsonb_array_length(report->'eventos') = 5, 'wrong page 2';
    ASSERT (report->>'total')::integer = 55, 'wrong filtered count';
    ASSERT NOT has_table_privilege('anon', 'public.ai_usage_events', 'SELECT'), 'anon can read consumption';
    ASSERT NOT has_table_privilege('authenticated', 'public.ai_usage_events', 'SELECT'), 'authenticated can bypass admin route';
    ASSERT NOT has_function_privilege('authenticated', 'public.ai_usage_report(timestamptz,timestamptz,uuid,text,integer)', 'EXECUTE'), 'RPC exposed to tenants';
END $$;
ROLLBACK;
SELECT 'OK: aggregation, filters, pagination and access restrictions; fixtures rolled back' AS result;
