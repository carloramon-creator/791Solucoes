import type { getGlassClient } from './glass-client';

type GlassAdminClient = Awaited<ReturnType<typeof getGlassClient>>;

const tablesToNullify = [
  { table: 'pessoas', column: 'user_id' },
  { table: 'whatsapp_conversations', column: 'responsible_user_id' },
  { table: 'whatsapp_conversations', column: 'transferred_from_id' },
] as const;

function isMissingSchemaObjectError(error: unknown): boolean {
  const candidate = error as { message?: string; details?: string };
  const message = String(candidate?.message || candidate?.details || '').toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('could not find the table')
    || message.includes('schema cache')
    || message.includes('could not find the')
  );
}

function isIgnorableAuthDeleteError(error: unknown): boolean {
  const candidate = error as { message?: string; status?: number };
  const message = String(candidate?.message || '').toLowerCase();
  return candidate?.status === 404 || message.includes('not found') || message.includes('user not found');
}

export async function deleteGlassAuthUser(glass: GlassAdminClient, userId: string): Promise<boolean> {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) throw new Error('Informe um userId válido para remover do Auth.');

  for (const target of tablesToNullify) {
    const { error } = await glass
      .from(target.table)
      .update({ [target.column]: null })
      .eq(target.column, normalizedUserId);

    if (!error) continue;
    if (isMissingSchemaObjectError(error)) continue;
    throw new Error(`[${target.table}.${target.column}] ${error.message || 'erro ao liberar referência do usuário'}`);
  }

  const { error } = await glass.auth.admin.deleteUser(normalizedUserId);
  if (!error) return true;
  if (isIgnorableAuthDeleteError(error)) return false;
  throw new Error(error.message || 'Falha ao excluir usuário no Auth.');
}
