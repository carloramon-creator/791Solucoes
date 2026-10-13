BEGIN;

CREATE TABLE public.ai_usage_events (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    funcao text NOT NULL CHECK (funcao IN ('credito.validacao', 'credito.analise', 'estoque.analise', 'financeiro.custos')),
    referencia_id uuid,
    prompt_chave text,
    prompt_versao integer,
    provider text NOT NULL CHECK (provider IN ('openai', 'gemini')),
    model text NOT NULL,
    tentativa integer NOT NULL CHECK (tentativa > 0),
    status text NOT NULL CHECK (status IN ('em_andamento', 'concluida', 'erro')),
    tokens_entrada bigint CHECK (tokens_entrada >= 0),
    tokens_saida bigint CHECK (tokens_saida >= 0),
    tokens_total bigint CHECK (tokens_total >= 0),
    tokens_cache bigint CHECK (tokens_cache >= 0),
    http_status integer,
    erro_codigo text,
    provider_request_id text,
    duracao_ms bigint CHECK (duracao_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    finalizado_em timestamptz
);
CREATE INDEX ai_usage_events_periodo ON public.ai_usage_events (created_at DESC, id);
CREATE INDEX ai_usage_events_tenant_periodo ON public.ai_usage_events (tenant_id, created_at DESC);
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_usage_events TO service_role;

CREATE FUNCTION public.ai_usage_report(
    p_inicio timestamptz, p_fim timestamptz, p_tenant uuid DEFAULT NULL,
    p_funcao text DEFAULT NULL, p_pagina integer DEFAULT 1
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
WITH filtrados AS (
    SELECT * FROM public.ai_usage_events
    WHERE created_at >= p_inicio AND created_at < p_fim
      AND (p_tenant IS NULL OR tenant_id = p_tenant)
      AND (p_funcao IS NULL OR funcao = p_funcao)
), tenants AS (
    SELECT tenant_id, count(*) AS chamadas,
        count(tokens_total) AS chamadas_com_consumo,
        count(*) FILTER (WHERE status = 'erro') AS erros,
        count(*) FILTER (WHERE status = 'em_andamento') AS pendentes,
        coalesce(sum(tokens_entrada), 0) AS tokens_entrada,
        coalesce(sum(tokens_saida), 0) AS tokens_saida,
        coalesce(sum(tokens_total), 0) AS tokens_total
    FROM filtrados GROUP BY tenant_id
), eventos AS (
    SELECT * FROM filtrados ORDER BY created_at DESC, id
    LIMIT 50 OFFSET (greatest(p_pagina, 1) - 1) * 50
)
SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtrados),
    'tenants', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY tokens_total DESC, tenant_id) FROM tenants t), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC, id) FROM eventos e), '[]'::jsonb)
);
$$;
REVOKE ALL ON FUNCTION public.ai_usage_report(timestamptz, timestamptz, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_report(timestamptz, timestamptz, uuid, text, integer) TO service_role;

COMMIT;
