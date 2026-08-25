'use client';

import { useCallback } from 'react';
import type { UserAccess } from '@/lib/permissions-types';
import { useSession } from '@/hooks/useSession';

export type { UserAccess };

/**
 * Compatibility wrapper. Canonical access lives on SessionProvider bootstrap state.
 */
export function useMyAccess() {
  const session = useSession();

  const canSeePage = useCallback((path: string) => {
    const access = session.access;
    if (!access) return false;
    if (access.isSuperAdmin) return true;
    const clean = path.split('?')[0].replace(/\/$/, '') || '/';
    if (access.isPartnerOnly) {
      return clean === '/admin/reports/partners';
    }
    return access.allowedPagePaths.some((p) => {
      const np = p.replace(/\/$/, '') || '/';
      return clean === np;
    });
  }, [session.access]);

  const hasRole = useCallback(
    (role: string) => session.access?.roles.includes(role) ?? false,
    [session.access],
  );

  return {
    access: session.access,
    loading: session.loading,
    isAuthenticated: session.isAuthenticated,
    canSeePage,
    hasRole,
    reload: session.refresh,
  };
}
