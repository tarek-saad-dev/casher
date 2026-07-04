'use client';

import { Loader2 } from 'lucide-react';
import {
  formatMinutesDeltaLabel,
  formatTimeRange,
  getTimelineHeightPx,
  getTimelineTopPx,
} from './schedulerUtils';
import type { ActiveDragState } from './useBookingDragReschedule';
import { cn } from '@/lib/utils';

interface Props {
  drag: ActiveDragState;
}

const STATE_STYLES = {
  checking: {
    border: 'border-muted-foreground/40',
    bg: 'bg-card/80',
    label: 'جاري التحقق…',
    labelColor: 'text-muted-foreground',
  },
  available: {
    border: 'border-teal-500/70',
    bg: 'bg-teal-950/40',
    label: 'متاح',
    labelColor: 'text-teal-400',
  },
  conflict: {
    border: 'border-destructive/70',
    bg: 'bg-destructive/10',
    label: 'غير متاح',
    labelColor: 'text-destructive',
  },
  outside: {
    border: 'border-amber-500/70',
    bg: 'bg-amber-950/30',
    label: 'خارج وقت العمل',
    labelColor: 'text-amber-400',
  },
} as const;

export function BookingDragPreview({ drag }: Props) {
  const styles = STATE_STYLES[drag.previewState];
  const top = getTimelineTopPx(drag.proposedStartIso);
  const height = getTimelineHeightPx(
    drag.item.durationMinutes ?? 30,
  );

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-1.5 z-40 rounded-lg border-2 border-dashed px-2 py-1.5 shadow-lg backdrop-blur-sm transition-colors',
        styles.border,
        styles.bg,
      )}
      style={{ top, height, minHeight: 48 }}
      role="status"
      aria-live="polite"
      aria-label={`معاينة نقل الموعد ${drag.previewState}`}
    >
      <div className="flex h-full flex-col justify-between gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-[11px] font-semibold', styles.labelColor)}>
            {drag.previewState === 'checking' ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                {styles.label}
              </span>
            ) : (
              styles.label
            )}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatMinutesDeltaLabel(drag.deltaMinutes)}
          </span>
        </div>

        <div className="truncate text-[12px] font-bold text-foreground">
          {drag.item.customerName || drag.item.label}
        </div>

        <div className="text-[10px] text-muted-foreground">
          {formatTimeRange(drag.originalStartIso, drag.originalEndIso)}
          {' → '}
          {formatTimeRange(drag.proposedStartIso, drag.proposedEndIso)}
        </div>

        {drag.previewMessage && drag.previewState !== 'available' && (
          <div className="truncate text-[10px] text-destructive/90">{drag.previewMessage}</div>
        )}
      </div>
    </div>
  );
}
