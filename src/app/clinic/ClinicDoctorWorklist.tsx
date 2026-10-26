'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, CalendarDays, CheckCircle2, ClipboardList,
  Clock3, RefreshCw, Search, Stethoscope, Users,
} from 'lucide-react';
import {
  filterReceptionAppointments, receptionBucket, receptionSummary,
  type ReceptionAppointment, type ReceptionBucket,
} from '@/apps/medical-records/application/receptionBoard';

type WorklistPayload = {
  practitionerEmpId: number;
  date: string;
  appointments: ReceptionAppointment[];
};

const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const labels: Record<string, string> = {
  pending: 'لم يصل بعد', confirmed: 'لم يصل بعد',
  arrived: 'وصل العيادة', queued: 'في الانتظار',
  in_service: 'الكشف جاري', completed: 'الكشف مكتمل',
  cancelled: 'ملغي', canceled: 'ملغي', no_show: 'لم يحضر',
  rescheduled: 'تم تغيير الموعد',
};
const filters: Array<{ key: ReceptionBucket; title: string }> = [
  { key: 'all', title: 'كل المواعيد' },
  { key: 'waiting', title: 'جاهزين للكشف' },
  { key: 'in_service', title: 'الكشف جاري' },
  { key: 'upcoming', title: 'لم يصلوا' },
  { key: 'completed', title: 'تم الكشف' },
];

