'use client';

import { cn } from '@/lib/utils';
import { formatHhmmPreview } from '@/lib/availability/workforceUiLabels';

export type TimelineWindow = {
  start: string;
  end: string;
  endDayOffset?: 0 | 1;
  kind?: 'working' | 'added' | 'replaced' | 'blocked' | 'legacy';
  label?: string;
};

export type TimelineBlock = {
  startMs: number;
  endMs: number;
  reason?: string | null;
};

function hhmmToPct(hhmm: string, dayOffset: 0 | 1 = 0): number {
  const [h, m] = hhmm.split(':').map(Number);
  const mins = dayOffset * 24 * 60 + (h || 0) * 60 + (m || 0);
  // Operational axis: 0–48h compressed to 0–100 for overnight visibility
  return Math.max(0, Math.min(100, (mins / (48 * 60)) * 100));
}

function msToPct(ms: number, businessDate: string, timezone: string): number {
  const dayStart = new Date(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(`${businessDate}T12:00:00Z`)),
  );
  // Prefer Cairo ms via same formatter as chips — approximate using local parts
  void dayStart;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0);
  const bizDay = Number(businessDate.slice(8, 10));
  const dayOffset = day !== bizDay ? 1 : 0;
  return hhmmToPct(
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    dayOffset as 0 | 1,
  );
}

const KIND_CLASS: Record<NonNullable<TimelineWindow['kind']>, string> = {
  working: 'bg-emerald-500/50 border-emerald-400/60',
  added: 'bg-sky-500/50 border-sky-400/60',
  replaced: 'bg-violet-500/50 border-violet-400/60',
  blocked: 'bg-rose-500/55 border-rose-400/70',
  legacy: 'bg-amber-500/40 border-amber-400/60',
};

const KIND_LABEL: Record<NonNullable<TimelineWindow['kind']>, string> = {
  working: 'فترة عمل',
  added: 'فترة مضافة',
  replaced: 'فترة مستبدلة',
  blocked: 'محظور',
  legacy: 'تجاوز قديم',
};

/**
 * Read-only day timeline. No drag/resize/mutation.
 * Visualizes all windows even when booking runtime still uses primary window.
 */
export function AvailabilityDayTimeline({
  businessDate,
  timezone = 'Africa/Cairo',
  isCurrentBusinessDate,
  isClosedDay,
  windows,
  blockedIntervals,
  attendanceCheckIn,
  attendanceCheckOut,
  className,
}: {
  businessDate: string;
  timezone?: string;
  isCurrentBusinessDate: boolean;
  isClosedDay?: boolean;
  windows: TimelineWindow[];
  blockedIntervals: TimelineBlock[];
  attendanceCheckIn?: string | null;
  attendanceCheckOut?: string | null;
  className?: string;
}) {
  const nowPct =
    isCurrentBusinessDate
      ? msToPct(Date.now(), businessDate, timezone)
      : null;

  const textual = [
    ...windows.map(
      (w) =>
        `${KIND_LABEL[w.kind ?? 'working']}: ${formatHhmmPreview(w.start, w.end, w.endDayOffset === 1 ? 1 : 0)}`,
    ),
    ...blockedIntervals.map(
      (b) => `محظور: ${b.reason ?? 'فترة'}`,
    ),
  ];

  return (
    <div className={cn('space-y-2', className)} dir="rtl">
      <h3 className="text-sm font-medium text-zinc-200">الجدول الزمني لليوم</h3>
      {windows.length > 1 && (
        <p className="text-[11px] text-emerald-200/90" role="status">
          جميع فترات العمل المعروضة تُستخدم فعليًا في الحجز والطابور وإعادة الجدولة.
        </p>
      )}
      {isClosedDay && (
        <p className="text-xs text-rose-300" role="status">
          اليوم مغلق — لا توجد نوافذ عمل فعّالة.
        </p>
      )}

      <div
        className="relative h-14 rounded-lg border border-zinc-700 bg-zinc-900/80 overflow-hidden"
        role="img"
        aria-label={`خط زمني لتاريخ ${businessDate}: ${textual.join('؛ ') || 'فارغ'}`}
      >
        {/* hour ticks (0–24 on first day half of 48h axis) */}
        {[0, 6, 12, 18, 24].map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 border-s border-zinc-700/50"
            style={{ right: `${(h / 48) * 100}%` }}
          />
        ))}

        {windows.map((w, i) => {
          const start = hhmmToPct(w.start, 0);
          const end = hhmmToPct(w.end, w.endDayOffset === 1 ? 1 : 0);
          const left = Math.min(start, end);
          const width = Math.max(1, Math.abs(end - start));
          const kind = w.kind ?? 'working';
          return (
            <div
              key={`w-${i}`}
              title={`${KIND_LABEL[kind]} ${formatHhmmPreview(w.start, w.end, w.endDayOffset === 1 ? 1 : 0)}`}
              className={cn(
                'absolute top-2 bottom-2 rounded border text-[9px] text-white/90 flex items-center justify-center px-0.5 overflow-hidden',
                KIND_CLASS[kind],
              )}
              style={{ right: `${left}%`, width: `${width}%` }}
            >
              <span className="truncate">{KIND_LABEL[kind]}</span>
            </div>
          );
        })}

        {blockedIntervals.map((b, i) => {
          const start = msToPct(b.startMs, businessDate, timezone);
          const end = msToPct(b.endMs, businessDate, timezone);
          const left = Math.min(start, end);
          const width = Math.max(1, Math.abs(end - start));
          return (
            <div
              key={`b-${i}`}
              title={b.reason ?? 'محظور'}
              className={cn(
                'absolute top-1 bottom-1 rounded border opacity-90',
                KIND_CLASS.blocked,
              )}
              style={{
                right: `${left}%`,
                width: `${width}%`,
                backgroundImage:
                  'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(0,0,0,0.25) 3px, rgba(0,0,0,0.25) 6px)',
              }}
            />
          );
        })}

        {attendanceCheckIn && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-emerald-300"
            style={{ right: `${hhmmToPct(attendanceCheckIn)}%` }}
            title={`دخول ${attendanceCheckIn}`}
          />
        )}
        {attendanceCheckOut && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-orange-300"
            style={{ right: `${hhmmToPct(attendanceCheckOut)}%` }}
            title={`خروج ${attendanceCheckOut}`}
          />
        )}
        {nowPct != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white"
            style={{ right: `${nowPct}%` }}
            title="الوقت الحالي"
          />
        )}
      </div>

      <ul className="flex flex-wrap gap-2 text-[10px] text-zinc-400" aria-label="مفتاح الألوان">
        {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
          <li key={k} className="inline-flex items-center gap-1">
            <span className={cn('inline-block size-2.5 rounded-sm border', KIND_CLASS[k])} />
            {KIND_LABEL[k]}
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <span className="inline-block w-0.5 h-2.5 bg-white" /> الوقت الحالي
        </li>
        <li className="inline-flex items-center gap-1">
          <span className="inline-block w-0.5 h-2.5 bg-emerald-300" /> دخول
        </li>
      </ul>

      <div className="sr-only">
        {textual.length ? textual.join('. ') : 'لا توجد نوافذ على الخط الزمني'}
      </div>
    </div>
  );
}
