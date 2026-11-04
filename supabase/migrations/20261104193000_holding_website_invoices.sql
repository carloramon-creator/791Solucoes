begin;

create table public.holding_website_invoices (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references public.holding_website_contracts(id),
  status text not null check (status in ('preparing', 'sending', 'authorized', 'review')),
  competence date not null,
  operation text not null unique,
  dps_number text not null,
  series text not null,
  issuer_document text not null,
  result jsonb,
  system_invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.holding_website_invoices enable row level security;
revoke all on public.holding_website_invoices from public, anon, authenticated;
grant select, insert, update on public.holding_website_invoices to service_role;
create trigger trg_holding_website_invoices_updated_at before update on public.holding_website_invoices
for each row execute procedure public.set_holding_updated_at();

-- A mesma sequencia por serie do emissor existente, atualizada atomicamente.
-- Nao modifica configuracoes fiscais, planos ou tabelas de tenants.
create function public.holding_reserve_website_invoice(
  p_contract_id uuid, p_competence date, p_series text, p_issuer_document text
) returns public.holding_website_invoices
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_contract public.holding_website_contracts;
  v_invoice public.holding_website_invoices;
  v_seq_id text := 'nfse_sequencia_producao_' || p_series;
  v_operation text := 'nfse_producao_website_' || p_contract_id::text;
  v_value jsonb;
  v_number bigint;
begin
  select * into strict v_contract from public.holding_website_contracts where id=p_contract_id for update;
  if exists(select 1 from public.holding_website_invoices where contract_id=p_contract_id) then
    raise exception using errcode='23505', message='Operacao fiscal ja reservada; nao reenvie';
  end if;
  if p_competence is null or p_series is null or p_issuer_document is null
    or p_series !~ '^[0-9]{1,5}$' or p_series::integer not between 1 and 49999
    or p_issuer_document !~ '^[0-9]{14}$' or extract(year from p_competence) <> 2026 then
    raise exception 'Parametros nacionais invalidos';
  end if;
  if v_contract.plan_snapshot->>'invoice_policy' is distinct from 'manual_project_total' then
    raise exception 'Politica fiscal nao e de projeto manual';
  end if;
  insert into public.system_settings(id,value,updated_at)
    values(v_seq_id,jsonb_build_object('numero',0),now()) on conflict(id) do nothing;
  select value into strict v_value from public.system_settings where id=v_seq_id for update;
  if jsonb_typeof(v_value->'numero') is distinct from 'number' or v_value->>'numero' !~ '^[0-9]+$' then
    raise exception 'Sequencia fiscal invalida';
  end if;
  v_number := (v_value->>'numero')::bigint + 1;
  if v_number < 1 or v_number > 999999999999999 then raise exception 'Sequencia fiscal esgotada'; end if;
  update public.system_settings set value=jsonb_build_object('numero',v_number),updated_at=now() where id=v_seq_id;
  insert into public.holding_website_invoices(
    contract_id,status,competence,operation,dps_number,series,issuer_document
  ) values(p_contract_id,'preparing',p_competence,v_operation,v_number::text,p_series,p_issuer_document)
  returning * into v_invoice;
  insert into public.system_settings(id,value,updated_at) values(
    v_operation,
    jsonb_build_object('status','preparando','competencia',p_competence::text,'valor',v_contract.total_cents::numeric/100,
      'operacao', 'website_' || p_contract_id::text,'website_contract_id',p_contract_id),
    now()
  );
  return v_invoice;
end;
$$;
revoke all on function public.holding_reserve_website_invoice(uuid,date,text,text) from public,anon,authenticated;
grant execute on function public.holding_reserve_website_invoice(uuid,date,text,text) to service_role;

commit;
