'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, Store } from 'lucide-react';
import { useSession } from '@/hooks/useSession';

export default function LaunchSetup({ onSaved }: { onSaved: () => Promise<void> }) {
  const { loading, user, hasActiveDay, hasActiveShift, hasOpenShift, defaultShiftId, openMyShift, refresh } = useSession();
  const [shifts, setShifts] = useState<{ ShiftID: number; ShiftName: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    if (!hasActiveDay || hasActiveShift || hasOpenShift || defaultShiftId) return;
    const controller = new AbortController();
    void fetch('/api/shift/definitions', { cache: 'no-store', signal: controller.signal })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'تعذر تحميل الورديات.');
        if (!controller.signal.aborted) setShifts(Array.isArray(data.shifts) ? data.shifts : []);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'تعذر تحميل الورديات.');
      });
    return () => controller.abort();
  }, [hasActiveDay, hasActiveShift, hasOpenShift, defaultShiftId]);

  async function run(action: 'day' | 'shift') {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (action === 'day') {
        const res = await fetch('/api/day/open', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'تعذر فتح يوم العمل.');
        await refresh();
      } else {
        const id = defaultShiftId || Number(selected);
        if (!id) throw new Error('اختر وردية.');
        await openMyShift(id);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية.');
    } finally { pending.current = false; setBusy(false); }
  }

  if (loading || !user) return <p className="mt-6 text-sm text-slate-600">بنراجع حالة يوم العمل والوردية…</p>;
  const buttonClass = 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#087e7a] px-4 py-2 text-sm font-black text-white disabled:opacity-50';
  return <div className="mt-7 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
    <h2 className="font-bold">تشغيل الفرع الحالي الآن</h2>
    <p className="text-xs leading-6 text-slate-600">افتح يوم ووردية فقط لو جاهز تبدأ التشغيل الفعلي. مفيش فاتورة أو حركة مالية تلقائية.</p>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-3">
      <span className="flex items-center gap-2 text-sm"><Store className="h-4 w-4 text-[#087e7a]" /> يوم العمل</span>
      {hasActiveDay ? <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" /> مفتوح</span> : <button type="button" disabled={busy} onClick={() => void run('day')} className={buttonClass}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} فتح يوم العمل</button>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-2 text-sm"><Clock3 className="h-4 w-4 text-[#087e7a]" /> ورديتك</span>
      {hasActiveShift ? <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" /> مفتوحة</span> : hasOpenShift ? <p className="text-xs text-amber-800">لديك وردية في فرع آخر؛ راجع إدارة الورديات.</p> : <>
        {!defaultShiftId && shifts.length > 0 && <select aria-label="اختيار الوردية" className="rounded-xl border border-slate-300 bg-[#eef2f5] p-3 text-sm" value={selected} onChange={e => setSelected(e.target.value)}><option value="">اختر وردية</option>{shifts.map(s => <option key={s.ShiftID} value={s.ShiftID}>{s.ShiftName}</option>)}</select>}
        <button type="button" disabled={busy || !hasActiveDay || (!defaultShiftId && !selected)} onClick={() => void run('shift')} className={buttonClass}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} فتح وردية</button>
      </>}
    </div>
    {hasActiveDay && !hasOpenShift && !defaultShiftId && shifts.length === 0 && <p className="text-xs text-slate-600">لو مفيش ورديات متاحة، راجع إعدادات الورديات في الإدارة.</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </div>;
}
