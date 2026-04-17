// ──── Permission definitions ────
// Maps TblUser.UserLevel → array of capability strings.
// This is a client-side permission model that requires NO database changes.

export const PERMISSION_MAP: Record<string, string[]> = {
  admin: [
    'pos.sell',
    'day.view', 'day.open', 'day.close',
    'shift.view', 'shift.open', 'shift.close',
    'users.view', 'users.edit', 'users.create', 'users.delete',
    'reports.view',
    'settings.view', 'settings.edit',
  ],
  user: [
    'pos.sell',
    'day.view',
    'shift.view', 'shift.open', 'shift.close',
  ],
};

export function getPermissions(userLevel: string): string[] {
  return PERMISSION_MAP[userLevel] || [];
}

export function hasPermission(userLevel: string, permission: string): boolean {
  return getPermissions(userLevel).includes(permission);
}

export function hasAnyPermission(userLevel: string, permissions: string[]): boolean {
  const userPerms = getPermissions(userLevel);
  return permissions.some((p) => userPerms.includes(p));
}
