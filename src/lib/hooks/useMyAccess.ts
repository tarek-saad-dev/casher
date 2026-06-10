'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserAccess } from '@/lib/permissions-types';

export type { UserAccess };

export function useMyAccess() {
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/permissions/my-access');
      if (res.ok) setAccess(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canSeePage  = (path: string) => {
    if (!access) return false;
    if (access.isSuperAdmin) return true;
    const clean = path.replace(/\/$/, '') || '/';
    return access.allowedPagePaths.some(p => {
      const np = p.replace(/\/$/, '') || '/';
      return clean === np || clean.startsWith(np + '/');
    });
  };

  const hasRole = (role: string) => access?.roles.includes(role) ?? false;

  return { access, loading, canSeePage, hasRole, reload: load };
}
