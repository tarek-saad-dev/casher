'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MaskedPortalBooking } from '@/lib/employee-portal/bookingPrivacy';
import BookingHandoffSheet from './booking-handoff-sheet';

type Props = {
  initialBookings: MaskedPortalBooking[];
  statusLabels: Record<string, string>;
};

function staffPhaseLabel(phase: MaskedPortalBooking['staffPhase']): string {
  if (phase === 'arrived') return 'العميل وصل';
  if (phase === 'in_service') return 'جارٍ تنفيذ الخدمة';
  if (phase === 'finished') return 'انتهت الخدمة';
  return 'لم يبدأ';
}

function handoffBadge(status: MaskedPortalBooking['handoffStatus']): string | null {
  if (status === 'pending') return 'جاهز للكاشير';
  if (status === 'charged') return 'اتحاسب';
  return null;
}

export default function TodayBookingsClient({ initialBookings, statusLabels }: Props) {
  const [bookings, setBookings] = useState(initialBookings);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<MaskedPortalBooking | null>(null);

  useEffect(() => {
    setBookings(initialBookings);
  }, [initialBookings]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/employee-portal/bookings/today', { cache: 'no-store' });
      if (!res.ok) throw new Error('refresh_failed');
      const data = (await res.json()) as { bookings?: MaskedPortalBooking[] };
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
      setError('');
    } catch {
      setError('تعذر تحديث القائمة');
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (bookings.length === 0) {
    return (
      <section className="rounded-3xl border border-white/10 bg-zinc-900/60 p-6 text-center">
        <p className="text-sm font-semibold text-zinc-200">لا توجد حجوزات اليوم</p>
        <p className="mt-1 text-xs text-zinc-500">ستظهر هنا الحجوزات الجديدة المعينة لك تلقائيًا</p>
        {error ? <p className="mt-3 text-xs text-rose-400">{error}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label="قائمة حجوزات اليوم" className="space-y-3">
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <ul className="space-y-2">
        {bookings.map((b) => {
          const statusKey = b.status.toLowerCase();
          const label = statusLabels[statusKey] ?? b.status;
          const muted = statusKey === 'cancelled' || statusKey === 'no_show';
          const badge = handoffBadge(b.handoffStatus);
          const openable = !muted;
          return (
            <li key={b.bookingId}>
              <button
                type="button"
                disabled={!openable}
                onClick={() => openable && setSelected(b)}
                className={`w-full rounded-2xl border px-4 py-3 text-right transition ${
                  muted
                    ? 'cursor-not-allowed border-white/5 bg-zinc-900/40 text-zinc-500'
                    : 'border-amber-500/15 bg-zinc-900/70 text-zinc-100 hover:border-amber-400/35'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-extrabold tracking-wide" dir="ltr">
                      {b.startTime}
                      {b.endTime ? (
                        <span className="text-sm font-semibold text-zinc-400"> – {b.endTime}</span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm font-bold text-amber-200">{b.firstName}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {b.serviceNames.length ? b.serviceNames.join(' · ') : 'خدمة'}
                      {b.branchName ? ` · ${b.branchName}` : ''}
                    </p>
                    <p className="mt-2 text-xs text-amber-300/90">{staffPhaseLabel(b.staffPhase)}</p>
                    {badge ? (
                      <p
                        className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          b.handoffStatus === 'charged'
                            ? 'bg-emerald-500/15 text-emerald-200'
                            : 'bg-amber-500/15 text-amber-200'
                        }`}
                      >
                        {badge}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold">
                    {label}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {selected ? (
        <BookingHandoffSheet
          booking={selected}
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
          onSent={() => void refresh()}
        />
      ) : null}
    </section>
  );
}