export default function ClinicDoctorWorklist() {
  const router = useRouter();
  const [date, setDate] = useState(localDate);
  const [appointments, setAppointments] = useState<ReceptionAppointment[]>([]);
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<ReceptionBucket>('all');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clinic/my-day?date=${encodeURIComponent(date)}`, {
        cache: 'no-store', signal,
      });
      const payload = (await response.json()) as Partial<WorklistPayload> & { error?: string; code?: string };
      if (signal?.aborted) return;
      if (response.status === 403 && payload.code === 'CLINIC_DOCTOR_NOT_LINKED') {
        setLinked(false);
        setAppointments([]);
        setError(payload.error ?? 'حساب الدخول غير مربوط بطبيب.');
        return;
      }
      if (!response.ok || !Array.isArray(payload.appointments)) {
        throw new Error(payload.error || 'تعذر تحميل جدول مرضاي');
      }
      setLinked(true);
      setAppointments(payload.appointments);
      setError(null);
    } catch (err) {
      if (!signal?.aborted) {
        setAppointments([]);
        setError(err instanceof Error ? err.message : 'تعذر تحميل جدول مرضاي');
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
  const visible = useMemo(
    () => filterReceptionAppointments(appointments, { bucket, doctorId: 'all', search }),
    [appointments, bucket, search],
  );

  async function start(item: ReceptionAppointment) {
    if (busyId !== null) return;
    setBusyId(item.BookingID);
    setError(null);
    try {
      const response = await fetch(`/api/clinic/my-day/${item.BookingID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const payload = (await response.json()) as { encounterId?: string; error?: string };
      if (!response.ok || !payload.encounterId) {
        throw new Error(payload.error || 'تعذر بدء الكشف');
      }
      router.push(`/clinic/encounters/${payload.encounterId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر بدء الكشف';
      await load();
      setError(message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-slate-50 p-4 text-slate-950 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/clinic" className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-cyan-700">
              <ArrowRight className="h-4 w-4" /> تشغيل العيادة
            </Link>
            <div className="mt-3 flex items-center gap-2 text-sm font-bold text-cyan-700">
              <Stethoscope className="h-4 w-4" /> DRVO Clinics
            </div>
            <h1 className="mt-2 text-3xl font-black">جدول مرضاي</h1>
            <p className="mt-2 text-sm text-slate-500">
              مرضاك في الفرع الحالي، من الحجز مباشرة للكشف. تسجيل الحضور بيتم من الاستقبال.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="تاريخ جدول الدكتور"
              value={date}
              onChange={event => setDate(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              aria-label="تحديث جدول الدكتور"
              title="تحديث جدول الدكتور"
              disabled={loading}
              onClick={() => void load()}
              className="rounded-xl border border-slate-200 bg-white p-2 disabled:opacity-50"
            ><RefreshCw className="h-4 w-4" /></button>
          </div>
        </header>

        {error && <p role="alert" className="mt-5 rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}

        {!linked && !loading ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-8">
            <h2 className="text-lg font-black">حساب الطبيب مش جاهز لسه</h2>
            <p className="mt-2 max-w-xl text-sm leading-7 text-slate-500">
              اطلب من مدير العيادة ربط حساب دخولك بالطبيب من إدارة الأطباء.
              بعد الربط، جدول مرضاك هيظهر هنا تلقائيًا.
            </p>
            <Link href="/clinic" className="mt-4 inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white">الرجوع للاستقبال</Link>
          </div>
        ) : (
          <>
            <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="ملخص يوم الدكتور">
              {([
                { title: 'إجمالي المواعيد', value: summary.all, icon: CalendarDays },
                { title: 'جاهزين للكشف', value: summary.waiting, icon: Users },
                { title: 'داخل الكشف', value: summary.in_service, icon: Stethoscope },
                { title: 'كشوفات مكتملة', value: summary.completed, icon: CheckCircle2 },
              ] as const).map(item => (
                <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                    {item.title} <item.icon className="h-4 w-4" />
                  </div>
                  <div className="mt-3 text-3xl font-black tabular-nums">
                    {loading ? '—' : item.value}
                  </div>
                </div>
              ))}
            </section>

            <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-black">
                  <ClipboardList className="h-5 w-5 text-cyan-700" /> قائمة المرضى
                </h2>
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    aria-label="البحث في مرضاي"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="ابحث باسم المريض أو رقم الحجز"
                    className="min-w-[210px] rounded-xl border border-slate-200 py-2.5 pl-3 pr-10 text-sm"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="فلترة مرضاي">
                {filters.map(filter => (
                  <button
                    type="button"
                    key={filter.key}
                    aria-pressed={bucket === filter.key}
                    onClick={() => setBucket(filter.key)}
                    className={`rounded-full border px-3 py-2 text-xs font-bold ${bucket === filter.key
                      ? 'border-cyan-700 bg-cyan-50 text-cyan-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {filter.title}{!loading && filter.key !== 'all' ? ` (${summary[filter.key]})` : ''}
                  </button>
                ))}
              </div>

              {loading ? (
                <p role="status" className="mt-6 text-sm text-slate-500">جاري تحميل المرضى…</p>
              ) : !error && appointments.length === 0 ? (
                <p className="mt-5 rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                  مفيش حجوزات مسندة لحساب الطبيب في التاريخ والفرع المحددين.
                </p>
              ) : !error && visible.length === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-slate-200 p-7 text-center">
                  <p className="text-sm text-slate-500">مفيش نتائج مطابقة للفلاتر.</p>
                  <button
                    type="button"
                    onClick={() => { setBucket('all'); setSearch(''); }}
                    className="mt-2 text-xs font-bold text-cyan-800"
                  >عرض كل المواعيد</button>
                </div>
              ) : !error ? (
                <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                  {visible.map(item => {
                    const group = receptionBucket(item);
                    const ready = group === 'waiting' && !item.EncounterId;
                    const busy = busyId === item.BookingID;
                    return (
                      <div key={item.BookingID} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                        <div className="w-16 shrink-0 rounded-xl bg-slate-100 px-2 py-3 text-center">
                          <Clock3 className="mx-auto mb-1 h-4 w-4 text-slate-400" />
                          <span className="text-xs font-black tabular-nums">{item.StartTimeDisplay || '—'}</span>
                        </div>
                        <div className="min-w-[130px] flex-1">
                          <p className="truncate text-sm font-bold">{item.PatientName}</p>
                          <p className="mt-1 text-xs text-slate-500">حجز #{item.BookingID}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${group === 'waiting'
                          ? 'bg-amber-50 text-amber-800'
                          : group === 'in_service' ? 'bg-cyan-50 text-cyan-800'
                            : group === 'completed' ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'}`}>
                          {item.EncounterStatus === 'completed'
                            ? 'الكشف مكتمل'
                            : labels[item.Status] || item.Status}
                        </span>
                        <div className="mr-auto shrink-0">
                          {item.EncounterId ? (
                            <Link
                              href={`/clinic/encounters/${item.EncounterId}`}
                              className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-xs font-bold text-cyan-800"
                            >{group === 'completed' ? 'مراجعة الكشف' : 'فتح الكشف'}</Link>
                          ) : ready ? (
                            <button
                              type="button"
                              disabled={busyId !== null}
                              onClick={() => void start(item)}
                              className="rounded-xl bg-cyan-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                            >{busy ? 'جاري البدء…' : 'بدء الكشف'}</button>
                          ) : (
                            <span className="text-xs text-slate-400">
                              {group === 'upcoming' ? 'بانتظار الوصول' : 'لا يوجد إجراء'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {!loading && !error && appointments.length > 0 && (
                <p className="mt-3 text-xs text-slate-500">عرض {visible.length} من {appointments.length} موعد</p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
