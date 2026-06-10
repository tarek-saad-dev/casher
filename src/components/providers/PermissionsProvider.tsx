'use client';

import React, { createContext, useContext } from 'react';
import { useMyAccess, type UserAccess } from '@/lib/hooks/useMyAccess';

interface PermissionsCtx {
  access: UserAccess | null;
  loading: boolean;
  canSeePage: (path: string) => boolean;
  hasRole: (role: string) => boolean;
  reload: () => void;
}

const Ctx = createContext<PermissionsCtx>({
  access: null, loading: true,
  canSeePage: () => false,
  hasRole: () => false,
  reload: () => {},
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const value = useMyAccess();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissions() {
  return useContext(Ctx);
}
