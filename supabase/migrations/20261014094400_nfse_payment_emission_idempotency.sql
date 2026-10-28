BEGIN;

CREATE TABLE IF NOT EXISTS public.nfse_payment_emissions (
    asaas_payment_id text PRIMARY KEY CHECK (btrim(asaas_payment_id) <> ''),
    tenant_id text NOT NULL,
    value numeric(12, 2) NOT NULL,
    cycle text NOT NULL,
    state text NOT NULL CHECK (
        state IN ('processing', 'authorized', 'pending', 'rejected', 'cancelled', 'uncertain', 'legacy_review')
    ),
    provider_status text,
    provider_message text,
    invoice_number text,
    access_link text,
    provider_response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nfse_payment_emissions_state_updated_idx
    ON public.nfse_payment_emissions (state, updated_at DESC);

ALTER TABLE public.nfse_payment_emissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfse_payment_emissions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.nfse_payment_emissions TO service_role;

-- Preserve every payment already associated with an invoice; review it instead of resending it.
INSERT INTO public.nfse_payment_emissions (
    asaas_payment_id,
    tenant_id,
    value,
    cycle,
    state,
    provider_status,
    provider_message,
    invoice_number,
    access_link,
    created_at,
    updated_at
)
SELECT DISTINCT ON (metadata->>'asaas_payment_id')
    metadata->>'asaas_payment_id',
    coalesce(metadata->>'vidracaria_id', client_name, 'unknown'),
    coalesce(value, 0),
    coalesce(metadata->>'ciclo', 'legacy'),
    'legacy_review',
    status,
    error_message,
    invoice_number,
    access_link,
    coalesce(created_at, now()),
    coalesce(created_at, now())
FROM public.system_invoices
WHERE nullif(btrim(metadata->>'asaas_payment_id'), '') IS NOT NULL
ORDER BY metadata->>'asaas_payment_id', created_at ASC NULLS LAST
ON CONFLICT (asaas_payment_id) DO NOTHING;

COMMIT;
