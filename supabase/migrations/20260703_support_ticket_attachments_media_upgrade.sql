-- ================================================================
-- Migration: Upgrade do bucket de anexos de tickets
-- Escopo: imagem + PDF + video curto (ate 25MB)
-- ================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-ticket-attachments',
  'support-ticket-attachments',
  false,
  26214400,
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
    'image/tiff',
    'application/pdf',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    'video/x-msvideo'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
