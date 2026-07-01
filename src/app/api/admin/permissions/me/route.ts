import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getUserPermissionCodes, getUserProfileIds } from '@/lib/holding-permissions';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar permissoes administrativas.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [profileIds, permissionCodes] = await Promise.all([
    getUserProfileIds(auth.user.email),
    getUserPermissionCodes(auth.user.email),
  ]);

  return NextResponse.json({
    userEmail: auth.user.email,
    profileIds,
    permissionCodes: Array.from(permissionCodes.values()).sort(),
    unrestrictedFallback: permissionCodes.size === 0,
  });
}
