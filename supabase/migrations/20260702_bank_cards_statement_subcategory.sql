alter table public.system_bank_cards
  add column if not exists statement_subcategory_id uuid null;

comment on column public.system_bank_cards.statement_subcategory_id is 'Subcategoria padrão usada ao gerar fatura do cartão.';
