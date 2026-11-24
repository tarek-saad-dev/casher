'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouteAccess } from '@/hooks/useRouteAccess';
import { cn } from '@/lib/utils';

/**
 * One CUT CLUB hub: every loyalty screen (store, stock, tiers, points …) is a
 * tab here instead of a separate destination. Tabs are real routes, so each
 * keeps its URL and grant; the shared layout stays mounted between them.
 */
export const CUT_CLUB_TABS = [
  { href: '/admin/cut-club', label: 'الرئيسية' },
  { href: '/admin/loyalty', label: 'النقاط والعملاء' },
  { href: '/admin/cut-club/store', label: 'المتجر' },
  { href: '/admin/cut-club/inventory', label: 'المخزون' },
  { href: '/admin/cut-club/mystery-boxes', label: 'صناديق الغموض' },
  { href: '/admin/cut-club/tiers', label: 'المستويات' },
  { href: '/admin/cut-club/transactions', label: 'المعاملات' },
  { href: '/admin/cut-club/referrals', label: 'الإحالات' },
  { href: '/admin/cut-club/analytics', label: 'التحليلات' },
  { href: '/admin/cut-club/settings', label: 'الإعدادات' },
] as const;

export default function CutClubTabs() {
  const pathname = usePathname();
  const { canOpen, loading } = useRouteAccess();
  if (loading) return null;
  const tabs = CUT_CLUB_TABS.filter((t) => canOpen(t.href));
  if (tabs.length < 2) return null;

  return (
    <nav aria-label="CUT CLUB" className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
