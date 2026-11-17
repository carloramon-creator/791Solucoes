BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_overage_tenant_month
ON public.system_finance_records ((metadata->>'tenant_id'), (metadata->>'ref_month'))
WHERE metadata->>'kind' = 'overage'
  AND metadata->>'tenant_id' IS NOT NULL
  AND metadata->>'ref_month' IS NOT NULL;

COMMIT;
