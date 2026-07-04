'use client';

import { useState, useCallback } from 'react';
import type { UserAccess } from '@/lib/permissions-types';

export type { UserAccess };

const AUTH_DEBUG = process.env.NODE_ENV === 'development';

export function useMyAccess() {
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/permissions/my-access', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        setAccess(null);
        if (AUTH_DEBUG) console.info('[permissions] my-access → 401 unauthenticated');
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as UserAccess;
        setIsAuthenticated(true);
        setAccess(data);
        if (AUTH_DEBUG) {
          console.info('[permissions] my-access → ok', {
            roles: data.roles,
            pageCount: data.allowedPagePaths?.length ?? 0,
          });
        }
      }
    } catch (err) {
      if (AUTH_DEBUG) console.error('[permissions] my-access fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const canSeePage  = (path: string) => {
    if (!access) return false;
    if (access.isSuperAdmin) return true;

    const clean = path.split('?')[0].replace(/\/$/, '') || '/';

    if (access.isPartnerOnly) {
      return clean === '/admin/reports/partners';
    }

    return access.allowedPagePaths.some(p => {
      const np = p.replace(/\/$/, '') || '/';
      return clean === np;
    });
  };

  const hasRole = (role: string) => access?.roles.includes(role) ?? false;

  return { access, loading, isAuthenticated, canSeePage, hasRole, reload: load };
}
