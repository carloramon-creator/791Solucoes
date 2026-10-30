export const account = '00000000-0000-4000-8000-000000000001';
export const otherAccount = '00000000-0000-4000-8000-000000000002';
export const paidRecord = '10000000-0000-4000-8000-000000000001';
export const pendingRecord = '10000000-0000-4000-8000-000000000002';
export const cardRecord = '10000000-0000-4000-8000-000000000003';
export const category = '20000000-0000-4000-8000-000000000001';
export const subcategory = '20000000-0000-4000-8000-000000000002';
export const ruleId = '30000000-0000-4000-8000-000000000001';

export const schema = `
  create role anon;
  create role authenticated;
  create role service_role;
  alter default privileges in schema public grant execute on functions to service_role;
  create table public.system_bank_accounts (
    id uuid primary key default gen_random_uuid(), provider text, sync_enabled boolean not null default false
  );
  create table public.system_finance_categories (
    id uuid primary key default gen_random_uuid(), name text, type text, parent_id uuid
  );
  create table public.system_finance_records (
    id uuid primary key default gen_random_uuid(), type text, value numeric, description text,
    payment_method text, bank_id text, bank_account_id uuid references public.system_bank_accounts(id),
    category text, status text, metadata jsonb, created_at timestamptz default now(),
    updated_at timestamptz default now(), is_recurring boolean default false, recurring_period text
  );
  create table public.system_bank_transactions (
    id uuid primary key default gen_random_uuid(),
    bank_account_id uuid not null references public.system_bank_accounts(id),
    provider text not null, external_id text not null, tx_date date not null,
    amount numeric(14,2) not null, tx_type text, description text, counterparty text,
    reference_id text, balance_after numeric(14,2), raw jsonb,
    finance_record_id uuid references public.system_finance_records(id) on delete set null,
    status text not null default 'a_classificar'
      constraint system_bank_transactions_status_check
      check (status in ('a_classificar', 'classificado', 'conciliado', 'pendente_baixa', 'ignorado')),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (bank_account_id, external_id)
  );
  create table public.system_bank_classification_rules (
    id uuid primary key default gen_random_uuid(), pattern text not null, record_type text not null,
    category_id uuid references public.system_finance_categories(id), category_name text not null,
    bank_account_id uuid references public.system_bank_accounts(id), hits integer not null default 0
  );
`;

export function tx(externalId, amount, extra = {}) {
  return {
    external_id: externalId, tx_date: '2026-10-30', amount, tx_type: 'PIX',
    description: `Movimento ${externalId}`, counterparty: null, reference_id: null,
    balance_after: null, raw: { id: externalId }, rule: null, ...extra,
  };
}
