-- Reserva de emissão fiscal por pagamento Asaas (payment-processor).
-- A tabela era referenciada pelo código mas nunca existiu em produção, derrubando a
-- emissão automática de NFS-e de assinaturas e excedentes.
create table if not exists nfse_payment_emissions (
    asaas_payment_id text primary key,
    tenant_id text not null,
    value numeric not null,
    cycle text not null,
    state text not null default 'processing',
    provider_status text,
    provider_message text,
    invoice_number text,
    access_link text,
    provider_response jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table nfse_payment_emissions enable row level security;
revoke all on nfse_payment_emissions from anon, authenticated;
