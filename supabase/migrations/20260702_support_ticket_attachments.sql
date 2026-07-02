-- ================================================================
-- Migration: Anexos de tickets de suporte
-- Escopo: imagens anexadas em mensagens de tickets
-- ================================================================

create extension if not exists pgcrypto;

alter table if exists public.support_ticket_messages
  add column if not exists attachment_file_name text,
  add column if not exists attachment_path text,
  add column if not exists attachment_content_type text,
  add column if not exists attachment_size_bytes bigint;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-ticket-attachments',
  'support-ticket-attachments',
  false,
  10485760,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/avif',
    'image/svg+xml',
    'image/heic',
    'image/heif',
    'image/tiff'
  ]::text[]
)
on conflict (id) do nothing;