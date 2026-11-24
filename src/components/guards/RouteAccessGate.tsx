'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import EmptyState from '@/components/shared/EmptyState';
import { useRouteAccess } from '@/hooks/useRouteAccess';

/**
 * Page-level access gate for every route in the authenticated shell.
 *
 * Mode (NEXT_PUBLIC_ROUTE_ACCESS_MODE):
 *   • `report` (default) — never blocks; reports would-be denials to the server
 *     log so grants can be fixed before enforcement.
 *   • `enforce` — shows a "no access" panel instead of the page.
 *   • `off` — disabled.
 *
 * Runs on every client navigation with no extra request (uses the session's
 * page grants). Data APIs stay authoritative.
 */
export type RouteAccessMode = 'report' | 'enforce' | 'off';

export function getRouteAccessMode(): RouteAccessMode {
  const raw = process.env.NEXT_PUBLIC_ROUTE_ACCESS_MODE;
  return raw === 'enforce' || raw === 'off' ? raw : 'report';
}

const reported = new Set<string>();

export default function RouteAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';
  const { decide, access } = useRouteAccess();
  const mode = getRouteAccessMode();
  const decision = mode === 'off' ? null : decide(pathname, search);
  const denied = decision !== null && !decision.allowed;
  const lastReport = useRef<string | null>(null);

  useEffect(() => {
    if (!denied || !decision || decision.allowed) return;
    const key = `${access?.userID ?? 'anon'}|${pathname}?${search}`;
    if (reported.has(key) || lastReport.current === key) return;
    reported.add(key);
    lastReport.current = key;
    void fetch('/api/route-access/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        path: pathname,
        search,
        reason: decision.reason,
        required: decision.required,
        mode,
      }),
    }).catch(() => {
      // reporting is best-effort
    });
  }, [denied, decision, pathname, search, access?.userID, mode]);

  if (denied && mode === 'enforce') {
    return (
      <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xs">
          <EmptyState
            kind="no-access"
            title="ليس لديك صلاحية لفتح هذه الصفحة"
            description="اطلب من مدير النظام إضافة الصلاحية لدورك من شاشة صلاحيات الصفحات."
          />
          <div className="flex justify-center border-t border-border p-3">
            <Link
              href={access?.defaultLandingPath ?? '/'}
              className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold text-primary hover:bg-primary-soft"
            >
              العودة للصفحة الرئيسية
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
