import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer as db } from '@/lib/supabase-server';

export async function operationsAccess(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return auth;
  const email = auth.user.email?.trim().toLowerCase();
  if (!email) return { ok: false as const, status: 403, error: 'Usuário sem e-mail.' };
  const permissions = await db.rpc('holding_operations_permissions', { p_email: email });
  if (permissions.error) throw permissions.error;
  const codes: string[] = permissions.data;
  return { ok: true as const, email, codes };
}
