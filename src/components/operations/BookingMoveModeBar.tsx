'use client';

import { Scissors, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BookingMoveSession } from '@/lib/bookingDragReschedule';
import { formatTimeRange } from './schedulerUtils';

interface Props {
  session: BookingMoveSession;
  onCancel: () => void;
  onReturnToOriginal?: () => void;
}

export function BookingMoveModeBar({ session, onCancel, onReturnToOriginal }: Props) {
  const timeRange = formatTimeRange(session.originalStartAt, session.originalEndAt);
  const serviceLabel = session.serviceNames?.[0] ?? session.originalEmpName;

  return (
    <div
      className="sticky top-0 z-30 border-b border-primary/30 bg-card/95 px-1.5 py-1 shadow-sm backdrop-blur-sm md:px-3 md:py-2.5"
      role="status"
      aria-live="polite"
      aria-label={`نقل موعد ${session.customerName}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 md:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 md:items-start md:gap-2">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary md:size-9 md:rounded-lg">
            <Scissors className="size-3 md:size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold text-foreground md:text-sm">
              نقل موعد {session.customerName}
            </p>
            <p className="hidden truncate text-xs text-muted-foreground md:block">
              {timeRange} · {session.durationMinutes} دقيقة · {serviceLabel}
            </p>
            <p className="hidden text-[11px] text-primary/90 md:block">
              اختر وقتًا متاحًا مع الصنايعي نفسه أو صنايعي آخر
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onReturnToOriginal && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden h-9 text-xs sm:inline-flex"
              onClick={onReturnToOriginal}
            >
              العودة للموعد الأصلي
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 gap-0.5 px-1.5 text-[10px] md:h-9 md:gap-1 md:text-xs"
            onClick={onCancel}
          >
            <X className="size-3.5" />
            إلغاء النقل
          </Button>
        </div>
      </div>
    </div>
  );
}
