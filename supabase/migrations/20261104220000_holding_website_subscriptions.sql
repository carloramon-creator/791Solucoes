begin;

alter table public.holding_website_plans add column recurring_prices jsonb not null default '{}'::jsonb;
update public.holding_website_plans set recurring_prices=jsonb_build_object(billing_cycle,price_cents)
  where billing_cycle <> 'one_time';
alter table public.holding_website_plans drop constraint holding_website_plans_billing_cycle_check;
alter table public.holding_website_plans add constraint holding_website_plans_billing_cycle_check
  check (billing_cycle in ('one_time','monthly','quarterly','semiannual','annual'));
alter table public.holding_website_plans drop constraint holding_website_plans_category_billing_check;
alter table public.holding_website_plans add constraint holding_website_plans_category_billing_check check (
  (category in ('creation','additional') and billing_cycle='one_time')
  or (category in ('hosting','maintenance') and billing_cycle in ('monthly','quarterly','semiannual','annual'))
);
create function public.holding_website_prices_valid(p_prices jsonb,p_cycle text,p_price integer)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p_prices) is distinct from 'object' then return false; end if;
  if p_cycle='one_time' then return p_prices='{}'::jsonb; end if;
  for k,v in select * from jsonb_each(p_prices) loop
    if k not in ('monthly','quarterly','semiannual','annual') or jsonb_typeof(v) <> 'number'
      or v::text !~ '^[0-9]+$' then return false; end if;
    if v::text::numeric not between 1 and 999999999 then return false; end if;
  end loop;
  return coalesce(p_prices->p_cycle=to_jsonb(p_price),false);
end;
$$;
alter table public.holding_website_plans add constraint holding_website_prices_check
  check (public.holding_website_prices_valid(recurring_prices,billing_cycle,price_cents));

create table public.holding_website_subscriptions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  customer_id uuid not null references public.holding_customers(id),
  plan_id uuid not null references public.holding_website_plans(id),
  customer_snapshot jsonb not null,
  plan_snapshot jsonb not null,
  amount_cents integer not null check (amount_cents between 1 and 999999999),
  payment_method text not null check (payment_method in ('PIX','BOLETO','CREDIT_CARD')),
  first_due_date date not null,
  fiscal_confirmed boolean not null check (fiscal_confirmed),
  billing_state text not null default 'local' check (billing_state in ('local','processing','review','issued')),
  asaas_environment text check (asaas_environment in ('sandbox','production')),
  asaas_subscription_id text unique,
  asaas_customer_id text,
  remote_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.holding_website_subscriptions(customer_id);

create table public.holding_website_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.holding_website_subscriptions(id),
  asaas_payment_id text not null unique check (asaas_payment_id ~ '^pay_[A-Za-z0-9]+$'),
  amount_cents integer not null check (amount_cents between 1 and 999999999),
  due_date date not null,
  paid_on date,
  status text not null,
  invoice_url text not null,
  fiscal_error text,
  updated_at timestamptz not null default now(),
  unique(subscription_id,due_date)
);

alter table public.holding_website_invoices alter column contract_id drop not null;
alter table public.holding_website_invoices add column subscription_payment_id uuid unique
  references public.holding_website_subscription_payments(id);
alter table public.holding_website_invoices add constraint holding_website_invoice_origin_check
  check ((contract_id is not null)::integer + (subscription_payment_id is not null)::integer = 1);

create trigger trg_holding_website_subscriptions_updated_at before update on public.holding_website_subscriptions
for each row execute procedure public.set_holding_updated_at();
create trigger trg_holding_website_subscription_payments_updated_at before update on public.holding_website_subscription_payments
for each row execute procedure public.set_holding_updated_at();
alter table public.holding_website_subscriptions enable row level security;
alter table public.holding_website_subscription_payments enable row level security;
revoke all on public.holding_website_subscriptions,public.holding_website_subscription_payments from public,anon,authenticated;
grant select,insert,update on public.holding_website_subscriptions,public.holding_website_subscription_payments to service_role;

