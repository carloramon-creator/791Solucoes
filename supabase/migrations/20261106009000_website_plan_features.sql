begin;

alter table public.holding_website_plans
  add column website_features text[] not null default '{}';

update public.holding_website_plans
set website_features = array['configuration','briefing','templates','content','images']::text[]
  || case when project_type in ('catalog','store') then array['catalog']::text[] else '{}'::text[] end
where category = 'creation';

alter table public.holding_website_plans
  add constraint holding_website_plan_features_check check (
    website_features <@ array[
      'configuration','briefing','templates','content','images','catalog','domain_managed','customer_dns','email_setup'
    ]::text[]
    and (category = 'creation' or cardinality(website_features) = 0)
    and (category <> 'creation' or website_features @> array['configuration','briefing']::text[])
    and ('catalog' <> all(website_features) or project_type in ('catalog','store'))
  );

create or replace function public.holding_create_website_contract(
  p_request_id uuid, p_customer_id uuid, p_plan_id uuid, p_total_cents integer, p_payment_method text, p_schedule jsonb
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_customer public.holding_customers;
  v_plan public.holding_website_plans;
  v_id uuid;
  v_existing public.holding_website_contracts;
  v_schedule jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing from public.holding_website_contracts where request_id = p_request_id;
  if found then
    select jsonb_agg(jsonb_build_object('number', number, 'kind', kind, 'amount_cents', amount_cents,
      'due_date', to_char(due_date, 'YYYY-MM-DD')) order by number) into v_schedule
    from public.holding_website_installments where contract_id = v_existing.id;
    if v_existing.customer_id <> p_customer_id or v_existing.plan_id <> p_plan_id
      or v_existing.total_cents <> p_total_cents or v_existing.payment_method <> p_payment_method
      or v_schedule <> p_schedule then
      raise exception using errcode = '22023', message = 'Tentativa reutilizada com dados diferentes';
    end if;
    return v_existing.id;
  end if;
  select * into strict v_customer from public.holding_customers where id = p_customer_id and active for share;
  select * into strict v_plan from public.holding_website_plans
    where id = p_plan_id and active and billing_cycle = 'one_time' for share;
  if jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) not between 1 and 13 then
    raise exception 'Cronograma invalido';
  end if;
  if (select sum((row->>'amount_cents')::integer) from jsonb_array_elements(p_schedule) row) <> p_total_cents then
    raise exception 'Parcelas nao correspondem ao total';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_schedule) with ordinality as item(row, position)
    where (row->>'number')::integer <> position
      or row->>'kind' not in ('deposit', 'balance')
      or (row->>'kind' = 'deposit' and position <> 1)
  ) then raise exception 'Ordem das parcelas invalida'; end if;

  insert into public.holding_website_contracts (
    request_id, customer_id, plan_id, customer_snapshot, plan_snapshot, total_cents, payment_method
  ) values (
    p_request_id, p_customer_id, p_plan_id,
    jsonb_build_object(
      'name', v_customer.name, 'document', v_customer.document, 'email', v_customer.email,
      'postal_code', v_customer.postal_code, 'address', v_customer.address,
      'address_number', v_customer.address_number, 'complement', v_customer.complement,
      'district', v_customer.district, 'city', v_customer.city, 'state', v_customer.state
    ),
    jsonb_build_object(
      'name', v_plan.name, 'scope', v_plan.scope, 'description', v_plan.description,
      'fiscal_config', v_plan.fiscal_config, 'website_features', to_jsonb(v_plan.website_features),
      'invoice_policy', 'manual_project_total'
    ),
    p_total_cents, p_payment_method
  ) returning id into v_id;
  insert into public.holding_website_installments(contract_id, number, kind, amount_cents, due_date)
  select v_id, (row->>'number')::integer, row->>'kind', (row->>'amount_cents')::integer, (row->>'due_date')::date
  from jsonb_array_elements(p_schedule) row;
  return v_id;
end;
$$;
revoke all on function public.holding_create_website_contract(uuid, uuid, uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.holding_create_website_contract(uuid, uuid, uuid, integer, text, jsonb) to service_role;

create or replace function public.holding_edit_website_contract(
  p_id uuid, p_revision integer, p_locked_at timestamptz, p_previous_state text,
  p_plan_id uuid, p_total_cents integer, p_payment_method text, p_schedule jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_contract public.holding_website_contracts;
  v_customer public.holding_customers;
  v_plan public.holding_website_plans;
begin
  select * into strict v_contract from public.holding_website_contracts where id=p_id for update;
  if v_contract.billing_state <> 'processing' or v_contract.edit_revision <> p_revision
    or v_contract.updated_at is distinct from p_locked_at or p_previous_state not in ('local','issued','review') then
    raise exception 'Contratacao alterada por outra operacao';
  end if;
  if exists(select 1 from public.holding_website_invoices where contract_id=p_id) then
    raise exception 'Contratacao com operacao fiscal nao pode ser editada';
  end if;
  select * into strict v_customer from public.holding_customers where id=v_contract.customer_id and active for share;
  select * into strict v_plan from public.holding_website_plans where id=p_plan_id and active and billing_cycle='one_time' for share;
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) not between 1 and 13
    or (select sum((item->>'amount_cents')::integer) from jsonb_array_elements(p_schedule) item) is distinct from p_total_cents then
    raise exception 'Cronograma invalido';
  end if;
  if exists(select 1 from jsonb_array_elements(p_schedule) with ordinality as item(row,position)
    where (row->>'number')::integer is distinct from position
      or row->>'kind' is null or row->>'kind' not in ('deposit','balance')
      or (row->>'kind'='deposit' and position<>1)) then raise exception 'Ordem das parcelas invalida'; end if;
  insert into public.holding_website_contract_edits(contract_id,previous_contract,previous_installments)
    select p_id,jsonb_set(to_jsonb(v_contract),'{billing_state}',to_jsonb(p_previous_state)),
      coalesce(jsonb_agg(to_jsonb(i) order by i.number),'[]'::jsonb)
    from public.holding_website_installments i where i.contract_id=p_id;
  delete from public.holding_website_installments where contract_id=p_id;
  insert into public.holding_website_installments(contract_id,number,kind,amount_cents,due_date)
    select p_id,(row->>'number')::integer,row->>'kind',(row->>'amount_cents')::integer,(row->>'due_date')::date
    from jsonb_array_elements(p_schedule) row;
  update public.holding_website_contracts set
    plan_id=p_plan_id,total_cents=p_total_cents,payment_method=p_payment_method,
    customer_snapshot=jsonb_build_object('name',v_customer.name,'document',v_customer.document,'email',v_customer.email,
      'postal_code',v_customer.postal_code,'address',v_customer.address,'address_number',v_customer.address_number,
      'complement',v_customer.complement,'district',v_customer.district,'city',v_customer.city,'state',v_customer.state),
    plan_snapshot=jsonb_build_object('name',v_plan.name,'scope',v_plan.scope,'description',v_plan.description,
      'fiscal_config',v_plan.fiscal_config,'website_features',to_jsonb(v_plan.website_features),
      'invoice_policy','manual_project_total'),
    edit_revision=edit_revision+1,billing_state='local',asaas_environment=null
    where id=p_id;
  return p_id;
end;
$$;
revoke all on function public.holding_edit_website_contract(uuid,integer,timestamptz,text,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.holding_edit_website_contract(uuid,integer,timestamptz,text,uuid,integer,text,jsonb) to service_role;

commit;
