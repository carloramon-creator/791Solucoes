import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { getGlassClient } from '@/lib/glass-client';
import { parametrosConsumoIA, type RelatorioConsumoIA } from '@/lib/ai-usage-report';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let params: ReturnType<typeof parametrosConsumoIA>;
  try {
    params = parametrosConsumoIA(new URL(req.url).searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Filtros inválidos.' }, { status: 400 });
  }
  try {
    const { data, error } = await supabaseServer.rpc('ai_usage_report', params);
    if (error) throw error;
    if (!data) throw new Error('O banco não retornou o relatório de consumo.');
    const report: RelatorioConsumoIA = { ...data, pagina: params.p_pagina };
    if (report.tenants.length) {
      const glass = await getGlassClient();
      const nomes = new Map<string, string>();
      for (let offset = 0; offset < report.tenants.length; offset += 200) {
        const ids = report.tenants.slice(offset, offset + 200).map(t => t.tenant_id);
        const { data: tenants, error: tenantError } = await glass.from('vidracarias').select('id, nome').in('id', ids);
        if (tenantError) throw tenantError;
        for (const tenant of tenants || []) nomes.set(tenant.id, tenant.nome);
      }
      report.tenants = report.tenants.map(t => ({ ...t, nome: nomes.get(t.tenant_id) || `Tenant não encontrado (${t.tenant_id})` }));
    }
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Erro no relatório de consumo IA:', error);
    return NextResponse.json({ error: 'Não foi possível carregar o consumo de IA. Confira a configuração e a migração ai_usage_events na Holding.' }, { status: 500 });
  }
}
