import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from './supabase-server';

/**
 * Cria um cliente dinâmico para o projeto 791glass 
 * baseado nas configurações salvas na Holding.
 */
export async function getGlassClient() {
  const { data, error } = await supabaseServer
    .from('system_settings')
    .select('value')
    .eq('id', 'finance_api')
    .single();

  if (error || !data?.value?.glassUrl) {
    throw new Error('Configurações de API do Glass não encontradas na Holding.');
  }

  const { glassUrl, glassServiceKey } = data.value;

  return createClient(glassUrl, glassServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
