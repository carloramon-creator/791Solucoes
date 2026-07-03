alter table public.system_finance_records
  add column if not exists documento text;

comment on column public.system_finance_records.documento is 'Documento de referência do lançamento (nota, contrato, boleto, protocolo etc.).';
