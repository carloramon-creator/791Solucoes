-- Importação automática de extrato bancário (Asaas agora; Inter e Cora quando houver credenciais).
-- Cada transação do banco vira 1 linha em system_bank_transactions (idempotente por conta + id do banco)
-- e, quando não concilia com um lançamento existente, gera um lançamento pago "A classificar".

-- O webhook do Asaas grava updated_at na baixa; sem a coluna a baixa falhava (PGRST204).
alter table public.system_finance_records
  add column if not exists updated_at timestamptz default now();

alter table public.system_bank_accounts
  add column if not exists provider text,
  add column if not exists sync_enabled boolean not null default false,
  add column if not exists sync_start_date date,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_error text,
  add column if not exists sync_lock_until timestamptz,
  add column if not exists provider_balance numeric,
  add column if not exists provider_balance_at timestamptz;

create table if not exists public.system_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.system_bank_accounts(id) on delete cascade,
  provider text not null,
  external_id text not null,
  tx_date date not null,
  amount numeric(14,2) not null,
  tx_type text,
  description text,
  counterparty text,
  reference_id text,
  balance_after numeric(14,2),
  raw jsonb,
  finance_record_id uuid references public.system_finance_records(id) on delete set null,
  status text not null default 'a_classificar'
    check (status in ('a_classificar', 'classificado', 'conciliado', 'pendente_baixa', 'ignorado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_account_id, external_id)
);

create index if not exists system_bank_transactions_status_idx
  on public.system_bank_transactions (status) where status in ('a_classificar', 'pendente_baixa');
create index if not exists system_bank_transactions_account_date_idx
  on public.system_bank_transactions (bank_account_id, tx_date desc);

create table if not exists public.system_bank_classification_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  record_type text not null check (record_type in ('revenue', 'expense')),
  category_id uuid references public.system_finance_categories(id) on delete cascade,
  category_name text not null,
  bank_account_id uuid references public.system_bank_accounts(id) on delete cascade,
  hits integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  unique (pattern, record_type, bank_account_id)
);

-- Acesso só pelo servidor (service role); nada exposto ao navegador.
alter table public.system_bank_transactions enable row level security;
alter table public.system_bank_classification_rules enable row level security;

-- Para lançamentos importados aparecerem rápido na fila "A classificar".
create index if not exists system_finance_records_needs_classification_idx
  on public.system_finance_records ((metadata->>'needs_classification'))
  where metadata->>'needs_classification' = 'true';

-- Categoria usada para movimentação entre contas próprias (não é receita nem despesa real).
insert into public.system_finance_categories (name, type)
select 'Transferência entre contas', t
from (values ('revenue'), ('expense')) v(t)
where not exists (
  select 1 from public.system_finance_categories c
  where c.name = 'Transferência entre contas' and c.type = v.t
);

update public.system_bank_accounts
   set provider = 'asaas', sync_enabled = true, sync_start_date = coalesce(sync_start_date, date '2026-10-01')
 where id = '0adde9f6-bfa0-4e50-9796-d3fb614c41f4';
update public.system_bank_accounts
   set provider = 'inter', sync_start_date = coalesce(sync_start_date, date '2026-10-01')
 where id = 'd5e469a8-d1db-4442-aec2-7d56f4bd74fd';
update public.system_bank_accounts
   set provider = 'cora', sync_start_date = coalesce(sync_start_date, date '2026-10-01')
 where id = 'ed577483-b5fc-411a-8b4d-acb5e43eb3cd';

-- Segredo do cron guardado no Vault (system_settings é legível por qualquer usuário autenticado).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'bank_sync_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'bank_sync_cron_secret');
  end if;
end $$;

create or replace function public.bank_sync_secret_ok(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret = p_secret from vault.decrypted_secrets where name = 'bank_sync_cron_secret' limit 1),
    false
  );
$$;
revoke all on function public.bank_sync_secret_ok(text) from public, anon, authenticated;
grant execute on function public.bank_sync_secret_ok(text) to service_role;

-- Sincroniza de hora em hora (minuto 7). Custo: 1 chamada HTTP por hora.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'bank-sync-hourly';
select cron.schedule(
  'bank-sync-hourly',
  '7 * * * *',
  $cron$
    select net.http_post(
      url := 'https://admin.791solucoes.com.br/api/system/cron/bank-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-bank-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bank_sync_cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

notify pgrst, 'reload schema';
