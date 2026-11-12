-- Idempotência de pagamentos do webhook Asaas em system_finance_records.
-- Contexto: o Asaas reenvia o mesmo pagamento (PAYMENT_CONFIRMED + PAYMENT_RECEIVED + retries),
-- o que gerou lançamentos de receita duplicados para um único recebimento.

-- 1) Remove duplicatas existentes, mantendo o lançamento mais antigo de cada pagamento.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY metadata->>'id'
      ORDER BY created_at ASC
    ) AS rn
  FROM system_finance_records
  WHERE metadata->>'source' = 'asaas_webhook'
    AND COALESCE(metadata->>'id', '') <> ''
)
DELETE FROM system_finance_records
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Garante unicidade por pagamento do Asaas (protege contra eventos concorrentes).
CREATE UNIQUE INDEX IF NOT EXISTS system_finance_records_asaas_payment_uniq
  ON system_finance_records ((metadata->>'id'))
  WHERE metadata->>'source' = 'asaas_webhook'
    AND metadata->>'id' IS NOT NULL;
