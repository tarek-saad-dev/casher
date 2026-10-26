'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';

type Billing = {
  billingState: 'ready' | 'not_ready' | 'already_billed';
  invoiceId: number | null;
  services: Array<{ ProID: number }>;
};

/** Administrative CTA only; no medical history is sent to POS. */
export default function ClinicBillingHandoff({ encounterId, completed }: {
  encounterId: string;
  completed: boolean;
}) {
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!completed) return;
    const ctrl = new AbortController();
    async function load() {
      try {
        const res = await fetch(`/api/clinic/encounters/${encodeURIComponent(encounterId)}/billing`, {
          cache: 'no-store', signal: ctrl.signal,
        });
        const payload = (await res.json()) as Billing & { error?: string };
        if (!res.ok) throw new Error(payload.error || 'تعذر تحديد حالة الفاتورة');
        if (!ctrl.signal.aborted) setData(payload);
      } catch (err) {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : 'تعذر تحميل الحساب');
      }
    }
    void load();
    return () => ctrl.abort();
  }, [encounterId, completed]);

  if (!completed) return null;
  return (
    <section aria-label="حساب الزيارة" className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4">
      <h2 className="flex items-center gap-2 font-black">
        <Receipt className="h-5 w-5 text-cyan-700" /> حساب الزيارة
      </h2>
      {error ? <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p> :
        !data ? <p className="mt-2 text-xs text-slate-500">جاري مراجعة حالة الحساب…</p> :
          data.billingState === 'already_billed' ? (
            <p className="mt-2 text-sm text-emerald-700">
              تم إصدار فاتورة للكشف بالفعل، رقم #{data.invoiceId}. مش هنعمل فاتورة مكررة.
            </p>
          ) : data.billingState === 'ready' ? (
            <>
              <p className="mt-2 text-xs text-slate-600">
                {data.services.length} خدمة مرتبطة بالحجز جاهزة للمراجعة والتحصيل في Shared POS.
              </p>
              <Link
                href={`/income/pos?clinicEncounterId=${encodeURIComponent(encounterId)}`}
                className="mt-3 inline-flex rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white"
              >إرسال الكشف للحسابات</Link>
            </>
          ) : (
            <p className="mt-2 text-xs leading-6 text-slate-600">
              الزيارة مش جاهزة لحساب آلي: لازم تكون مكتملة وبها خدمات محجوزة وأسعار صالحة.
              الزيارات بدون حجز هتتحاسب من POS العادي لحين استكمال ربطها.
            </p>
          )}
    </section>
  );
}
