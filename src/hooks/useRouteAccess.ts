'use client';

import { useCallback } from 'react';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import { decideRouteAccess, type RouteAccessDecision } from '@/lib/routing/routeRegistry';

/**
 * Route-level access derived from the route registry + the user's page grants.
 * Used by the menu (what to show) and RouteAccessGate (what to render), so both
 * always agree. Server APIs keep their own authorization.
 */
export function useRouteAccess() {
  const { access, loading } = usePermissions();

  const decide = useCallback(
    (href: string, search = ''): RouteAccessDecision | null => {
      if (!access) return null;
      return decideRouteAccess(
        href,
        {
          isSuperAdmin: access.isSuperAdmin,
          isPartnerOnly: access.isPartnerOnly,
          allowedPagePaths: access.allowedPagePaths,
        },
        search,
      );
    },
    [access],
  );

  const canOpen = useCallback((href: string, search = '') => decide(href, search)?.allowed === true, [decide]);

  return { access, loading, decide, canOpen };
}
