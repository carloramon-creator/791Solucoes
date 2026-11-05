import { supabaseServer } from '@/lib/supabase-server';

export async function canAdjustGlassDueDate(email: string | null | undefined) {
  if (!email) return false;
  const result = await supabaseServer.rpc('holding_can_adjust_glass_due_date', { p_email: email.trim().toLowerCase() });
  if (result.error || typeof result.data !== 'boolean') throw new Error('Não foi possível verificar a permissão de ajuste de vencimento.');
  return result.data;
}