create function public.holding_create_website_subscription(
  p_request_id uuid,p_customer_id uuid,p_plan_id uuid,p_amount_cents integer,p_payment_method text,p_first_due_date date,p_cycle text
) returns uuid language plpgsql set search_path=public,pg_temp as $$
declare
  v_customer public.holding_customers;
  v_plan public.holding_website_plans;
  v_existing public.holding_website_subscriptions;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_existing from public.holding_website_subscriptions where request_id=p_request_id;
  if found then
    if v_existing.customer_id is distinct from p_customer_id or v_existing.plan_id is distinct from p_plan_id
      or v_existing.amount_cents is distinct from p_amount_cents or v_existing.payment_method is distinct from p_payment_method
      or v_existing.first_due_date is distinct from p_first_due_date
      or v_existing.plan_snapshot->>'billing_cycle' is distinct from p_cycle then
      raise exception using errcode='22023',message='Tentativa reutilizada com dados diferentes';
    end if;
    return v_existing.id;
  end if;
  select * into strict v_customer from public.holding_customers where id=p_customer_id and active for share;
  select * into strict v_plan from public.holding_website_plans
    where id=p_plan_id and active and billing_cycle <> 'one_time' for share;
  if p_cycle is null or p_cycle not in ('monthly','quarterly','semiannual','annual')
    or not (v_plan.recurring_prices ? p_cycle) then raise exception 'Ciclo nao oferecido neste produto'; end if;
  if v_plan.fiscal_config->'accountant_confirmed' is distinct from 'true'::jsonb then
    raise exception 'Confirme os dados fiscais do produto antes de contratar uma assinatura';
  end if;
  insert into public.holding_website_subscriptions(
    request_id,customer_id,plan_id,amount_cents,payment_method,first_due_date,fiscal_confirmed,customer_snapshot,plan_snapshot
  ) values(
    p_request_id,p_customer_id,p_plan_id,p_amount_cents,p_payment_method,p_first_due_date,true,
    jsonb_build_object('name',v_customer.name,'document',v_customer.document,'email',v_customer.email,
      'postal_code',v_customer.postal_code,'address',v_customer.address,'address_number',v_customer.address_number,
      'complement',v_customer.complement,'district',v_customer.district,'city',v_customer.city,'state',v_customer.state),
    jsonb_build_object('name',v_plan.name,'scope',v_plan.scope,'description',v_plan.description,
      'billing_cycle',p_cycle,'catalog_price_cents',v_plan.recurring_prices->p_cycle,'fiscal_config',v_plan.fiscal_config,
      'invoice_policy','automatic_after_payment','competence_policy','payment_confirmation')
  ) returning id into v_id;
  return v_id;
end;
$$;

create function public.holding_record_website_subscription_payment(
  p_subscription_id uuid,p_payment_id text,p_amount_cents integer,p_due_date date,p_paid_on date,p_status text,p_invoice_url text
) returns uuid language plpgsql set search_path=public,pg_temp as $$
declare v_subscription public.holding_website_subscriptions; v_existing public.holding_website_subscription_payments; v_id uuid;
begin
  select * into strict v_subscription from public.holding_website_subscriptions where id=p_subscription_id for update;
  if p_amount_cents is distinct from v_subscription.amount_cents or v_subscription.asaas_subscription_id is null then
    raise exception 'Pagamento diverge da assinatura vinculada';
  end if;
  select * into v_existing from public.holding_website_subscription_payments where asaas_payment_id=p_payment_id;
  if found then
    if v_existing.subscription_id is distinct from p_subscription_id or v_existing.amount_cents is distinct from p_amount_cents
      or v_existing.due_date is distinct from p_due_date then raise exception 'Pagamento divergente do historico'; end if;
    update public.holding_website_subscription_payments set status=p_status,invoice_url=p_invoice_url,
      paid_on=coalesce(paid_on,p_paid_on) where id=v_existing.id;
    return v_existing.id;
  end if;
  insert into public.holding_website_subscription_payments(subscription_id,asaas_payment_id,amount_cents,due_date,paid_on,status,invoice_url)
    values(p_subscription_id,p_payment_id,p_amount_cents,p_due_date,p_paid_on,p_status,p_invoice_url) returning id into v_id;
  return v_id;
