import { getUserPermissionCodes, getUserProfileIds } from '@/lib/holding-permissions';

export async function hasExplicitHoldingPermission(
  userEmail: string | null | undefined,
  resourceCodes: string[],
  match: 'all' | 'any' = 'all'
): Promise<boolean> {
  if (!userEmail || resourceCodes.length === 0) return false;

  const profileIds = await getUserProfileIds(userEmail);
  if (profileIds.length === 0) return false;

  const permissions = await getUserPermissionCodes(userEmail);
  return match === 'any'
    ? resourceCodes.some((code) => permissions.has(code))
    : resourceCodes.every((code) => permissions.has(code));
}
