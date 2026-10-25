'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, RefreshCw, Stethoscope } from 'lucide-react';

type Appointment = {
  BookingID: number;
  BookingDate: string;
  StartTimeDisplay: string | null;
  Status: string;
  PatientName: string;
  PractitionerName: string;
  EncounterId: string | null;
  EncounterStatus: string | null;
};

const labels: Record<string, string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكد',
  arrived: 'حضر',
  queued: 'في الانتظار',
  in_service: 'الكشف جاري',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  canceled: 'ملغي',
  rescheduled: 'تم تغيير الموعد',
  no_show: 'لم يحضر',
};

const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

export default function ClinicAppointmentsPanel() {
  const router = useRouter();
  const [date, setDate] = useState(localDate);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clinic/appointments?date=${encodeURIComponent(date)}`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('تعذر تحميل جدول المواعيد');
      const data = (await response.json()) as { appointments?: Appointment[] };
      if (!signal?.aborted) {
        setAppointments(Array.isArray(data.appointments) ? data.appointments : []);
        setError(null);
      }
    } catch {
      if (!signal?.aborted) setError('تعذر تحميل جدول المواعيد. جرّب تحديث القائمة.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function transition(item: Appointment, action: 'arrive' | 'start') {
    if (workingId !== null) return;
    setWorkingId(item.BookingID);
    setError(null);
    try {
      const response = await fetch(`/api/clinic/appointments/${item.BookingID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as { encounterId?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'تعذر تحديث الحجز');
      if (action === 'start' && data.encounterId) {
        router.push(`/clinic/encounters/${data.encounterId}`);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث الحجز');
      await load();
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border bg-white p-4 shadow-sm sm:p-5" aria-label="مواعيد العيادة">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black">
            <CalendarClock className="h-5 w-5 text-cyan-700" />
            مواعيد العيادة
          </h2>
          <p className="mt-1 text-xs text-slate-500">الحجوزات من نظام Booking مباشرة — بدون إدخال المريض مرتين.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            aria-label="تاريخ مواعيد العيادة"
            type="date"
            value={date}
            onChange={event => setDate(event.target.value)}
            className="rounded-xl border bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void load()}
            aria-label="تحديث المواعيد"
            title="تحديث المواعيد"
            disabled={loading}
            className="rounded-xl border p-2 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? (
        <p className="mt-4 text-sm text-slate-500">جاري تحميل المواعيد…</p>
      ) : appointments.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">
          مفيش حجوزات لأطباء في الفرع ده في التاريخ المحدد.
        </p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {appointments.map(item => {
            const canArrive = item.Status === 'pending' || item.Status === 'confirmed';
            const canStart = item.Status === 'arrived' || item.Status === 'queued';
            const busy = workingId === item.BookingID;
            return (
              <div key={item.BookingID} className="flex items-center justify-between gap-3 rounded-2xl border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{item.PatientName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.StartTimeDisplay || 'بدون وقت'} • د. {item.PractitionerName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {labels[item.Status] || item.Status}
                    {item.EncounterId ? ' • الزيارة متسجلة' : ''}
                  </p>
                </div>
                <div className="shrink-0">
                  {item.EncounterId ? (
                    <Link
                      href={`/clinic/encounters/${item.EncounterId}`}
                      className="inline-flex items-center gap-1 rounded-xl bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800"
                    >
                      <Stethoscope className="h-4 w-4" /> افتح الكشف
                    </Link>
                  ) : canArrive ? (
                    <button
                      type="button"
                      disabled={workingId !== null}
                      onClick={() => void transition(item, 'arrive')}
                      className="inline-flex items-center gap-1 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" /> {busy ? 'جاري…' : 'تسجيل حضور'}
                    </button>
                  ) : canStart ? (
                    <button
                      type="button"
                      disabled={workingId !== null}
                      onClick={() => void transition(item, 'start')}
                      className="inline-flex items-center gap-1 rounded-xl bg-cyan-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      <Stethoscope className="h-4 w-4" /> {busy ? 'جاري…' : 'بدء الكشف'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">لا يوجد إجراء</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
