begin;

alter table public.holding_customers
  add column trade_name text not null default ''
    check (char_length(btrim(trade_name)) <= 160);

commit;
