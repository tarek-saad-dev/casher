'use client';

import { Clock, Users, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  nextAvailableBarber?: { name: string; time: string } | null;
  totalWaiting: number;
  totalBookings: number;
  className?: string;
}

export function BottomSummaryStrip({
  nextAvailableBarber,
  totalWaiting,
  totalBookings,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'shrink-0 rounded-2xl border border-border/80 bg-card/80 px-3 py-2.5 shadow-sm sm:px-4',
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-muted/40 px-3 py-1.5">
            <Clock className="size-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">التالي:</span>
            <span className="text-xs font-medium text-foreground">
              {nextAvailableBarber ? (
                <>
                  {nextAvailableBarber.name}
                  <span className="mx-1 text-primary">•</span>
                  {nextAvailableBarber.time}
                </>
              ) : (
                <span className="text-muted-foreground/60">—</span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-1.5">
            <Users className="size-3.5 text-warning" />
            <span className="text-xs font-bold text-warning">{totalWaiting}</span>
            <span className="text-xs text-muted-foreground">منتظر</span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-info/25 bg-info/10 px-3 py-1.5">
            <Calendar className="size-3.5 text-info" />
            <span className="text-xs font-bold text-info">{totalBookings}</span>
            <span className="text-xs text-muted-foreground">حجز</span>
          </div>
        </div>

        <div className="hidden items-center gap-3 text-[11px] md:flex">
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-sm bg-primary" />
            <span className="text-muted-foreground">خدمة</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-sm border border-primary bg-transparent" />
            <span className="text-muted-foreground">حجز</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-sm border border-muted-foreground/40 bg-surface-muted" />
            <span className="text-muted-foreground">دور</span>
          </div>
        </div>
      </div>
    </div>
  );
}
