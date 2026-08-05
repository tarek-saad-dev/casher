'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  WORKFORCE_UI_STATUS_AR,
  type WorkforceUiStatusKey,
} from '@/lib/availability/workforceUiLabels';

const STATUS_CLASS: Record<WorkforceUiStatusKey, string> = {
  available: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  partially_available: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  day_closed: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
  absent: 'bg-rose-500/15 text-rose-100 border-rose-500/40',
  day_off: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
  no_schedule: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40',
  outside_hours: 'bg-orange-500/15 text-orange-200 border-orange-500/40',
  unavailable: 'bg-zinc-600/30 text-zinc-200 border-zinc-500/40',
  scheduled_elsewhere: 'bg-violet-500/15 text-violet-200 border-violet-500/40',
};

export function AvailabilityStatusBadge({
  statusKey,
  labelAr,
}: {
  statusKey: WorkforceUiStatusKey;
  labelAr?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', STATUS_CLASS[statusKey])}
      aria-label={`الحالة: ${labelAr ?? WORKFORCE_UI_STATUS_AR[statusKey]}`}
    >
      {labelAr ?? WORKFORCE_UI_STATUS_AR[statusKey]}
    </Badge>
  );
}
