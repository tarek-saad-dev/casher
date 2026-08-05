'use client';

import { cn } from '@/lib/utils';
import { formatHhmmPreview } from '@/lib/availability/workforceUiLabels';

export type TimeChipWindow = {
  start: string;
  end: string;
  endDayOffset?: 0 | 1;
};

export function AvailabilityTimeChips({
  windows,
  emptyLabel = '—',
  className,
}: {
  windows: TimeChipWindow[];
  emptyLabel?: string;
  className?: string;
}) {
  if (!windows.length) {
    return <span className="text-xs text-zinc-500">{emptyLabel}</span>;
  }
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {windows.map((w, i) => {
        const offset = w.endDayOffset === 1 ? 1 : 0;
        return (
          <span
            key={`${w.start}-${w.end}-${offset}-${i}`}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900/60 px-2 py-0.5 text-xs text-zinc-100"
          >
            {formatHhmmPreview(w.start, w.end, offset)}
            {offset === 1 && (
              <span className="text-[10px] text-amber-300" title="ينتهي في اليوم التالي">
                ليلة
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function msToHhmmChip(startMs: number, endMs: number, timezone = 'Africa/Cairo'): string {
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  return `${fmt(startMs)} ← ${fmt(endMs)}`;
}
