'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformFetch, SUBSCRIPTION_STATUS_LABELS } from '@/components/platform/platformFetch';
import type { TenantSummary } from '@/platform/onboarding/types';

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    platformFetch<{ tenants: TenantSummary[] }>('/api/admin/platform/tenants')
      .then((r) => setTenants(r.tenants))
      .catch((e: Error) => setError(e.message));
  }, []);

  const q = query.trim().toLowerCase();
  const rows = (tenants ?? []).filter(
    (t) => !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">المنشآت {tenants ? `(${tenants.length})` : ''}</h2>
        <input
          className="w-56 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
          placeholder="بحث بالكود أو الاسم"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!tenants && !error && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
      {tenants && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-2 text-start">الكود</th>
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-start">الحزمة</th>
                <th className="p-2 text-start">الخطة</th>
                <th className="p-2 text-start">الاشتراك</th>
                <th className="p-2 text-start">الفروع</th>
                <th className="p-2 text-start">المستخدمون</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.tenantId} className="border-t border-border hover:bg-muted/30">
                  <td className="p-2 font-mono">
                    <Link href={`/platform/tenants/${t.tenantId}`} className="text-primary hover:underline">
                      {t.code}
                    </Link>
                  </td>
                  <td className="p-2">{t.name}</td>
                  <td className="p-2">{t.industryPackCode ?? '—'}</td>
                  <td className="p-2">{t.planCode ?? '—'}</td>
                  <td className="p-2">
                    {t.subscriptionStatus
                      ? SUBSCRIPTION_STATUS_LABELS[t.subscriptionStatus] ?? t.subscriptionStatus
                      : '—'}
                  </td>
                  <td className="p-2">{t.locationCount}</td>
                  <td className="p-2">{t.userCount}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-muted-foreground">
                    لا توجد منشآت
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
