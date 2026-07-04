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
      className="sticky top-0 z-30 border-b border-primary/30 bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label={`نقل موعد ${session.customerName}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
            <Scissors className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">
              نقل موعد {session.customerName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {timeRange} · {session.durationMinutes} دقيقة · {serviceLabel}
            </p>
            <p className="text-[11px] text-primary/90">
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
            className="h-9 gap-1 text-xs"
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
