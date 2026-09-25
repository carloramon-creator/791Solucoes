import { NextResponse } from 'next/server';
import { getGlassClient } from '@/lib/glass-client';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { isTenantChatEnabled } from '@/lib/tenant-chat-access';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar vidracarias.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const glass = await getGlassClient();
    const { data, error } = await glass
      .from('vidracarias')
      .select('id, nome, slug, ativa, status_assinatura, vencimento_assinatura')
      .order('nome', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message || 'Falha ao carregar vidracarias.' }, { status: 500 });
    }

    return NextResponse.json({
      total: (data || []).filter(isTenantChatEnabled).length,
      tenants: (data || []).filter(isTenantChatEnabled).map((tenant: any) => ({
        id: String(tenant.id || ''),
        nome: tenant.nome ? String(tenant.nome) : null,
        slug: tenant.slug ? String(tenant.slug) : '',
        ativa: tenant.ativa ?? null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao carregar vidracarias.' }, { status: 500 });
  }
}