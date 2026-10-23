'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type History = {
  available: boolean;
  month: string;
  lastSuccessfulWorkDate: string | null;
  days: Array<{ date: string; success: boolean }>;
};

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

export default function ManagerClosingHistory({ workDate, revision = 0 }: { workDate: string; revision?: number }) {
  const month = workDate.slice(0, 7);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError('');
    setHistory(null);
    async function load() {
      try {
        const response = await fetch(`/api/admin/hr/closing-history?month=${encodeURIComponent(month)}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل سجل القفل');
        if (current) setHistory(data);
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : 'تعذر تحميل سجل القفل');
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; controller.abort(); };
  }, [month, revision, retry]);

  const [year, monthNumber] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const records = new Map(history?.days.map(day => [day.date, day.success]));
  const pending = loading || (history !== null && history.month !== month);
  return (
    <section aria-label="سجل قفل اليوم" className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-white">قفل اليوم · {month}</h2>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setRetry(value => value + 1)}>تحديث السجل</Button>
      </div>
      {pending ? <p role="status" className="text-sm text-zinc-400">جاري تحميل آخر قفل...</p>
        : error ? <p role="alert" className="text-sm text-rose-400">{error}</p>
          : !history?.available ? <p className="text-sm text-zinc-400">سجل القفل التلقائي غير متاح لهذه المنشأة.</p>
            : <>
              <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300">
                {history.lastSuccessfulWorkDate ? <>آخر قفل تلقائي ناجح: <time dateTime={history.lastSuccessfulWorkDate}>{dateLabel(history.lastSuccessfulWorkDate)}</time></> : 'لا يوجد قفل تلقائي ناجح مسجّل حتى الآن'}
              </p>
              <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />آخر محاولة ناجحة</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border border-dashed border-amber-500 bg-amber-500/30" />آخر محاولة لم تكتمل</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-zinc-700" />لا توجد محاولة مسجّلة</span>
              </div>
              <div className="overflow-x-auto pb-1.5">
                <div role="list" aria-label="حالة القفل لكل يوم في الشهر" className="flex h-32 min-w-[560px] items-end gap-1.5 border-b border-zinc-700">
                  {Array.from({ length: count }, (_, index) => {
                    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
                    const success = records.get(date);
                    const label = success === true ? 'آخر محاولة ناجحة' : success === false ? 'آخر محاولة لم تكتمل' : 'لا توجد محاولة مسجّلة';
                    return <div key={date} role="listitem" aria-label={`${date}: ${label}`} title={`${dateLabel(date)} — ${label}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <div className="flex h-24 w-full items-end">
                        <div className={`w-full rounded-t-sm ${success === true ? 'h-full bg-emerald-400' : success === false ? 'h-full border border-dashed border-amber-500 bg-amber-500/30' : 'h-1 bg-zinc-700'}`} />
                      </div>
                      <span className="text-[10px] text-zinc-400">{index + 1}</span>
                    </div>;
                  })}
                </div>
              </div>
              <p className="mt-2 text-xs text-zinc-400">التاريخ هو يوم العمل الذي اتقفل، والجراف يعرض آخر محاولة لكل يوم. اليوم الرمادي ليس دليلًا على أن اليوم مفتوح؛ قد لا يكون له سجل قفل تلقائي.</p>
            </>}
    </section>
  );
}
