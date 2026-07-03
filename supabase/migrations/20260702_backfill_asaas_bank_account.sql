update public.system_finance_records as r
set
  bank_account_id = a.id,
  metadata = coalesce(r.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'bank_id', a.id,
      'bank_name', a.bank_name,
      'source', 'asaas_backfill'
    )
from public.system_bank_accounts as a
where r.bank_account_id is null
  and lower(coalesce(r.payment_method, '')) = 'asaas'
  and lower(coalesce(a.bank_name, '')) like '%asaas%'
  and (
    lower(coalesce(a.name, '')) like '%asaas%'
    or lower(coalesce(r.bank_id, '')) = 'asaas'
    or lower(coalesce((r.metadata ->> 'source'), '')) like '%asaas%'
    or lower(coalesce((r.metadata ->> 'bank_name'), '')) like '%asaas%'
    or lower(coalesce(r.description, '')) like '%asaas%'
  );

-- Opcional: se quiser conferir o que foi afetado antes/depois, rode:
-- select id, description, payment_method, bank_account_id, metadata
-- from public.system_finance_records
-- where lower(coalesce(payment_method, '')) = 'asaas'
-- order by created_at desc;
