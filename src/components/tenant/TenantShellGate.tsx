'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Info, PackageX, ShieldOff } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';
import { requiredAppsForRoute } from '@/platform/tenant/navAppGating';
import { describeSubscriptionNotice } from '@/platform/tenant/subscriptionBanner';
import { useTenantShell } from './TenantShellProvider';

const ALWAYS_OPEN_PREFIXES = ['/platform', '/403', '/login'];

function isAlwaysOpen(pathname: string): boolean {
  return ALWAYS_OPEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Subscription banner (trial ending, past due, cancelled) above the page content. */
export function TenantSubscriptionBanner() {
  const { snapshot } = useTenantShell();
  if (!snapshot || !snapshot.subscription.allowed) return null;
  const notice = describeSubscriptionNotice(snapshot.subscription);
  if (!notice) return null;
  const Icon = notice.tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 px-4 py-1.5 text-xs border-b',
        notice.tone === 'info' && 'bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-300',
        notice.tone === 'warning' && 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold">{notice.title}</span>
      <span className="opacity-90">{notice.detail}</span>
    </div>
  );
}

function BlockedPanel({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: typeof ShieldOff;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
          <Icon className="h-8 w-8 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{detail}</p>
        {action}
      </div>
    </div>
  );
}

/**
 * Replaces page content when the tenant subscription is inactive or the route belongs to an app
 * the tenant has not installed. APIs enforce the same rules server-side; this is the UX layer.
 */
export function TenantShellGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { snapshot } = useTenantShell();
  const { logout } = useSession();

  if (!snapshot || isAlwaysOpen(pathname)) return <>{children}</>;

  if (!snapshot.subscription.allowed) {
    const notice = describeSubscriptionNotice(snapshot.subscription);
    return (
      <BlockedPanel
        icon={ShieldOff}
        title={notice?.title ?? 'اشتراك المنشأة غير نشط'}
        detail={notice?.detail ?? ''}
        action={
          <div className="flex justify-center gap-2">
            {snapshot.isPlatformOperator && (
              <Link href="/platform" className="rounded-lg border border-border px-4 py-2 text-sm">
                لوحة المنصة
              </Link>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              تسجيل الخروج
            </button>
          </div>
        }
      />
    );
  }

  const required = requiredAppsForRoute(pathname);
  if (required && !required.some((app) => snapshot.installedApps.includes(app))) {
    return (
      <BlockedPanel
        icon={PackageX}
        title="هذا التطبيق غير مثبت"
        detail={`هذه الصفحة تتطلب تطبيق (${required.join(' أو ')}) وهو غير مثبت لمنشأتك. تواصل مع مزود الخدمة لإضافته.`}
        action={
          <Link href="/" className="inline-block rounded-lg border border-border px-4 py-2 text-sm">
            العودة للرئيسية
          </Link>
        }
      />
    );
  }

  return <>{children}</>;
}
