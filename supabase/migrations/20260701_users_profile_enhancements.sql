-- ================================================================
-- Migration: Enriquecimento de usuarios da equipe
-- Escopo: dados completos, trabalho, salario e documentos
-- ================================================================

create extension if not exists pgcrypto;

alter table if exists public.equipe_791
  add column if not exists cpf text,
  add column if not exists whatsapp text,
  add column if not exists cep text,
  add column if not exists endereco_rua text,
  add column if not exists endereco_numero text,
  add column if not exists endereco_complemento text,
  add column if not exists endereco_bairro text,
  add column if not exists endereco_cidade text,
  add column if not exists endereco_uf text,
  add column if not exists salario_mensal numeric(12,2),
  add column if not exists periodo_trabalho_inicio date,
  add column if not exists periodo_trabalho_fim date,
  add column if not exists jornada_inicio time,
  add column if not exists jornada_fim time,
  add column if not exists foto_path text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.equipe_791_documentos (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  file_name text not null,
  file_path text not null unique,
  content_type text,
  size_bytes bigint,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_equipe_791_documentos_user_email
  on public.equipe_791_documentos(user_email);

alter table public.equipe_791_documentos enable row level security;

drop policy if exists "equipe_791_documentos_full" on public.equipe_791_documentos;
create policy "equipe_791_documentos_full" on public.equipe_791_documentos
  using (true)
  with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipe-documentos',
  'equipe-documentos',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipe-avatars',
  'equipe-avatars',
  false,
  5242880,
  array[
    'image/png',
    'image/jpeg',
    'image/webp'
  ]::text[]
)
on conflict (id) do nothing;

update public.holding_permission_resources
set label = 'Configuracoes > Usuarios',
    updated_at = now()
where code = 'submenu.configuracoes.permissoes';
