begin;

create table public.holding_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  document text not null unique check (document ~ '^([0-9]{11}|[0-9]{14})$'),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null default '',
  postal_code text not null default '',
  address text not null default '',
  address_number text not null default '',
  complement text not null default '',
  district text not null default '',
  city text not null default '',
  state text not null default '',
  active boolean not null default true,
  asaas_customer_id text,
  asaas_environment text check (asaas_environment in ('sandbox', 'production')),
  asaas_state text not null default 'local' check (asaas_state in ('local', 'processing', 'review', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.holding_website_contracts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  customer_id uuid not null references public.holding_customers(id),
  plan_id uuid not null references public.holding_website_plans(id),
  customer_snapshot jsonb not null,
  plan_snapshot jsonb not null,
  total_cents integer not null check (total_cents between 1 and 999999999),
  payment_method text not null check (payment_method in ('PIX', 'BOLETO', 'CREDIT_CARD')),
  billing_state text not null default 'local' check (billing_state in ('local', 'processing', 'review', 'issued')),
  asaas_environment text check (asaas_environment in ('sandbox', 'production')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.holding_website_installments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.holding_website_contracts(id),
  number integer not null check (number between 1 and 13),
  kind text not null check (kind in ('deposit', 'balance')),
  amount_cents integer not null check (amount_cents between 1 and 999999999),
  due_date date not null,
  asaas_payment_id text unique,
  invoice_url text,
  status text not null default 'LOCAL',
  updated_at timestamptz not null default now(),
  unique(contract_id, number)
);

create index on public.holding_website_contracts(customer_id);

create trigger trg_holding_customers_updated_at before update on public.holding_customers
for each row execute procedure public.set_holding_updated_at();
create trigger trg_holding_website_contracts_updated_at before update on public.holding_website_contracts
for each row execute procedure public.set_holding_updated_at();
create trigger trg_holding_website_installments_updated_at before update on public.holding_website_installments
for each row execute procedure public.set_holding_updated_at();

alter table public.holding_customers enable row level security;
alter table public.holding_website_contracts enable row level security;
alter table public.holding_website_installments enable row level security;
revoke all on public.holding_customers, public.holding_website_contracts, public.holding_website_installments
  from public, anon, authenticated;
grant select, insert, update on public.holding_customers, public.holding_website_contracts,
  public.holding_website_installments to service_role;

create function public.holding_create_website_contract(
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
      'fiscal_config', v_plan.fiscal_config, 'invoice_policy', 'manual_project_total'
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

insert into public.holding_permission_resources(code, label, category, parent_code, sort_order, active) values
  ('menu.clientes', 'Clientes da Holding', 'menu', null, 55, true),
  ('submenu.assinaturas.websites', 'Assinaturas > Websites / projetos', 'submenu', 'menu.assinaturas', 51, true)
on conflict (code) do update set label = excluded.label, parent_code = excluded.parent_code,
  active = true, updated_at = now();
insert into public.holding_profile_resource_permissions(profile_id, resource_code, enabled)
select p.id, r.code, true from public.holding_permission_profiles p
cross join public.holding_permission_resources r
where p.name = 'Administrador' and r.code in ('menu.clientes', 'submenu.assinaturas.websites')
on conflict (profile_id, resource_code) do update set enabled = true, updated_at = now();

commit;
