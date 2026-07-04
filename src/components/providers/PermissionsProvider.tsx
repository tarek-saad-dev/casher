'use client';

import React, { createContext, useContext, useEffect } from 'react';
import { useMyAccess, type UserAccess } from '@/lib/hooks/useMyAccess';
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
  const { user, loading: sessionLoading } = useSession();
  const value = useMyAccess();

  // Refetch permissions whenever session identity changes (login, logout, user switch).
  useEffect(() => {
    if (sessionLoading) return;
    void value.reload();
  }, [user?.UserID, sessionLoading, value.reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissions() {
  return useContext(Ctx);
}
