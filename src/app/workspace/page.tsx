'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpLeft, Building2, LayoutDashboard } from 'lucide-react';
import WorkspaceReadinessPanel from '@/components/tenant/WorkspaceReadinessPanel';
import { useTenantShell } from '@/components/tenant/TenantShellProvider';
import {
  pickPrimaryWorkspaceNextAction,
  type TenantWorkspaceSnapshot,
} from '@/platform/tenant/workspaceReadiness';

/**
 * Owner-facing Workspace home after signup / first login.
 * Surfaces installed apps and honest setup status — not operational readiness claims.
 */
export default function TenantWorkspacePage() {
  const { snapshot, loading: shellLoading } = useTenantShell();
  const tenantId = snapshot?.tenant.tenantId ?? null;
  const allowed = snapshot?.subscription.allowed ?? false;
  const [workspace, setWorkspace] = useState<TenantWorkspaceSnapshot | null>(null);

  useEffect(() => {
    if (!tenantId || !allowed) {
      setWorkspace(null);
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
        if (!controller.signal.aborted) setWorkspace(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWorkspace(null);
      });
    return () => controller.abort();
  }, [tenantId, allowed]);

  const primary = useMemo(
    () => (workspace ? pickPrimaryWorkspaceNextAction(workspace) : null),
    [workspace],
  );

  const businessName = snapshot?.brand.displayName ?? snapshot?.tenant.name ?? 'منشأتك';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6" dir="rtl">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span>مساحة العمل</span>
        </div>
        <h1 className="text-xl font-bold sm:text-2xl">{businessName}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          هنا تشوف التطبيقات المثبتة، إيه اللي محتاج إعداد، وإيه اللي اتشغّل فعلاً.
          التثبيت لوحده مش معناه إن التشغيل جاهز.
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
          الاشتراك الحالي مش بيسمح بالتشغيل. راجع حالة الاشتراك من إعدادات المنشأة قبل ما تبدأ الشغل.
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

      {allowed && !primary && workspace && workspace.installedCount > 0 && (
        <section className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          التطبيقات مثبتة. مفيش خطوة إعداد مؤكدة من الفحص الحالي — راجع حالة كل تطبيق بالتفصيل تحت،
          ومتعتبرش الحالة «جاهز للتشغيل» إلا بعد تجربة فعلية.
        </section>
      )}

      <WorkspaceReadinessPanel />

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
