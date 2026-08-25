'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { UserAccess } from '@/lib/hooks/useMyAccess';
import { useSession } from '@/hooks/useSession';

interface PermissionsCtx {
  access: UserAccess | null;
  loading: boolean;
  isAuthenticated: boolean;
  canSeePage: (path: string) => boolean;
  hasRole: (role: string) => boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<PermissionsCtx>({
  access: null, loading: true, isAuthenticated: false,
  canSeePage: () => false,
  hasRole: () => false,
  reload: async () => {},
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();

  const value = useMemo<PermissionsCtx>(() => {
    const access = session.access;
    const canSeePage = (path: string) => {
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
    };
    return {
      access,
      loading: session.loading,
      isAuthenticated: session.isAuthenticated,
      canSeePage,
      hasRole: (role: string) => access?.roles.includes(role) ?? false,
      reload: async () => {
        await session.refresh();
      },
    };
  }, [session]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissions() {
  return useContext(Ctx);
}
