-- ================================================================
-- Migration: Humanizar atos antigos de historico de tickets
-- Escopo: converter mensagens tecnicas ja gravadas para formato legivel
-- ================================================================

create or replace function public.humanize_support_ato_message(raw_message text)
returns text
language plpgsql
as $$
declare
  work text;
begin
  if raw_message is null then
    return raw_message;
  end if;

  if raw_message !~ '^Ato:\s*' then
    return raw_message;
  end if;

  work := regexp_replace(raw_message, '^Ato:\s*', '', 'i');

  -- Converte padrões antigos para frases humanas.
  work := regexp_replace(work, 'status:\s*([^|]+?)\s*->\s*([^|]+)', 'Status alterado: \1 para \2.', 'ig');
  work := regexp_replace(work, 'prioridade:\s*([^|]+?)\s*->\s*([^|]+)', 'Prioridade alterada: \1 para \2.', 'ig');
  work := regexp_replace(work, 'responsavel:\s*([^|]+?)\s*->\s*([^|]+)', 'Responsavel alterado: \1 para \2.', 'ig');
  work := regexp_replace(work, 'atribuido\s+para\s*([^|]+)', 'Ticket assumido: \1.', 'ig');
  work := regexp_replace(work, '\bprazo atualizado\b', 'Prazo atualizado.', 'ig');

  -- Normaliza separadores antigos.
  work := regexp_replace(work, '\s*\|\s*', ' ', 'g');
  work := regexp_replace(work, '\s{2,}', ' ', 'g');
  work := trim(work);

  -- Garante prefixo padrao para o frontend identificar como ato.
  return 'Ato: ' || work;
end;
$$;

update public.support_ticket_messages
set message = public.humanize_support_ato_message(message)
where origin = 'system'
  and message ~ '^Ato:\s*'
  and (
    message ~* 'status:\s*.*->'
    or message ~* 'prioridade:\s*.*->'
    or message ~* 'responsavel:\s*.*->'
    or message ~* 'atribuido\s+para'
    or message ~* 'prazo atualizado'
  );
