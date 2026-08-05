'use client';

import type { AvailabilityLayerSnapshot } from '@/lib/availability/buildAvailabilityLayers';

function formatWins(
  windows: AvailabilityLayerSnapshot['beforeWindows'],
  role: 'before' | 'after',
): string {
  if (!windows.length) {
    // Empty "before" is normal at the start of the chain — not "unavailable".
    return role === 'before' ? '—' : 'غير متاح / لا فترات';
  }
  return windows
    .map((w) =>
      w.endDayOffset === 1 ? `${w.start}–${w.end}+1` : `${w.start}–${w.end}`,
    )
    .join(' · ');
}

function hasMeaningfulSnapshot(snapshot: AvailabilityLayerSnapshot): boolean {
  return (
    snapshot.beforeWindows.length > 0 ||
    snapshot.afterWindows.length > 0 ||
    snapshot.beforeBlockedIntervals.length > 0 ||
    snapshot.afterBlockedIntervals.length > 0 ||
    !!snapshot.effectCode
  );
}

function formatEffectCode(code: string | null | undefined): string {
  if (!code) return '—';
  const AR: Record<string, string> = {
    BASE_WINDOWS: 'فتح نوافذ من الجدول الأساسي',
    NO_BASE: 'لا يوجد أساس نوافذ',
    WEEKLY_DAY_OFF: 'إجازة حسب الجدول الأسبوعي',
    SCHEDULED_ELSEWHERE: 'مجدول على فرع آخر',
    EMPLOYEE_ABSENT: 'غياب',
    AVAILABLE: 'متاح',
    UNAVAILABLE: 'غير متاح',
  };
  return AR[code] ?? code;
}

export function AvailabilityLayerEffect({
  snapshot,
  effectAr,
}: {
  snapshot?: AvailabilityLayerSnapshot | null;
  effectAr?: string | null;
}) {
  const showSnapshot = !!snapshot && hasMeaningfulSnapshot(snapshot);
  if (!showSnapshot && !effectAr) return null;

  return (
    <div className="mt-2 rounded border border-zinc-800/80 bg-zinc-950/60 px-2 py-1.5 text-[11px] space-y-1">
      {showSnapshot && snapshot && (
        <>
          <div className="flex gap-2 text-zinc-500">
            <span className="shrink-0">قبل:</span>
            <span className="text-zinc-300">
              {formatWins(snapshot.beforeWindows, 'before')}
            </span>
          </div>
          <div className="flex gap-2 text-zinc-500">
            <span className="shrink-0">تأثير:</span>
            <span className="text-amber-200/90">
              {effectAr || formatEffectCode(snapshot.effectCode)}
            </span>
          </div>
          <div className="flex gap-2 text-zinc-500">
            <span className="shrink-0">بعد:</span>
            <span className="text-zinc-200">
              {formatWins(snapshot.afterWindows, 'after')}
            </span>
          </div>
        </>
      )}
      {!showSnapshot && effectAr && (
        <p className="text-zinc-300 whitespace-pre-line">{effectAr}</p>
      )}
    </div>
  );
}
