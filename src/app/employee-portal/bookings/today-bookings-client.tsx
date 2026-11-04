'use client';

import { useEffect, useState } from 'react';
import type { MaskedPortalBooking } from '@/lib/employee-portal/bookingPrivacy';

type Props = {
  initialBookings: MaskedPortalBooking[];
  statusLabels: Record<string, string>;
};

export default function TodayBookingsClient({ initialBookings, statusLabels }: Props) {
  const [bookings, setBookings] = useState(initialBookings);
  const [error, setError] = useState('');

  useEffect(() => {
    setBookings(initialBookings);
  }, [initialBookings]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch('/api/employee-portal/bookings/today', { cache: 'no-store' });
        if (!res.ok) throw new Error('refresh_failed');
        const data = (await res.json()) as { bookings?: MaskedPortalBooking[] };
        if (!cancelled) {
          setBookings(Array.isArray(data.bookings) ? data.bookings : []);
          setError('');
        }
      } catch {
        if (!cancelled) setError('تعذر تحديث القائمة');
      }
    };
    const id = window.setInterval(refresh, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

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
        {bookings.map((b, index) => {
          const statusKey = b.status.toLowerCase();
          const label = statusLabels[statusKey] ?? b.status;
          const muted = statusKey === 'cancelled' || statusKey === 'no_show';
          return (
            <li
              key={`${b.startTime}-${b.firstName}-${index}`}
              className={`rounded-2xl border px-4 py-3 ${
                muted
                  ? 'border-white/5 bg-zinc-900/40 text-zinc-500'
                  : 'border-amber-500/15 bg-zinc-900/70 text-zinc-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-extrabold tracking-wide" dir="ltr">
                    {b.startTime}
                    {b.endTime ? <span className="text-sm font-semibold text-zinc-400"> – {b.endTime}</span> : null}
                  </p>
                  <p className="mt-1 text-sm font-bold text-amber-200">{b.firstName}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {b.serviceNames.length ? b.serviceNames.join(' · ') : 'خدمة'}
                    {b.branchName ? ` · ${b.branchName}` : ''}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold">
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