end;
$$;

create function public.holding_reserve_website_subscription_invoice(p_payment_id uuid,p_series text,p_issuer_document text)
returns public.holding_website_invoices language plpgsql set search_path=public,pg_temp as $$
declare
  v_payment public.holding_website_subscription_payments;
  v_subscription public.holding_website_subscriptions;
  v_invoice public.holding_website_invoices;
  v_seq_id text := 'nfse_sequencia_producao_' || p_series;
  v_operation text := 'nfse_producao_website_subscription_' || p_payment_id::text;
  v_value jsonb; v_number bigint;
begin
  select * into strict v_payment from public.holding_website_subscription_payments where id=p_payment_id for update;
  select * into strict v_subscription from public.holding_website_subscriptions where id=v_payment.subscription_id;
  if exists(select 1 from public.holding_website_invoices where subscription_payment_id=p_payment_id) then
    raise exception using errcode='23505',message='Operacao fiscal ja reservada; nao reenvie';
  end if;
  if v_payment.status not in ('RECEIVED','CONFIRMED') or v_payment.paid_on is null
    or v_subscription.asaas_environment is distinct from 'production'
    or v_payment.amount_cents <> v_subscription.amount_cents
    or v_subscription.plan_snapshot->>'invoice_policy' is distinct from 'automatic_after_payment' then
    raise exception 'Somente pagamento confirmado de assinatura Websites em producao pode emitir';
  end if;
  if p_series is null or p_issuer_document is null or p_series !~ '^[0-9]{1,5}$'
    or p_series::integer not between 1 and 49999 or p_issuer_document !~ '^[0-9]{14}$'
    or extract(year from v_payment.paid_on) <> 2026 then raise exception 'Parametros nacionais invalidos'; end if;
  insert into public.system_settings(id,value,updated_at) values(v_seq_id,jsonb_build_object('numero',0),now()) on conflict(id) do nothing;
  select value into strict v_value from public.system_settings where id=v_seq_id for update;
  if jsonb_typeof(v_value->'numero') is distinct from 'number' or v_value->>'numero' !~ '^[0-9]+$' then raise exception 'Sequencia fiscal invalida'; end if;
  v_number := (v_value->>'numero')::bigint + 1;
  if v_number < 1 or v_number > 999999999999999 then raise exception 'Sequencia fiscal esgotada'; end if;
  update public.system_settings set value=jsonb_build_object('numero',v_number),updated_at=now() where id=v_seq_id;
  insert into public.holding_website_invoices(subscription_payment_id,status,competence,operation,dps_number,series,issuer_document)
    values(p_payment_id,'preparing',v_payment.paid_on,v_operation,v_number::text,p_series,p_issuer_document) returning * into v_invoice;
  insert into public.system_settings(id,value,updated_at) values(v_operation,
    jsonb_build_object('status','preparando','competencia',v_payment.paid_on::text,'valor',v_payment.amount_cents::numeric/100,
      'website_subscription_payment_id',p_payment_id),now());
  return v_invoice;
end;
$$;

revoke all on function public.holding_create_website_subscription(uuid,uuid,uuid,integer,text,date,text) from public,anon,authenticated;
revoke all on function public.holding_record_website_subscription_payment(uuid,text,integer,date,date,text,text) from public,anon,authenticated;
revoke all on function public.holding_reserve_website_subscription_invoice(uuid,text,text) from public,anon,authenticated;
grant execute on function public.holding_create_website_subscription(uuid,uuid,uuid,integer,text,date,text) to service_role;
grant execute on function public.holding_record_website_subscription_payment(uuid,text,integer,date,date,text,text) to service_role;
grant execute on function public.holding_reserve_website_subscription_invoice(uuid,text,text) to service_role;

commit;
