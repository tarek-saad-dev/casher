/**
 * Canonical interval overlap model — [start, end) with end exclusive.
 * Safe for client and server (no DB imports).
 */

export const ACTIVE_BOOKING_BLOCK_STATUSES = [
  'confirmed',
  'arrived',
  'in_progress',
  'queued',
  'in_service',
] as const;

export function intervalsOverlap(
  newStart: Date,
  newEnd: Date,
  existingStart: Date,
  existingEnd: Date,
): boolean {
  return newStart < existingEnd && newEnd > existingStart;
}

export interface ScheduleInterval {
  id: number;
  source: 'queue' | 'booking';
  start: Date;
  end: Date;
  label?: string;
  ticketCode?: string;
}

export function findOverlappingIntervals(
  startAt: Date,
  endAt: Date,
  busy: ScheduleInterval[],
): ScheduleInterval[] {
  return busy.filter((iv) => intervalsOverlap(startAt, endAt, iv.start, iv.end));
}

export function findEarliestAvailableInterval(args: {
  busyIntervals: ScheduleInterval[];
  candidateStart: Date;
  durationMinutes: number;
  maxSearchHours?: number;
}): Date | null {
  const { busyIntervals, candidateStart, durationMinutes, maxSearchHours = 12 } = args;
  const durMs = durationMinutes * 60000;
  const maxLimit = new Date(candidateStart.getTime() + maxSearchHours * 3600 * 1000);
  let candidate = new Date(candidateStart);

  let iterations = 0;
  while (candidate < maxLimit && iterations < 500) {
    iterations++;
    const candidateEnd = new Date(candidate.getTime() + durMs);
    const overlap = busyIntervals.find((iv) =>
      intervalsOverlap(candidate, candidateEnd, iv.start, iv.end),
    );
    if (!overlap) return candidate;
    candidate = new Date(overlap.end);
  }
  return null;
}
