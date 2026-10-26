'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Item = { code: string; message: string; blocking: boolean; link: string };
type Readiness = {
  canCloseOperations: boolean;
  treasuryReconciliationRecorded: boolean;
  items: Item[];
  metrics: {
    pendingClients: number; openShifts: number;
    treasuryReconciliations: number;
    treasuryVarianceAbsolute: number; treasuryVarianceNet: number;
  };
};

export default function SalonCloseReadinessCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    fetch('/api/operations/day-close-readiness', { signal: abort.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('تعذر مراجعة جاهزية القفل');
        return res.json();
      })
      .then((response) => {
        if (!abort.signal.aborted) { setData(response.readiness); setError(''); }
      })
      .catch(() => {
        if (!abort.signal.aborted) { setData(null); setError('تعذر مراجعة جاهزية القفل؛ لا تعتمد على هذه البيانات قبل القفل.'); }
      })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [refreshKey]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3" dir="rtl">
      <div>
        <h2 className="font-semibold text-white">مراجعة جاهزية قفل اليوم</h2>
        <p className="text-xs text-zinc-400 mt-1">مراجعة للفرع الحالي فقط — لا تغلق اليوم تلقائيًا ولا تؤكد اكتمال الحسابات المالية.</p>
      </div>
      {loading ? <p className="text-sm text-zinc-400">جاري مراجعة حالة اليوم...</p> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {data && !loading ? (
        <>
          <p className="text-sm text-zinc-200">
            {data.canCloseOperations ? 'لا توجد موانع تشغيلية ظاهرة في المراجعة الحالية.' : 'هناك خطوات تشغيلية مطلوبة قبل القفل.'}
          </p>
          {data.items.length === 0 ? <p className="text-sm text-emerald-300">لم تظهر ملاحظات في فحص الجاهزية.</p> : (
            <ul className="space-y-2 text-sm">
              {data.items.map((item) => (
                <li key={item.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-800/60 px-3 py-2">
                  <span className={item.blocking ? 'text-amber-300' : 'text-zinc-300'}>{item.message}</span>
                  <Link href={item.link} className="text-amber-200 underline underline-offset-4">فتح القسم</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-zinc-400">
            {data.treasuryReconciliationRecorded
              ? 'توجد مطابقة خزينة مسجلة لليوم؛ راجع الفروقات قبل الاعتماد.'
              : 'لم تُسجل مطابقة خزينة يومية بعد.'}
          </p>
        </>
      ) : null}
    </section>
  );
}
