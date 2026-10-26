'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, CheckCircle2, ChevronLeft, Clock3, ClipboardList,
  RefreshCw, Search, Stethoscope, Users, XCircle,
} from 'lucide-react';
import {
  filterReceptionAppointments,
  receptionBucket,
  receptionSummary,
  type ReceptionAppointment,
  type ReceptionBucket,
} from '@/apps/medical-records/application/receptionBoard';

const statuses: Record<string, string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكد',
  arrived: 'وصل العيادة',
  queued: 'في الانتظار',
  in_service: 'الكشف جاري',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  canceled: 'ملغي',
  rescheduled: 'تم تغيير الموعد',
  no_show: 'لم يحضر',
};
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

const filters: Array<{ key: ReceptionBucket; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'upcoming', label: 'مواعيد قادمة' },
  { key: 'waiting', label: 'في الانتظار' },
  { key: 'in_service', label: 'داخل الكشف' },
  { key: 'completed', label: 'تم الكشف' },
  { key: 'exceptions', label: 'إلغاءات وغياب' },
];

export default function ClinicAppointmentsPanel() {
  const router = useRouter();
  const [date, setDate] = useState(localDate);
  const [appointments, setAppointments] = useState<ReceptionAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<ReceptionBucket>('all');
  const [doctorId, setDoctorId] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clinic/appointments?date=${encodeURIComponent(date)}`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('تعذر تحميل مواعيد العيادة');
      const data = (await response.json()) as { appointments?: ReceptionAppointment[] };
      if (!signal?.aborted) {
        setAppointments(Array.isArray(data.appointments) ? data.appointments : []);
        setError(null);
      }
    } catch {
      if (!signal?.aborted) {
        setAppointments([]);
        setError('تعذر تحميل المواعيد. حاول تحديث القائمة.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const summary = useMemo(() => receptionSummary(appointments), [appointments]);
  const doctors = useMemo(() => {
    const unique = new Map<number, string>();
    for (const item of appointments) unique.set(item.PractitionerEmpID, item.PractitionerName);
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
  }, [appointments]);
  const filtered = useMemo(
    () => filterReceptionAppointments(appointments, { bucket, doctorId, search }),
    [appointments, bucket, doctorId, search],
  );

  async function transition(item: ReceptionAppointment, action: 'arrive' | 'start') {
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
        return;
      }
      await load();
    } catch (err) {
      const actionError = err instanceof Error ? err.message : 'تعذر تحديث الحجز';
      await load();
      setError(actionError);
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <section aria-label="استقبال العيادة" className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          { label: 'مواعيد اليوم', count: summary.all, icon: CalendarDays },
          { label: 'في الانتظار', count: summary.waiting, icon: Users },
          { label: 'داخل الكشف', count: summary.in_service, icon: Stethoscope },
          { label: 'تم الكشف', count: summary.completed, icon: CheckCircle2 },
        ] as const).map(metric => (
          <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 text-slate-500">
              <span className="text-xs font-semibold">{metric.label}</span>
              <metric.icon className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 text-3xl font-black tabular-nums text-slate-900">
              {loading ? '—' : metric.count}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black">
              <ClipboardList className="h-5 w-5 text-cyan-700" />
              قائمة المرضى والمواعيد
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              من نظام Booking المشترك مباشرة — بدون تسجيل نفس الحجز مرتين.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label="تاريخ مواعيد العيادة"
              type="date"
              value={date}
              onChange={event => { setDate(event.target.value); setDoctorId('all'); }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              aria-label="تحديث المواعيد"
              title="تحديث المواعيد"
              disabled={loading}
              onClick={() => void load()}
              className="rounded-xl border border-slate-200 p-2 disabled:opacity-40"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="فلترة حالة المريض">
          {filters.map(filter => (
            <button
              key={filter.key}
              type="button"
              aria-pressed={bucket === filter.key}
              onClick={() => setBucket(filter.key)}
              className={`rounded-full border px-3 py-2 text-xs font-bold transition-colors ${bucket === filter.key
                ? 'border-cyan-700 bg-cyan-50 text-cyan-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {filter.label}
              {!loading && filter.key !== 'all' ? ` (${summary[filter.key]})` : ''}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,230px)]">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
            <input
              aria-label="بحث في مواعيد العيادة"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="ابحث باسم المريض أو الطبيب أو رقم الحجز"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-3 pr-10 text-sm"
            />
          </div>
          <select
            aria-label="فلترة حسب الطبيب"
            value={doctorId}
            onChange={event => setDoctorId(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">كل الأطباء</option>
            {doctors.map(([id, name]) => (
              <option key={id} value={id}>د. {name}</option>
            ))}
          </select>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        {loading ? (
          <p className="mt-6 text-sm text-slate-500" role="status">جاري تحميل مواعيد العيادة…</p>
        ) : !error && appointments.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
            <CalendarDays className="mx-auto mb-2 h-5 w-5 text-slate-400" />
            <p className="text-sm font-semibold text-slate-700">مفيش حجوزات لأطباء في التاريخ ده.</p>
            <Link href="/bookings" className="mt-2 inline-block text-sm font-bold text-cyan-700">فتح نظام الحجز</Link>
          </div>
        ) : !error && filtered.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
            <p className="text-sm text-slate-500">مفيش نتائج مطابقة للفلاتر.</p>
            <button
              type="button"
              className="mt-2 text-sm font-bold text-cyan-700"
              onClick={() => { setBucket('all'); setDoctorId('all'); setSearch(''); }}
            >عرض كل المواعيد</button>
          </div>
        ) : !error ? (
          <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
            {filtered.map(item => {
              const state = receptionBucket(item);
              const canArrive = state === 'upcoming' && !item.EncounterId;
              const canStart = state === 'waiting' && !item.EncounterId;
              const busy = workingId === item.BookingID;
              return (
                <div key={item.BookingID} className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 hover:bg-slate-50 sm:flex-nowrap">
                  <div className="w-16 shrink-0 rounded-lg bg-slate-100 py-2 text-center text-xs font-black tabular-nums text-slate-800">
                    <Clock3 className="mx-auto mb-1 h-3.5 w-3.5 text-slate-500" />
                    {item.StartTimeDisplay || '—'}
                  </div>
                  <div className="min-w-[140px] flex-1">
                    <p className="truncate text-sm font-bold">{item.PatientName}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      د. {item.PractitionerName} · حجز #{item.BookingID}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${state === 'waiting'
                    ? 'bg-amber-50 text-amber-800'
                    : state === 'in_service' ? 'bg-cyan-50 text-cyan-800'
                    : state === 'completed' ? 'bg-emerald-50 text-emerald-800'
                    : state === 'exceptions' ? 'bg-rose-50 text-rose-700'
                    : 'bg-slate-100 text-slate-600'}`}>
                    {item.EncounterStatus === 'completed' ? 'الكشف مكتمل' : statuses[item.Status] || item.Status}
                  </span>
                  <div className="mr-auto flex shrink-0 justify-end">
                    {item.EncounterId ? (
                      <Link
                        href={`/clinic/encounters/${item.EncounterId}`}
                        className="inline-flex items-center gap-1 rounded-xl bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800"
                      ><Stethoscope className="h-4 w-4" /> عرض الكشف <ChevronLeft className="h-3 w-3" /></Link>
                    ) : canArrive ? (
                      <button
                        type="button"
                        disabled={workingId !== null}
                        onClick={() => void transition(item, 'arrive')}
                        className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                      ><CheckCircle2 className="h-4 w-4" /> {busy ? 'جاري…' : 'تسجيل حضور'}</button>
                    ) : canStart ? (
                      <button
                        type="button"
                        disabled={workingId !== null}
                        onClick={() => void transition(item, 'start')}
                        className="inline-flex items-center gap-1 rounded-xl bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                      ><Stethoscope className="h-4 w-4" /> {busy ? 'جاري…' : 'بدء الكشف'}</button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                        <XCircle className="h-3.5 w-3.5" /> لا يوجد إجراء
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {!loading && !error && appointments.length > 0 && (
          <p className="mt-3 text-xs text-slate-500" aria-live="polite">
            عرض {filtered.length} من {appointments.length} حجز
          </p>
        )}
      </div>
    </section>
  );
}
