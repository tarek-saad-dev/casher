'use client';

import { useEffect, useState } from 'react';
import BrandProfileForm from '@/components/tenant/BrandProfileForm';
import { useTenantShell } from '@/components/tenant/TenantShellProvider';
import { platformFetch, SUBSCRIPTION_STATUS_LABELS } from '@/components/platform/platformFetch';
import type { TenantBrandProfile } from '@/platform/branding/brandProfile';
import { APP_REGISTRY_CODES } from '@/platform/registry/constants';

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('ar-EG') : '—';
}

/** Tenant settings: brand profile (editable by tenant admins) + installed apps and plan (read-only). */
export default function TenantSettingsPage() {
  const { snapshot, refresh } = useTenantShell();
  const [brand, setBrand] = useState<TenantBrandProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformFetch<{ brand: TenantBrandProfile }>('/api/tenant/brand')
      .then((r) => setBrand(r.brand))
      .catch((e: Error) => setError(e.message));
  }, []);

  const installed = new Set(snapshot?.installedApps ?? []);
  const sub = snapshot?.subscription;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6" dir="rtl">
      <div>
        <h1 className="text-xl font-bold">هوية المنشأة</h1>
        <p className="text-xs text-muted-foreground">
          الاسم والشعار وبيانات الإيصالات تظهر في القائمة والإيصالات والتقارير المطبوعة.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="font-semibold">الهوية والإيصالات</h2>
        {error && <p className="text-sm text-rose-500">{error}</p>}
        {!brand && !error && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
        {brand && (
          <BrandProfileForm
            brand={brand}
            save={async (payload) => {
              const r = await platformFetch<{ brand: TenantBrandProfile }>('/api/tenant/brand', {
                method: 'PUT',
                body: JSON.stringify(payload),
              });
              setBrand(r.brand);
              await refresh();
              return r.brand;
            }}
          />
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2 rounded-xl border border-border p-4">
          <h2 className="font-semibold">الاشتراك</h2>
          {sub ? (
            <ul className="space-y-1 text-sm">
              <li>
                الخطة: <b>{sub.planName ?? sub.planCode ?? '—'}</b>
              </li>
              <li>
                الحالة: <b>{sub.status ? SUBSCRIPTION_STATUS_LABELS[sub.status] ?? sub.status : '—'}</b>
              </li>
              {sub.status === 'trial' && <li>نهاية الفترة التجريبية: {fmt(sub.trialEndsAt)}</li>}
              {sub.currentPeriodEndsAt && <li>نهاية الفترة الحالية: {fmt(sub.currentPeriodEndsAt)}</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
          <p className="text-xs text-muted-foreground">تغيير الخطة يتم عن طريق مزود الخدمة.</p>
        </section>

        <section className="space-y-2 rounded-xl border border-border p-4">
          <h2 className="font-semibold">التطبيقات المثبتة</h2>
          <div className="flex flex-wrap gap-2">
            {APP_REGISTRY_CODES.map((code) => (
              <span
                key={code}
                className={
                  installed.has(code)
                    ? 'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-300'
                    : 'rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground line-through'
                }
              >
                {code}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            إضافة أو إزالة التطبيقات تتم عن طريق مزود الخدمة.
          </p>
        </section>
      </div>
    </div>
  );
}
