'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpLeft, RefreshCw } from 'lucide-react';
import { useTenantShell } from '@/components/tenant/TenantShellProvider';
import type { TenantWorkspaceSnapshot, WorkspaceAppStatus } from '@/platform/tenant/workspaceReadiness';

const STATUS: Record<Exclude<WorkspaceAppStatus, 'not_installed'>, { label: string; className: string }> = {
  needs_setup: {
    label: 'محتاج إعداد',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  basics_present: {
    label: 'الأساسيات موجودة',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  in_use: {
    label: 'فيه تشغيل مسجل',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  installed_unverified: {
    label: 'مثبت',
    className: 'border-border bg-muted/50 text-muted-foreground',
  },
};

/** Informational only; server-side entitlement and product permissions remain authoritative. */
export default function WorkspaceReadinessPanel() {
  const { snapshot } = useTenantShell();
  const tenantId = snapshot?.tenant.tenantId ?? null;
  const allowed = snapshot?.subscription.allowed ?? false;
  const [data, setData] = useState<TenantWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);

    if (!tenantId || !allowed) {
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);
    void fetch('/api/tenant/workspace', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('تعذر تحميل حالة التطبيقات');
        return res.json() as Promise<TenantWorkspaceSnapshot>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('تعذر تحميل حالة التطبيقات. حاول مرة أخرى.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [tenantId, allowed, retry]);

  if (!tenantId || !allowed) return null;

  const apps = data?.apps.filter((item) => item.status !== 'not_installed') ?? [];
  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-label="حالة التطبيقات">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">حالة التطبيقات</h2>
          <p className="mt-1 text-xs text-muted-foreground">اعرف إيه اللي محتاج تجهيز قبل ما تبدأ الشغل.</p>
        </div>
        {data && (
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {data.installedCount} مثبت · {data.needsSetupCount} محتاج إعداد
          </span>
        )}
      </div>

      {loading && <p role="status" className="text-sm text-muted-foreground">جاري فحص الأساسيات…</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-600">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRetry((n) => n + 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            إعادة المحاولة
          </button>
        </div>
      )}
      {!loading && !error && data && apps.length === 0 && (
        <p className="text-sm text-muted-foreground">لسه مفيش تطبيقات مثبتة للمنشأة.</p>
      )}
      {!loading && !error && data && apps.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {apps.map((app) => {
            const status = STATUS[app.status as Exclude<WorkspaceAppStatus, 'not_installed'>];
            return (
              <article key={app.code} className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{app.label}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.className}`}>
                    {status.label}
                  </span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{app.description}</p>
                {app.nextAction && <p className="text-xs leading-5">{app.nextAction}</p>}
                {app.actionHref && (
                  <Link
                    href={app.actionHref}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    {app.status === 'needs_setup' ? 'استكمل الإعداد' : `افتح ${app.label}`}
                    <ArrowUpLeft className="h-3.5 w-3.5" />
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="text-[11px] leading-5 text-muted-foreground">
        الحالة دي مؤشر مبدئي من بيانات المنشأة، مش تأكيد إن كل إعدادات التطبيق سليمة أو إن الحجز العام اتفعّل.
      </p>
    </section>
  );
}
