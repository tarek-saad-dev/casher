'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpLeft,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  Package,
  ReceiptText,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react';
import WorkspaceReadinessPanel from '@/components/tenant/WorkspaceReadinessPanel';
import { useTenantShell } from '@/components/tenant/TenantShellProvider';
import {
  pickPrimaryWorkspaceNextAction,
  type TenantWorkspaceSnapshot,
  type WorkspaceAppSummary,
} from '@/platform/tenant/workspaceReadiness';

const LAUNCH: Record<string, { href: string; icon: React.ComponentType<{ className?: string }> }> = {
  booking: { href: '/bookings', icon: CalendarDays },
  queue: { href: '/queue', icon: Users },
  pos: { href: '/income/pos', icon: ReceiptText },
  attendance: { href: '/admin/hr?tab=attendance', icon: Users },
  payroll: { href: '/admin/hr?tab=daily-payroll', icon: CircleDollarSign },
  treasury: { href: '/treasury/daily', icon: ShieldCheck },
  reports: { href: '/reports', icon: ClipboardList },
  inventory: { href: '/admin/services', icon: Package },
  purchasing: { href: '/admin/services', icon: Store },
};

function launcherHref(app: WorkspaceAppSummary): string | null {
  if (app.actionHref) return app.actionHref;
  return LAUNCH[app.code]?.href ?? null;
}

/**
 * Owner-facing Workspace home after signup / first login.
 * Surfaces installed apps and honest setup status — not operational readiness claims.
 */
export default function TenantWorkspacePage() {
  const { snapshot, loading: shellLoading } = useTenantShell();
  const tenantId = snapshot?.tenant.tenantId ?? null;
  const allowed = snapshot?.subscription.allowed ?? false;
  const [workspace, setWorkspace] = useState<TenantWorkspaceSnapshot | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !allowed) {
      setWorkspace(null);
      setWorkspaceError(null);
      return;
    }
    const controller = new AbortController();
    void fetch('/api/tenant/workspace', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('workspace');
        return res.json() as Promise<TenantWorkspaceSnapshot>;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setWorkspace(data);
          setWorkspaceError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWorkspace(null);
          setWorkspaceError('تعذر تحميل حالة التطبيقات.');
        }
      });
    return () => controller.abort();
  }, [tenantId, allowed]);

  const primary = useMemo(
    () => (workspace ? pickPrimaryWorkspaceNextAction(workspace) : null),
    [workspace],
  );

  const installedApps = useMemo(
    () => workspace?.apps.filter((app) => app.status !== 'not_installed') ?? [],
    [workspace],
  );

  const businessName = snapshot?.brand.displayName ?? snapshot?.tenant.name ?? 'منشأتك';
  const locationLabel = snapshot?.tenant.activeLocation?.branchCode ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6" dir="rtl">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span>مساحة العمل</span>
        </div>
        <h1 className="text-xl font-bold sm:text-2xl">{businessName}</h1>
        {locationLabel && (
          <p className="text-sm text-muted-foreground">الموقع النشط: {locationLabel}</p>
        )}
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          التطبيقات المثبتة، الجاهزية الفعلية، والخطوة التالية. التثبيت لوحده مش معناه إن التشغيل جاهز.
        </p>
      </header>

      {shellLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          جاري تحميل بيانات المنشأة…
        </p>
      )}

      {!shellLoading && tenantId && !allowed && (
        <section
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-900 dark:text-amber-100"
        >
          الاشتراك الحالي مش بيسمح بالتشغيل. راجع حالة الاشتراك قبل ما تبدأ الشغل.
          <div className="mt-3">
            <Link href="/admin/billing" className="font-semibold underline underline-offset-2">
              إدارة الاشتراك
            </Link>
          </div>
        </section>
      )}

      {allowed && primary && (
        <section
          className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-4"
          aria-label="الخطوة التالية"
        >
          <h2 className="text-sm font-semibold">الخطوة الأهم دلوقتي</h2>
          <p className="text-sm leading-6">
            <span className="font-semibold">{primary.appLabel}</span>
            {' — '}
            {primary.message}
          </p>
          {primary.href && (
            <Link
              href={primary.href}
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              {primary.status === 'needs_setup' ? 'استكمل الإعداد' : `افتح ${primary.appLabel}`}
              <ArrowUpLeft className="h-3.5 w-3.5" />
            </Link>
          )}
        </section>
      )}

      {allowed && workspaceError && (
        <p role="alert" className="text-sm text-rose-600">
          {workspaceError}
        </p>
      )}

      {allowed && !primary && workspace && workspace.installedCount > 0 && (
        <section className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          التطبيقات مثبتة. مفيش خطوة إعداد مؤكدة من الفحص الحالي — راجع كل تطبيق تحت، ومتعتبرش الحالة
          «جاهز» إلا بعد تجربة فعلية.
        </section>
      )}

      <WorkspaceReadinessPanel />

      {allowed && installedApps.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border p-4" aria-label="تشغيل التطبيقات">
          <div>
            <h2 className="font-semibold">تشغيل سريع</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              افتح التطبيق مباشرة. الروابط دي للتنقل فقط — مش إذن تشغيل.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {installedApps.map((app) => {
              const href = launcherHref(app);
              const Icon = LAUNCH[app.code]?.icon ?? LayoutDashboard;
              if (!href) {
                return (
                  <div
                    key={app.code}
                    className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    <span>{app.label} — رابط التشغيل غير متاح بعد</span>
                  </div>
                );
              }
              return (
                <Link
                  key={app.code}
                  href={href}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted/40"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{app.label}</span>
                  <ArrowUpLeft className="ms-auto h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/admin/tenant"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 hover:bg-muted"
        >
          <Building2 className="h-4 w-4" />
          هوية المنشأة
        </Link>
        <Link
          href="/operations"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 hover:bg-muted"
        >
          لوحة التشغيل
        </Link>
      </section>
    </div>
  );
}
