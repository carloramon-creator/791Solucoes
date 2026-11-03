import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

// Segredos nunca saem do servidor; o formulário só sabe se estão cadastrados.
const SEGREDOS = ['pfxBase64', 'passphrase', 'ipm_password'] as const;
const INDICADORES = ['passphrase_set', 'ipm_password_set'] as const;

async function lerConfig() {
  const { data, error } = await supabaseServer
    .from('system_settings')
    .select('value')
    .eq('id', 'nfse_config')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data?.value || {}) as Record<string, unknown>;
}

function semSegredos(config: Record<string, unknown>) {
  const publico: Record<string, unknown> = { ...config };
  for (const k of SEGREDOS) delete publico[k];
  publico.certificate_uploaded = !!config.pfxBase64;
  publico.passphrase_set = !!config.passphrase;
  publico.ipm_password_set = !!config.ipm_password;
  return publico;
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(semSegredos(await lerConfig()), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const atual = await lerConfig();
    const novo: Record<string, unknown> = { ...atual, ...body };
    // A produção nacional tem validação e edição próprias; o formulário IPM não pode sobrescrevê-la.
    novo.nacional = atual.nacional;
    for (const k of INDICADORES) delete novo[k];
    // Campo de segredo vazio significa "manter o que já está salvo".
    for (const k of SEGREDOS) {
      const v = body[k];
      if (typeof v !== 'string' || v.trim() === '') novo[k] = atual[k];
    }
    novo.certificate_uploaded = !!novo.pfxBase64;

    const registro = { id: 'nfse_config', value: novo, updated_at: new Date().toISOString() };
    const { error } = Object.keys(atual).length
      ? await supabaseServer.from('system_settings').update(registro)
        .eq('id', 'nfse_config').eq('value', JSON.stringify(atual)).select('id').single()
      : await supabaseServer.from('system_settings').insert(registro);
    if (error) throw new Error(`Configuração não salva; recarregue antes de tentar novamente: ${error.message}`);

    return NextResponse.json({ success: true, config: semSegredos(novo) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
