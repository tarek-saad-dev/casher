'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { setClientTenantBrand } from '@/lib/tenant/tenantBrandClient';
import { isRouteAvailable } from '@/platform/tenant/navAppGating';
import type { TenantShellSnapshot } from '@/platform/tenant/tenantShellTypes';

const REFRESH_MS = 5 * 60 * 1000;

interface TenantShellContextValue {
  snapshot: TenantShellSnapshot | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** True until the snapshot loads, so nothing is hidden on a slow first fetch. */
  isAppRouteAvailable: (href: string) => boolean;
}

const TenantShellContext = createContext<TenantShellContextValue>({
  snapshot: null,
  loading: true,
  refresh: async () => {},
  isAppRouteAvailable: () => true,
});

export function useTenantShell(): TenantShellContextValue {
  return useContext(TenantShellContext);
}

/** Loads /api/tenant/context for the signed-in staff member: brand, installed apps, subscription. */
export default function TenantShellProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const userId = user?.UserID ?? null;
  const [snapshot, setSnapshot] = useState<TenantShellSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/context', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        setSnapshot(null);
        return;
      }
      setSnapshot((await res.json()) as TenantShellSnapshot);
    } catch {
      /* keep the last known snapshot on network errors */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId == null) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId, refresh]);

  useEffect(() => {
    setClientTenantBrand(snapshot?.brand ?? null);
    const name = snapshot?.brand.displayName;
    if (name) document.title = `نقطة البيع — ${name}`;
  }, [snapshot]);

  const value = useMemo<TenantShellContextValue>(
    () => ({
      snapshot,
      loading,
      refresh,
      isAppRouteAvailable: (href: string) =>
        !snapshot || isRouteAvailable(href, snapshot.installedApps),
    }),
    [snapshot, loading, refresh],
  );

  return <TenantShellContext.Provider value={value}>{children}</TenantShellContext.Provider>;
}
