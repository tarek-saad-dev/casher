'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/shared/PageHeader';

/**
 * Phase 1M — create branch in SETUP mode only.
 * Final action label must never say "Activate".
 */
export default function NewBranchPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    branchCode: '',
    branchName: '',
    shortName: '',
    address: '',
    phone: '',
    timeZone: 'Africa/Cairo',
    copyQueueSettings: true,
    copyPartnerShares: false,
    sourceBranchCode: 'GLEEM',
  });

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/branches/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchCode: form.branchCode,
          branchName: form.branchName,
          shortName: form.shortName || null,
          address: form.address || null,
          phone: form.phone || null,
          timeZone: form.timeZone,
          template: {
            sourceBranchCode: form.sourceBranchCode,
            queueBookingSettings: form.copyQueueSettings,
            partnerShares: form.copyPartnerShares,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل إنشاء الفرع');
        return;
      }
      router.push(`/admin/branches/${data.branch.branchId}/readiness`);
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6" dir="rtl">
      <PageHeader
        title="إنشاء فرع جديد"
        description="يُنشأ الفرع في وضع الإعداد (SETUP) فقط — بدون تفعيل تشغيلي أو حجز عام"
      />

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">رمز الفرع *</span>
            <input
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
              value={form.branchCode}
              onChange={(e) => set('branchCode', e.target.value.toUpperCase())}
              placeholder="BRANCH2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">اسم الفرع *</span>
            <input
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
              value={form.branchName}
              onChange={(e) => set('branchName', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">اسم مختصر</span>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
              value={form.shortName}
              onChange={(e) => set('shortName', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">الهاتف</span>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">العنوان</span>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </label>
        </div>

        <fieldset className="rounded-xl border border-border/70 p-4">
          <legend className="px-1 text-sm font-semibold">نسخ إعدادات من قالب (اختياري)</legend>
          <p className="mb-3 text-xs text-muted-foreground">
            لا يتم نسخ مبيعات / حجوزات / أرصدة / مخزون / موظفين / خطط رواتب.
            حجز الموقع يبقى مغلقاً دائماً عند الإنشاء.
          </p>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.copyQueueSettings}
              onChange={(e) => set('copyQueueSettings', e.target.checked)}
            />
            نسخ إعدادات الطابور/الحجز (بدون تفعيل الحجز العام)
          </label>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.copyPartnerShares}
              onChange={(e) => set('copyPartnerShares', e.target.checked)}
            />
            نسخ نسب الشركاء (بدون أرصدة)
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">فرع المصدر</span>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
              value={form.sourceBranchCode}
              onChange={(e) => set('sourceBranchCode', e.target.value.toUpperCase())}
            />
          </label>
        </fieldset>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? 'جاري الإنشاء…' : 'Create branch in setup mode'}
          </button>
          <Link href="/admin/settings" className="text-sm text-muted-foreground underline">
            إلغاء
          </Link>
        </div>
      </form>
    </div>
  );
}
