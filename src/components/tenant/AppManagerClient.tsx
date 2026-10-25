'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowRight, Check, ChevronLeft, Loader2,
  LockKeyhole, Package, PackagePlus, Power, ShieldCheck, Sparkles,
} from 'lucide-react';
import { platformFetch } from '@/components/platform/platformFetch';
import { useTenantShell } from '@/components/tenant/TenantShellProvider';
import { appManagerLabel, type AppManagerItem } from '@/platform/apps/selfServiceAppManager';

type ManagerResponse = {
  pack: { code: string; name: string } | null;
  apps: AppManagerItem[];
  protectedTenant: boolean;
};
type PendingAction = { action: 'install' | 'disable'; app: AppManagerItem };

const GROUP_LABELS: Record<string, string> = {
  required: 'أساسي', recommended: 'موصى به', optional: 'اختياري', managed: 'تحت إدارة المنصة',
};

export default function AppManagerClient() {
  const { refresh } = useTenantShell();
  const [data, setData] = useState<ManagerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await platformFetch<ManagerResponse>('/api/tenant/apps');
    setData(result);
  }, []);

  useEffect(() => {
    let live = true;
    platformFetch<ManagerResponse>('/api/tenant/apps')
      .then((result) => { if (live) setData(result); })
      .catch((err: Error) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const enabled = useMemo(() => data?.apps.filter((app) => app.status === 'installed') ?? [], [data]);
  const available = useMemo(() => data?.apps.filter((app) => app.status !== 'installed') ?? [], [data]);

  const mutate = async (action: 'install' | 'disable', app: AppManagerItem) => {
    setBusy(app.code);
    setError(null);
    setNotice(null);
    try {
      const result = await platformFetch<ManagerResponse & { change: { appCodes: string[] } }>(
        '/api/tenant/apps',
        {
          method: 'POST',
          body: JSON.stringify({
            action, appCode: app.code,
            confirmDisable: action === 'disable',
            confirmDependencies: action === 'install' && app.missingDependencies.length > 0,
          }),
        },
      );
      setData(result);
      setPending(null);
      setNotice(action === 'install'
        ? 'تم تفعيل ' + result.change.appCodes.map(appManagerLabel).join(' و ') + ' بنجاح'
        : 'تم إيقاف ' + app.name + '، وبياناته محفوظة');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية');
      // Refresh after a server-side conflict so stale dependency states aren't reused.
      try { await load(); } catch { /* retain last snapshot */ }
    } finally {
      setBusy(null);
    }
  };

  const requestChange = (action: 'install' | 'disable', app: AppManagerItem) => {
    setError(null);
    setNotice(null);
    // Single-app install needs just one click. Disabling or enabling dependencies is confirmed.
    if (action === 'install' && app.missingDependencies.length === 0) {
      void mutate(action, app);
    } else {
      setPending({ action, app });
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-7 px-4 py-5 md:px-8 md:py-8" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/admin/tenant" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowRight className="h-3.5 w-3.5" /> إعدادات المنشأة
          </Link>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">التطبيقات</h1>
          <p className="text-sm text-muted-foreground">
            التطبيقات اللي بتشغّل شغلك. ضيف اللي محتاجه، ووقف اللي مش بتستخدمه.
          </p>
        </div>
        {data?.pack && (
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> نشاطك: {data.pack.name}
          </span>
        )}
      </div>

      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="h-4 w-4" /> {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          <button type="button" className="mr-auto shrink-0 underline" onClick={() => { setError(null); void load().catch((e: Error) => setError(e.message)); }}>إعادة المحاولة</button>
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-3 rounded-2xl border border-border p-8 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل التطبيقات…
        </div>
      )}

      {!loading && data && (
        <>
          {data.protectedTenant && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              حساب CUT الأساسي محمي. يمكنك مشاهدة التطبيقات، والتعديل يتم عن طريق إدارة المنصة فقط.
            </div>
          )}
          {!data.pack && (
            <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
              لم يتم ضبط باقة نشاط لهذه المنشأة. تواصل مع إدارة المنصة.
            </div>
          )}

          <section className="space-y-4" aria-labelledby="installed-heading">
            <div className="flex items-center gap-3">
              <h2 id="installed-heading" className="text-lg font-bold">شغّالة عندك</h2>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-300">{enabled.length}</span>
            </div>
            {enabled.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">لا توجد تطبيقات مفعّلة حاليًا.</p>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {enabled.map((app) => (
                <AppTile
                  key={app.code}
                  app={app}
                  busy={busy !== null}
                  onChange={() => requestChange('disable', app)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="available-heading">
            <div className="flex items-center gap-3">
              <h2 id="available-heading" className="text-lg font-bold">تقدر تضيف كمان</h2>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{available.length}</span>
            </div>
            {available.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">كل التطبيقات المتاحة لنشاطك مفعّلة بالفعل.</p>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {available.map((app) => (
                <AppTile key={app.code} app={app} busy={busy !== null} onChange={() => requestChange('install', app)} />
              ))}
            </div>
          </section>

          <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            إيقاف أي تطبيق يمنع استخدامه، لكنه لا يمسح الفواتير أو البيانات القديمة. التطبيقات الأساسية لا يمكن إيقافها.
          </p>
        </>
      )}

      {pending && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) setPending(null); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="apps-confirm-title"
            className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {pending.action === 'disable' ? <Power className="h-5 w-5" /> : <PackagePlus className="h-5 w-5" />}
            </div>
            <h3 id="apps-confirm-title" className="text-lg font-bold">
              {pending.action === 'disable' ? 'إيقاف ' + pending.app.name + '؟' : 'إضافة ' + pending.app.name + '؟'}
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              {pending.action === 'disable'
                ? 'التطبيق مش هيكون متاح للاستخدام، لكن كل بياناته القديمة هتفضل محفوظة، وتقدر ترجّعه بعدين.'
                : 'التطبيق ده محتاج كمان: ' + pending.app.missingDependencies.map(appManagerLabel).join('، ') + '. هيتم تفعيلهم مع بعض.'}
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void mutate(pending.action, pending.app)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                تأكيد
              </button>
              <button type="button" disabled={busy !== null} onClick={() => setPending(null)} className="min-h-11 flex-1 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AppTile({ app, busy, onChange }: { app: AppManagerItem; busy: boolean; onChange: () => void }) {
  const active = app.status === 'installed';
  const changeAllowed = active ? app.canDisable : app.canInstall;
  return (
    <article className="flex min-h-48 flex-col justify-between gap-5 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className={'flex h-10 w-10 items-center justify-center rounded-xl ' +
            (active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
            {active ? <Package className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            {GROUP_LABELS[app.group]}
          </span>
        </div>
        <div>
          <h3 className="font-bold">{app.name}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{app.description}</p>
        </div>
        {!active && app.missingDependencies.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-300">
            يحتاج: {app.missingDependencies.map(appManagerLabel).join('، ')}
          </p>
        )}
      </div>
      <div className="flex min-h-10 items-center justify-between gap-2">
        <span className={'inline-flex items-center gap-1.5 text-xs ' +
          (active ? 'text-emerald-600 dark:text-emerald-300' : 'text-muted-foreground')}>
          {active ? <Check className="h-3.5 w-3.5" /> : null}
          {active ? 'مفعّل' : app.status === 'disabled' ? 'متوقف' : 'غير مضاف'}
        </span>
        {changeAllowed ? (
          <button
            type="button"
            disabled={busy}
            onClick={onChange}
            className={'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50 ' +
              (active ? 'border border-border hover:bg-muted' : 'bg-primary text-primary-foreground hover:opacity-90')}
          >
            {active ? 'إيقاف' : 'إضافة التطبيق'}
            {!active && <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="max-w-[60%] text-left text-[11px] leading-5 text-muted-foreground">
            {app.lockedReason ?? 'غير متاح'}
          </span>
        )}
      </div>
    </article>
  );
}
