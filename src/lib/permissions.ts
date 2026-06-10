// ──── Permission helpers ────
// Legacy functions — safe for both client and server.
// Server-only DB functions are in permissions-server.ts
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
  return permissions.some(p => getPermissions(userLevel).includes(p));
}

// Re-export shared types (safe for client)
export type { UserAccess, PageAccess } from './permissions-types';
