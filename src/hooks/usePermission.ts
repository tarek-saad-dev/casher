'use client';

import { useSession } from './useSession';

export function usePermission(permission: string): boolean {
  const { permissions } = useSession();
  return permissions.includes(permission);
}

export function useAnyPermission(perms: string[]): boolean {
  const { permissions } = useSession();
  return perms.some((p) => permissions.includes(p));
}
