'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export default function ManagerDailyClose({ workDate, blocked, onClosed, onBusyChange }: {
  workDate: string;
  blocked: boolean;
  onClosed: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function closeDay() {
    if (blocked || done || inFlight.current) return;
    if (!window.confirm(`قفل يوم العمل ${workDate}؟\nسيتم استكمال الحضور الناقص بالقيم الافتراضية وحساب اليوميات والتارجت لكل الفروع النشطة في المنشأة، وليس الفرع المعروض فقط.\nلن تُرسل رسائل واتساب.`)) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const response = await fetch('/api/admin/hr/nightly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate, dryRun: false, skipWhatsApp: true }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || result.errors?.[0] || 'لم يكتمل قفل اليوم. راجع الحالة قبل إعادة المحاولة.');
      }
      setDone(true);
      await onClosed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر الاتصال بالخادم؛ راجع حالة اليوم قبل إعادة المحاولة.');
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3" aria-label="قفل اليوم">
      <h2 className="text-lg font-bold">قفل اليوم التلقائي · {workDate}</h2>
      <p className="text-sm text-zinc-400">بعد مراجعة وحفظ الحضور، شغّل قفل اليوم لكل الفروع النشطة. نفس عملية القفل الحالية، بدون رسائل واتساب.</p>
      {blocked && <p className="text-sm text-amber-300">انتظر تحميل الحضور واحفظ التعديلات وعالج أي خطأ قبل القفل.</p>}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {done && <p role="status" className="text-emerald-400">تم تنفيذ قفل اليوم {workDate} بنجاح</p>}
      <Button disabled={blocked || busy || done} onClick={() => void closeDay()} className="min-h-11">
        {busy ? 'جاري قفل اليوم...' : done ? 'تم القفل' : 'مراجعة وقفل اليوم'}
      </Button>
      {busy && <div role="dialog" aria-modal="true" aria-label="جاري قفل اليوم" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 text-center text-white">
        جاري قفل يوم {workDate}… برجاء الانتظار وعدم مغادرة الصفحة.
      </div>}
    </section>
  );
}
