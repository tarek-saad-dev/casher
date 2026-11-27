'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, Store, ArrowLeft, Rocket, ShieldCheck, GraduationCap } from 'lucide-react';
import { useSession } from '@/hooks/useSession';

export default function LaunchSetup({ onSaved }: { onSaved: () => Promise<void> }) {
  const { loading, user, hasActiveDay, hasActiveShift, hasOpenShift, defaultShiftId, openMyShift, refresh } = useSession();
  const [shifts, setShifts] = useState<{ ShiftID: number; ShiftName: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<'day'|'shift'|null>(null);
  const [message, setMessage] = useState('');
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
    if (pending.current || (action==='day' && hasActiveDay) || (action==='shift' && (!hasActiveDay || hasActiveShift || hasOpenShift))) return;
    pending.current = true; setBusy(true); setRunning(action); setError(''); setMessage('');
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
      setMessage(action==='day'?'تم طلب فتح يوم العمل بنجاح.':'تم طلب فتح الوردية بنجاح.');
      try { await onSaved(); } catch { setError('تمت العملية، لكن تعذر تحديث حالة التجهيز. حدّث الصفحة قبل إعادة المحاولة.'); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية.');
    } finally { pending.current = false; setBusy(false); setRunning(null); }
  }

  if (loading || !user) return <p className="mt-6 text-sm text-slate-600">بنراجع حالة يوم العمل والوردية…</p>;
  const buttonClass = 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#087e7a] px-4 py-2 text-sm font-black text-white disabled:opacity-50';
  return <div className="mt-7 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <div className="rounded-xl bg-gradient-to-br from-[#102433] to-[#0b514f] p-4 text-white"><div className="flex items-center gap-2 text-xs font-bold text-[#9af0e7]"><Rocket className="h-4 w-4"/> التشغيل الفعلي</div><h2 className="mt-2 text-lg font-black">تشغيل الفرع الحالي الآن</h2><p className="mt-2 text-xs leading-6 text-slate-200">افتح يوم ووردية فقط لو جاهز تبدأ التشغيل الفعلي. مفيش فاتورة أو حركة مالية تلقائية.</p><div className="mt-4 flex items-center justify-between text-xs"><span>حالة يوم العمل والوردية</span><b>{Number(!!hasActiveDay)+Number(!!hasActiveShift)} / 2</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-[#9af0e7] motion-safe:transition-all" style={{width:(Number(!!hasActiveDay)+Number(!!hasActiveShift))*50+'%'}}/></div></div>
    <Link href="/setup/training" className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs font-bold text-teal-900"><GraduationCap className="h-5 w-5 shrink-0"/> جرّب العمليات في التدريب قبل التشغيل <ArrowLeft className="ms-auto h-4 w-4 shrink-0"/></Link>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-3">
      <span className="flex items-center gap-2 text-sm"><Store className="h-4 w-4 text-[#087e7a]" /> يوم العمل</span>
      {hasActiveDay ? <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" /> مفتوح</span> : <button type="button" disabled={busy} onClick={() => void run('day')} className={buttonClass}>{running==='day' && <Loader2 className="h-4 w-4 animate-spin" />} {running==='day'?'جاري فتح اليوم…':'فتح يوم العمل'}</button>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-2 text-sm"><Clock3 className="h-4 w-4 text-[#087e7a]" /> ورديتك</span>
      {hasActiveShift ? <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" /> مفتوحة</span> : hasOpenShift ? <p className="text-xs text-amber-800">لديك وردية في فرع آخر؛ راجع إدارة الورديات.</p> : <>
        {!defaultShiftId && shifts.length > 0 && <select aria-label="اختيار الوردية" className="rounded-xl border border-slate-300 bg-[#eef2f5] p-3 text-sm" value={selected} onChange={e => setSelected(e.target.value)}><option value="">اختر وردية</option>{shifts.map(s => <option key={s.ShiftID} value={s.ShiftID}>{s.ShiftName}</option>)}</select>}
        <button type="button" disabled={busy || !hasActiveDay || (!defaultShiftId && !selected)} onClick={() => void run('shift')} className={buttonClass}>{running==='shift' && <Loader2 className="h-4 w-4 animate-spin" />} {running==='shift'?'جاري فتح الوردية…':'فتح وردية'}</button>
      </>}
    </div>
    {hasActiveDay && !hasOpenShift && !defaultShiftId && shifts.length === 0 && <p className="text-xs text-slate-600">لو مفيش ورديات متاحة، راجع إعدادات الورديات في الإدارة.</p>}
    {message && <p role="status" className="rounded-xl bg-teal-50 p-3 text-xs font-bold text-teal-900">{message}</p>}
    {hasActiveDay && hasActiveShift && <div className="rounded-xl border border-teal-200 bg-teal-50 p-4"><div className="flex items-center gap-2 font-bold text-teal-900"><ShieldCheck className="h-5 w-5"/> اليوم وورديتك مفتوحان</div><p className="mt-2 text-xs leading-6 text-slate-700">راجع باقي التجهيز قبل تسجيل أول فاتورة فعلية.</p><Link href="/setup/finish" className={buttonClass+' mt-3'}>مراجعة الانطلاق <ArrowLeft className="h-4 w-4"/></Link></div>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
  </div>;
}
