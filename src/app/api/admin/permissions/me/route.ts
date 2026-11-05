import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getUserPermissionCodes, getUserProfileIds } from '@/lib/holding-permissions';
import { getHoldingWebsitesPermissions, WEBSITE_PERMISSION_CODES } from '@/lib/holding-websites-permissions';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar permissoes administrativas.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const [profileIds, permissionCodes, websites] = await Promise.all([
      getUserProfileIds(auth.user.email),
      getUserPermissionCodes(auth.user.email),
      getHoldingWebsitesPermissions(auth.user.email),
    ]);
    for (const permission of ['menu', 'view', 'create', 'edit'] as const) {
      const code = WEBSITE_PERMISSION_CODES[permission];
      permissionCodes.delete(code);
      if (websites[permission]) permissionCodes.add(code);
    }

    return NextResponse.json({
      userEmail: auth.user.email,
      profileIds,
      permissionCodes: Array.from(permissionCodes.values()).sort(),
      unrestrictedFallback: profileIds.length === 0 && permissionCodes.size === 0,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[PERMISSIONS] Falha ao consultar permissoes.', error);
    return NextResponse.json({ error: 'Nao foi possivel verificar suas permissoes.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
