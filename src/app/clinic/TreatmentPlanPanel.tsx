'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, ClipboardList, RefreshCw } from 'lucide-react';
import {
  treatmentSessionState, type TreatmentSessionView,
} from '@/apps/medical-records/application/treatmentPlanPolicy';

type Plan = {
  planId: string;
  title: string;
  totalSessions: number;
  sourceEncounterId: string;
  sessions: TreatmentSessionView[];
  progress: {
    total: number; completed: number; remaining: number; booked: number;
    needsRebooking: number; percent: number;
  };
};

const stateLabel = { unbooked: 'لسه من غير حجز', booked: 'محجوزة', completed: 'تم الكشف',
  needs_rebooking: 'الحجز يحتاج مراجعة' };

export default function TreatmentPlanPanel({ encounterId, canCreate }: {
  encounterId: string; canCreate: boolean;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [totalSessions, setTotalSessions] = useState('5');
  const [bookingIds, setBookingIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clinic/treatment-plans?encounterId=${encodeURIComponent(encounterId)}`, {
        cache: 'no-store', signal,
      });
      const payload = (await response.json()) as { plans?: Plan[]; error?: string };
      if (!response.ok || !Array.isArray(payload.plans)) {
        throw new Error(payload.error || 'تعذر تحميل خطة الجلسات');
      }
      if (signal?.aborted) return;
      setPlans(payload.plans);
      setError(null);
      setLoaded(true);
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل الجلسات');
        setLoaded(false);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const totals = useMemo(() => ({
    completed: plans.reduce((n, p) => n + p.progress.completed, 0),
    remaining: plans.reduce((n, p) => n + p.progress.remaining, 0),
  }), [plans]);

  async function createPlan() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/clinic/treatment-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounterId, title, totalSessions: Number(totalSessions) }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'تعذر إنشاء خطة الجلسات');
      setTitle('');
      await load();
      setNotice('تم إنشاء خطة العلاج؛ اربط أي جلسة بحجزها من Booking عند تحديد موعدها.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء خطة العلاج');
    } finally { setBusy(false); }
  }

  async function attachBooking(planId: string, sessionNumber: number) {
    if (busy) return;
    const key = `${planId}:${sessionNumber}`;
    const raw = bookingIds[key]?.trim() || '';
    if (!/^[1-9]\d*$/.test(raw)) {
      setError('اكتب رقم الحجز الصحيح الموجود في Booking.');
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/clinic/treatment-plans/${encodeURIComponent(planId)}/sessions/${sessionNumber}/booking`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: Number(raw) }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'تعذر ربط الحجز');
      setBookingIds(current => ({ ...current, [key]: '' }));
      await load();
      setNotice('اتربط الحجز بالجلسة. هتتسجل منفذة تلقائيًا لما الكشف يكتمل.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر ربط الحجز');
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="الخطة العلاجية والجلسات" className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black">
            <ClipboardList className="h-5 w-5 text-cyan-700" /> خطة الجلسات والمتابعة
          </h2>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-slate-500">
            الجلسات مرتبطة بحجوزات Booking، والتنفيذ بيتحسب تلقائيًا من الكشف المكتمل.
            مفيش جدول مواعيد أو زر «تمت الجلسة» منفصل.
          </p>
        </div>
        <button type="button" onClick={() => void load()} aria-label="تحديث خطة الجلسات"
          disabled={busy || loading} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-40">
          <RefreshCw className="h-4 w-4" /> تحديث
        </button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">{notice}</p>}

      {loading && !loaded ? <p className="mt-5 text-sm text-slate-500">جاري تحميل الخطط…</p> :
        <div className="mt-5 space-y-5">
          {plans.length > 0 && (
            <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
              جلسات منفذة: {totals.completed} · متبقي: {totals.remaining}
            </p>
          )}
          {plans.map(plan => (
            <article key={plan.planId} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-black">{plan.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {plan.progress.completed} من {plan.progress.total} جلسة مكتملة ·
                    {plan.progress.booked} محجوزة · {plan.progress.remaining} متبقية
                  </p>
                </div>
                <span className="text-sm font-black text-cyan-800">{plan.progress.percent}%</span>
              </div>
              <div role="progressbar" aria-label={`تقدم ${plan.title}`} aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={plan.progress.percent}
                className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-cyan-700" style={{ width: `${plan.progress.percent}%` }} />
              </div>
              <div className="mt-4 divide-y divide-slate-100">
                {plan.sessions.map(session => {
                  const state = treatmentSessionState(session);
                  const key = `${plan.planId}:${session.sessionNumber}`;
                  return (
                    <div key={session.sessionNumber} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="w-20 text-xs font-black">جلسة {session.sessionNumber}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${state === 'completed'
                        ? 'bg-emerald-50 text-emerald-700' : state === 'needs_rebooking'
                          ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                        {stateLabel[state]}
                      </span>
                      {session.bookingId ? (
                        <span className="text-xs text-slate-500">
                          حجز #{session.bookingId}{session.bookingDate ? ` · ${session.bookingDate}` : ''}
                        </span>
                      ) : (
                        <div className="mr-auto flex flex-wrap items-center gap-2">
                          <input aria-label={`رقم حجز جلسة ${session.sessionNumber} من ${plan.title}`}
                            inputMode="numeric" value={bookingIds[key] || ''}
                            onChange={e => setBookingIds(v => ({ ...v, [key]: e.target.value }))}
                            placeholder="رقم الحجز" className="w-28 rounded-lg border px-2 py-1.5 text-xs" />
                          <button type="button" disabled={busy} onClick={() => void attachBooking(plan.planId, session.sessionNumber)}
                            className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                            ربط الحجز
                          </button>
                          <Link href="/bookings" className="inline-flex items-center gap-1 text-xs font-bold text-cyan-700">
                            <CalendarPlus className="h-3 w-3" /> حجز جديد
                          </Link>
                        </div>
                      )}
                      {session.encounterId && (
                        <Link href={`/clinic/encounters/${session.encounterId}`} className="mr-auto inline-flex items-center gap-1 text-xs font-bold text-cyan-800">
                          <CheckCircle2 className="h-4 w-4" /> فتح الكشف
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
          {plans.length === 0 && <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">
            مفيش خطة جلسات للمريض مع الطبيب الحالي في الفرع ده.
          </p>}
        </div>
      }

      {canCreate && (
        <form className="mt-5 grid gap-3 rounded-2xl border border-dashed border-cyan-200 bg-cyan-50/40 p-4 sm:grid-cols-[1fr_125px_auto]"
          onSubmit={e => { e.preventDefault(); void createPlan(); }}>
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            اسم الخطة
            <input value={title} onChange={e => setTitle(e.target.value)}
              required minLength={3} maxLength={180}
              placeholder="مثال: 6 جلسات علاج طبيعي" className="rounded-xl border bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            عدد الجلسات
            <input type="number" min={1} max={50} required value={totalSessions}
              onChange={e => setTotalSessions(e.target.value)}
              className="rounded-xl border bg-white px-3 py-2.5 text-sm" />
          </label>
          <button type="submit" disabled={busy}
            className="self-end rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
            {busy ? 'جاري الحفظ…' : 'إنشاء الخطة'}
          </button>
        </form>
      )}
      {!canCreate && plans.length === 0 && (
        <p className="mt-4 text-xs text-slate-500">تقدر تنشئ خطة جديدة بعد ما تكمل الكشف الحالي.</p>
      )}
    </section>
  );
}
