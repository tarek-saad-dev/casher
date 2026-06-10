'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserAccess } from '@/lib/permissions-types';

export type { UserAccess };

export function useMyAccess() {
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/permissions/my-access');
      if (res.status === 401) {
        // Not logged in — stop loading, don't block nav
        setIsAuthenticated(false);
        setAccess(null);
        return;
      }
      if (res.ok) {
        setIsAuthenticated(true);
        setAccess(await res.json());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canSeePage  = (path: string) => {
    if (!access) return false;
    if (access.isSuperAdmin) return true;
    // Exact match only — no prefix/children inheritance
    const clean = path.split('?')[0].replace(/\/$/, '') || '/';
    return access.allowedPagePaths.some(p => {
      const np = p.replace(/\/$/, '') || '/';
      return clean === np;
    });
  };

  const hasRole = (role: string) => access?.roles.includes(role) ?? false;

  return { access, loading, isAuthenticated, canSeePage, hasRole, reload: load };
}
