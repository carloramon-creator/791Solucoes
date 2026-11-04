begin;
-- Exclusao somente pela API administrativa. As FKs existentes de projetos e
-- assinaturas (NO ACTION) bloqueiam clientes com qualquer contratacao.
grant delete on public.holding_customers to service_role;
commit;
