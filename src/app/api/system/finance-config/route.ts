import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

// Segredos nunca saem do servidor; o formulário só sabe se estão cadastrados (<campo>_set).
const SEGREDOS = [
  'asaasApiKey',
  'asaasWebhookSecret',
  'interClientSecret',
  'interCertKey',
  'glassServiceKey',
  'barberServiceKey',
] as const;

async function lerConfig() {
  const { data, error } = await supabaseServer
    .from('system_settings')
    .select('value')
    .eq('id', 'finance_api')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data?.value || {}) as Record<string, unknown>;
}

function semSegredos(config: Record<string, unknown>) {
  const publico: Record<string, unknown> = { ...config };
  for (const k of SEGREDOS) {
    delete publico[k];
    publico[`${k}_set`] = typeof config[k] === 'string' && (config[k] as string).trim() !== '';
  }
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
    for (const k of SEGREDOS) {
      delete novo[`${k}_set`];
      // Campo de segredo vazio significa "manter o que já está salvo".
      const v = body[k];
      if (typeof v !== 'string' || v.trim() === '') novo[k] = atual[k];
    }

    const { error } = await supabaseServer
      .from('system_settings')
      .upsert({ id: 'finance_api', value: novo, updated_at: new Date().toISOString() });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
