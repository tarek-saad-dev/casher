'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { platformFetch } from '@/components/platform/platformFetch';
import type { PlanRequestRow } from '@/platform/commercial/planRequestService';

export default function OperatorPlanRequestQueue() {
  const [requests, setRequests] = useState<PlanRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => setRequests((await platformFetch<{ requests: PlanRequestRow[] }>('/api/admin/platform/billing-requests')).requests);
  useEffect(() => {
    let live = true;
    platformFetch<{ requests: PlanRequestRow[] }>('/api/admin/platform/billing-requests')
      .then((r) => { if (live) setRequests(r.requests); })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const review = async (requestId: string, action: 'contacted' | 'rejected') => {
    if (!notes[requestId]?.trim()) { setError('اكتب ملاحظة توضح نتيجة التواصل الأول'); return; }
    setBusy(requestId); setError(null);
    try {
      await platformFetch('/api/admin/platform/billing-requests', {
        method: 'PATCH', body: JSON.stringify({ requestId, action, note: notes[requestId].trim() }),
      });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر مراجعة الطلب'); }
    finally { setBusy(null); }
  };

  return <section dir="rtl" className="space-y-4">
    <div>
      <h2 className="text-2xl font-bold">طلبات الاشتراك</h2>
      <p className="text-sm text-muted-foreground">طلبات للتواصل اليدوي فقط — التواصل أو الرفض لا يساوي الدفع أو التفعيل.</p>
    </div>
    {error && <div role="alert" className="rounded-xl border border-rose-500/30 p-3 text-sm text-rose-500">{error}</div>}
    {loading ? <div className="flex gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جاري التحميل…</div> :
      requests.length === 0 ? <div className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">لا توجد طلبات قيد المراجعة.</div> :
      <div className="space-y-3">
        {requests.map((r) => <article key={r.requestId} className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{r.requestedPlanCode.toUpperCase()} · {r.billingCycle === 'annual' ? 'سنوي' : 'شهري'}</h3>
              <p className="mt-1 text-xs text-muted-foreground">Tenant: {r.tenantId} · قبل الطلب: {r.fromPlanCode} · {new Date(r.createdAt).toLocaleString('ar-EG')}</p>
            </div>
            <b>{new Intl.NumberFormat('ar-EG').format(r.quotedAmountEgp)} ج.م</b>
          </div>
          <label htmlFor={'note-'+r.requestId} className="block text-xs text-muted-foreground">ملاحظة المراجعة (إجباري)</label>
          <textarea id={'note-'+r.requestId} value={notes[r.requestId] ?? ''} maxLength={500} rows={2}
            onChange={e => setNotes(prev => ({ ...prev, [r.requestId]: e.target.value }))}
            placeholder="نتيجة التواصل أو سبب الرفض"
            className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button disabled={busy !== null} onClick={() => void review(r.requestId, 'contacted')}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              {busy === r.requestId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              تم التواصل
            </button>
            <button disabled={busy !== null} onClick={() => void review(r.requestId, 'rejected')}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">
              <AlertTriangle className="h-4 w-4" /> رفض الطلب
            </button>
          </div>
        </article>)}
      </div>}
    <p className="text-xs text-muted-foreground">تحذير: لا تغيّر الاشتراك من هنا قبل التحقق الفعلي من التحصيل. شاشة المراجعة لا تحتوي إجراء «تم الدفع».</p>
  </section>;
}
