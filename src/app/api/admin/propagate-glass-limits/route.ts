import { NextRequest, NextResponse } from 'next/server';
import { getGlassClient } from '@/lib/glass-client';

type PropagationMode = 'none' | 'default' | 'all';

type Body = {
  mode: PropagationMode;
  nextLimits: {
    usersIncluded: number;
    wppDevices: number;
    wppMessages: number;
  };
  loadedLimits?: {
    usersIncluded: number;
    wppDevices: number;
    wppMessages: number;
  } | null;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const mode = body?.mode;

    if (!mode || !['none', 'default', 'all'].includes(mode)) {
      return NextResponse.json({ error: 'Modo de propagacao invalido.' }, { status: 400 });
    }

    if (mode === 'none') {
      return NextResponse.json({ updated: 0, scanned: 0 });
    }

    const nextUsersIncluded = Number(body?.nextLimits?.usersIncluded ?? 0);
    const nextWppDevices = Number(body?.nextLimits?.wppDevices ?? 0);
    const nextWppMessages = Number(body?.nextLimits?.wppMessages ?? 0);

    if (mode === 'default' && !body?.loadedLimits) {
      return NextResponse.json(
        { error: 'Nao foi possivel identificar os limites anteriores para aplicacao seletiva.' },
        { status: 400 }
      );
    }

    const glass = await getGlassClient();

    const { data: tenants, error: tenantsError } = await glass
      .from('vidracarias')
      .select('id, limite_usuarios, limite_usuarios_whats, limite_mensagens_whatsapp');

    if (tenantsError) {
      return NextResponse.json({ error: tenantsError.message }, { status: 500 });
    }

    let updated = 0;
    const loaded = body.loadedLimits;

    for (const tenant of tenants || []) {
      const tenantUsers = tenant.limite_usuarios == null ? null : Number(tenant.limite_usuarios);
      const tenantWppDevices = tenant.limite_usuarios_whats == null ? null : Number(tenant.limite_usuarios_whats);
      const tenantWppMessages = tenant.limite_mensagens_whatsapp == null ? null : Number(tenant.limite_mensagens_whatsapp);

      const updatePayload: Record<string, number> = {};

      if (mode === 'all' || tenantUsers == null || tenantUsers === loaded!.usersIncluded) {
        updatePayload.limite_usuarios = nextUsersIncluded;
      }

      if (mode === 'all' || tenantWppDevices == null || tenantWppDevices === loaded!.wppDevices) {
        updatePayload.limite_usuarios_whats = nextWppDevices;
      }

      if (mode === 'all' || tenantWppMessages == null || tenantWppMessages === loaded!.wppMessages) {
        updatePayload.limite_mensagens_whatsapp = nextWppMessages;
      }

      if (Object.keys(updatePayload).length === 0) continue;

      const { data: updatedRows, error: syncError } = await glass
        .from('vidracarias')
        .update(updatePayload)
        .eq('id', tenant.id)
        .select('id');

      if (syncError) {
        return NextResponse.json({ error: syncError.message }, { status: 500 });
      }

      updated += updatedRows?.length || 0;
    }

    return NextResponse.json({
      updated,
      scanned: tenants?.length || 0,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Falha ao propagar limites para vidracarias.' },
      { status: 500 }
    );
  }
}
