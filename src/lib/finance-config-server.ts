import { supabaseServer } from '@/lib/supabase-server';

/** Lê a configuração financeira (chaves Asaas/Inter). Uso exclusivo no servidor. */
export async function readFinanceConfig(): Promise<Record<string, any>> {
  const { data, error } = await supabaseServer
    .from('system_settings')
    .select('value')
    .eq('id', 'finance_api')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data?.value || {}) as Record<string, any>;
}

/** Valor enviado pelo formulário ou, se vazio, o que já está salvo. */
export function pickSecret(sent: unknown, saved: unknown): string {
  if (typeof sent === 'string' && sent.trim() !== '') return sent;
  return typeof saved === 'string' ? saved : '';
}
