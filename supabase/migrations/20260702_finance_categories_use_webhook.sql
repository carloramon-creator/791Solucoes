alter table public.system_finance_categories
  add column if not exists use_webhook boolean not null default false;

comment on column public.system_finance_categories.use_webhook is 'Marca categorias/subcategorias usadas automaticamente por webhooks.';
