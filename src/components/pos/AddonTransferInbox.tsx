'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2, X } from 'lucide-react';

type RequestItem = {
  requestId: number; bookingId: number; originalEmpId: number; empName: string;
  clientFirstName: string; proId: number; serviceName: string;
  branchId: number; submittedAt: string;
};
type Alternate = { empId: number; empName: string; startAt: string; endAt: string };
type Preview = {
  requestId: number; alternatives: Alternate[];
  durationMinutes: number; originalAvailable: boolean;
};

function cairoTime(iso: string) {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export default function AddonTransferInbox({ enabled }: { enabled: boolean }) {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<RequestItem | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) { setItems([]); return; }
    try {
      const res = await fetch('/api/pos/addon-transfers', { cache: 'no-store' });
      if (!res.ok) throw new Error('refresh_failed');
      const data = await res.json() as { items?: RequestItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError('تعذر تحديث طلبات الخدمات الإضافية');
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const timer = window.setInterval(() => void refresh(), 12_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, refresh]);

  async function openRequest(item: RequestItem) {
    setSelected(item);
    setPreview(null);
    setError('');
    setToast('');
    setLoadingId(item.requestId);
    try {
      const res = await fetch(
        '/api/pos/addon-transfers/' + item.requestId + '/alternatives',
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل الموظفين المتاحين');
      setPreview(data as Preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر فحص مواعيد الموظفين');
    } finally {
      setLoadingId(null);
    }
  }

  async function assign(employee: Alternate) {
    if (!selected || approving) return;
    setApproving(true);
    setError('');
    try {
      const res = await fetch(
        '/api/pos/addon-transfers/' + selected.requestId + '/assign',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empId: employee.empId, startAt: employee.startAt }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر تأكيد التحويل');
      setToast('تم حجز الخدمة عند ' + employee.empName + ' من ' + cairoTime(employee.startAt));
      setSelected(null);
      setPreview(null);
      await refresh();
    } catch (err) {
      setPreview(null);
      setError((err instanceof Error ? err.message : 'تعذر تأكيد الخدمة') +
        ' — افحص المواعيد من جديد');
    } finally {
      setApproving(false);
    }
  }

  if (!enabled) return null;

  return (
    <div className="relative" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-900 dark:text-amber-100"
      >
        <CalendarClock size={17} aria-hidden="true" />
        تحويل خدمات إضافية ({items.length})
      </button>
      {open ? (
        <div className="absolute z-40 mt-2 w-[min(100vw-2rem,25rem)] rounded-2xl border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-bold">طلبات نقل خدمة لموظف متاح</p>
            <button type="button" onClick={() => { setOpen(false); setSelected(null); }} aria-label="إغلاق" className="p-2">
              <X size={16} />
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            الأولوية للمواعيد المؤكدة. اختيار بديل لا يُعتمد إلا بعد إعادة فحص التوافر.
          </p>
          {toast ? (
            <p role="status" className="mb-2 flex gap-1 text-xs text-emerald-600">
              <CheckCircle2 size={15} />{toast}
            </p>
          ) : null}
          {error ? <p role="alert" className="mb-2 text-xs text-destructive">{error}</p> : null}
          {!items.length ? <p className="text-xs text-muted-foreground">مفيش طلبات تحويل دلوقتي.</p> : null}
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {items.map(item => (
              <div key={item.requestId} className="rounded-xl border border-border p-3">
                <p className="text-sm font-bold">{item.clientFirstName} · {item.serviceName}</p>
                <p className="mt-1 text-xs text-muted-foreground">الحلاق الأصلي: {item.empName}</p>
                <button
                  type="button"
                  disabled={loadingId != null || approving}
                  onClick={() => void openRequest(item)}
                  className="mt-2 min-h-9 rounded-lg border border-amber-500/40 px-3 text-xs font-bold text-amber-700 disabled:opacity-50 dark:text-amber-200"
                >
                  {loadingId === item.requestId ? <><Loader2 className="inline h-3 w-3 animate-spin" /> جاري الفحص…</> : 'اختيار موظف بديل'}
                </button>
                {selected?.requestId === item.requestId && preview ? (
                  <div className="mt-3 space-y-2 border-t border-border pt-2">
                    {preview.alternatives.length > 0 ? (
                      preview.alternatives.map(employee => (
                        <div key={employee.empId} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-2">
                          <span className="text-xs">{employee.empName} · {cairoTime(employee.startAt)}–{cairoTime(employee.endAt)}</span>
                          <button
                            type="button"
                            disabled={approving}
                            onClick={() => void assign(employee)}
                            className="min-h-9 shrink-0 rounded-lg bg-amber-400 px-2 text-xs font-bold text-zinc-950 disabled:opacity-50"
                          >
                            {approving ? 'جاري الحجز…' : 'تأكيد الحجز'}
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        مفيش بديل متاح في المواعيد القريبة — راجع جدول الحجوزات يدويًا بدون تجاوز المواعيد المؤكدة.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
