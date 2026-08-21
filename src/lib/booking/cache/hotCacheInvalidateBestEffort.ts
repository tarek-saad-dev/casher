/**
 * Best-effort hot-cache invalidation helpers (never throw into write paths).
 * B8.6 — delegates to AvailabilityMutationNotifier (post-commit aware).
 */

import { shiftCalendarDate, getCairoBusinessDate } from '@/lib/businessDate';

export function bookingHorizonDates(
  fromBusinessDate?: string,
  days = 14,
): string[] {
  const start = fromBusinessDate ?? getCairoBusinessDate();
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < days; i++) {
    out.push(cur);
    cur = shiftCalendarDate(cur, 1);
  }
  return out;
}

async function notifier() {
  const { AvailabilityMutationNotifier } = await import(
    '@/lib/booking/AvailabilityMutationNotifier'
  );
  return AvailabilityMutationNotifier;
}

export async function notifyHotEffectiveDay(args: {
  employeeId: number;
  businessDate: string;
  branchId?: number | null;
  reason?: string;
}): Promise<void> {
  try {
    await (await notifier()).employeeDayChanged(args);
  } catch {
    /* optional */
  }
}

export async function notifyHotWeeklyBaseline(args: {
  employeeId: number;
  branchId: number;
  businessDates?: string[];
  reason?: string;
}): Promise<void> {
  try {
    await (await notifier()).employeeWeeklyScheduleChanged(args);
  } catch {
    /* optional */
  }
}

export async function notifyHotQueueChanged(args: {
  employeeId: number;
  businessDate: string;
  branchId?: number | null;
  reason?: string;
}): Promise<void> {
  try {
    await (await notifier()).queueOccupancyChanged(args);
  } catch {
    /* optional */
  }
}

export async function notifyHotBranchHours(args: {
  branchId: number;
  businessDates?: string[];
  employeeIds?: number[];
  reason?: string;
}): Promise<void> {
  try {
    await (await notifier()).branchHoursChanged(args);
  } catch {
    /* optional */
  }
}
