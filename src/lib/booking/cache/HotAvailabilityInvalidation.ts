/**
 * Booking V2 B8/B8.5 — date-scoped hot-cache invalidation.
 * Bumps SQL revision (cross-instance) + process board + drops L1/L2.
 * EmpID is global: occupancy invalidation clears ALL branch L1 entries for Emp×Date.
 */

import type { HotAvailabilityCache } from '@/lib/booking/cache/HotAvailabilityCache';
import { getHotAvailabilityCache } from '@/lib/booking/cache/HotAvailabilityCache';
import type { RevisionLayer } from '@/lib/booking/cache/AvailabilityRevisionSqlStore';

export type InvalidateBookingDayArgs = {
  employeeId: number;
  businessDate: string;
  branchId?: number | null;
  reason?: string;
};

function cacheOr(c?: HotAvailabilityCache): HotAvailabilityCache {
  return c ?? getHotAvailabilityCache();
}

async function bumpSql(
  employeeId: number,
  businessDate: string,
  layer: RevisionLayer,
): Promise<void> {
  try {
    const { getAvailabilityRevisionSqlStore } = await import(
      '@/lib/booking/cache/AvailabilityRevisionSqlStore'
    );
    const parts = await getAvailabilityRevisionSqlStore().bump({
      employeeId,
      businessDate,
      layer,
    });
    const cache = getHotAvailabilityCache();
    cache.revisionBoard.note({
      employeeId,
      businessDate,
      ...parts,
    });
    const { clearAvailabilityRevisionSoftMemo } = await import(
      '@/lib/booking/cache/WarmMatrixContextCache'
    );
    clearAvailabilityRevisionSoftMemo();
  } catch {
    /* SQL revision optional if migration not applied */
  }
}

/** Occupancy (booking/hold/queue): Emp global — invalidate all branch day entries. */
async function invalidateOccupancyEmpDate(
  args: InvalidateBookingDayArgs,
  layer: 'booking' | 'hold' | 'queue',
  cache?: HotAvailabilityCache,
): Promise<void> {
  const c = cacheOr(cache);
  const boardLayer =
    layer === 'booking'
      ? 'bumpBookingOccupancy'
      : layer === 'hold'
        ? 'bumpHoldOccupancy'
        : 'bumpQueueOccupancy';
  c.revisionBoard[boardLayer](args.employeeId, args.businessDate);
  await bumpSql(
    args.employeeId,
    args.businessDate,
    layer === 'booking' ? 'booking' : layer === 'hold' ? 'hold' : 'queue',
  );
  await c.invalidateEmployeeDays({
    employeeId: args.employeeId,
    businessDates: [args.businessDate],
    reason: args.reason ?? layer,
  });
}

export async function invalidateOnBookingCreated(
  args: InvalidateBookingDayArgs,
  cache?: HotAvailabilityCache,
): Promise<void> {
  await invalidateOccupancyEmpDate(
    { ...args, reason: args.reason ?? 'booking_created' },
    'booking',
    cache,
  );
}

export async function invalidateOnBookingCancelled(
  args: InvalidateBookingDayArgs,
  cache?: HotAvailabilityCache,
): Promise<void> {
  await invalidateOccupancyEmpDate(
    { ...args, reason: args.reason ?? 'booking_cancelled' },
    'booking',
    cache,
  );
}

export async function invalidateOnBookingRescheduled(
  args: {
    employeeId: number;
    oldBusinessDate: string;
    newBusinessDate: string;
    oldBranchId?: number | null;
    newBranchId?: number | null;
    oldEmployeeId?: number | null;
  },
  cache?: HotAvailabilityCache,
): Promise<void> {
  const c = cacheOr(cache);
  const oldEmp = args.oldEmployeeId ?? args.employeeId;
  await invalidateOnBookingCancelled(
    {
      employeeId: oldEmp,
      businessDate: args.oldBusinessDate,
      branchId: args.oldBranchId,
      reason: 'reschedule_old',
    },
    c,
  );
  await invalidateOnBookingCreated(
    {
      employeeId: args.employeeId,
      businessDate: args.newBusinessDate,
      branchId: args.newBranchId ?? args.oldBranchId,
      reason: 'reschedule_new',
    },
    c,
  );
}

export async function invalidateOnHoldCreated(
  args: InvalidateBookingDayArgs,
  cache?: HotAvailabilityCache,
): Promise<void> {
  await invalidateOccupancyEmpDate(
    { ...args, reason: args.reason ?? 'hold_created' },
    'hold',
    cache,
  );
}

export async function invalidateOnHoldReleasedOrExpired(
  args: InvalidateBookingDayArgs,
  cache?: HotAvailabilityCache,
): Promise<void> {
  await invalidateOccupancyEmpDate(
    { ...args, reason: args.reason ?? 'hold_released' },
    'hold',
    cache,
  );
}

export async function invalidateOnQueueChanged(
  args: InvalidateBookingDayArgs,
  cache?: HotAvailabilityCache,
): Promise<void> {
  await invalidateOccupancyEmpDate(
    { ...args, reason: args.reason ?? 'queue_changed' },
    'queue',
    cache,
  );
}

/** Effective day / attendance / overrides / close_day — branch-scoped L1 + Emp×Date revision. */
export async function invalidateOnEffectiveDayChange(
  args: {
    employeeId: number;
    branchId: number;
    businessDate: string;
    reason?: string;
  },
  cache?: HotAvailabilityCache,
): Promise<void> {
  const c = cacheOr(cache);
  c.revisionBoard.bumpEffectiveWork(args.employeeId, args.businessDate);
  await bumpSql(args.employeeId, args.businessDate, 'effectiveWork');
  // Emp×Date revision bump invalidates all branches; also explicit day drop.
  await c.invalidateEmployeeDays({
    employeeId: args.employeeId,
    businessDates: [args.businessDate],
    reason: args.reason ?? 'effective_day_change',
  });
}

export async function invalidateOnWeeklyBaselineChange(
  args: {
    employeeId: number;
    branchId: number;
    businessDates: string[];
    reason?: string;
  },
  cache?: HotAvailabilityCache,
): Promise<void> {
  const c = cacheOr(cache);
  for (const d of args.businessDates) {
    c.revisionBoard.bumpEffectiveWork(args.employeeId, d);
    await bumpSql(args.employeeId, d, 'effectiveWork');
  }
  await c.invalidateEmployeeDays({
    employeeId: args.employeeId,
    businessDates: args.businessDates,
    branchIds: [args.branchId],
    reason: args.reason ?? 'weekly_baseline_change',
  });
}

export async function invalidateOnBranchHoursChange(
  args: {
    branchId: number;
    employeeIds: number[];
    businessDates: string[];
    reason?: string;
  },
  cache?: HotAvailabilityCache,
): Promise<void> {
  const c = cacheOr(cache);
  for (const empId of args.employeeIds) {
    for (const d of args.businessDates) {
      c.revisionBoard.bumpEffectiveWork(empId, d);
      await bumpSql(empId, d, 'effectiveWork');
      await c.invalidateDay(
        {
          employeeId: empId,
          branchId: args.branchId,
          businessDate: d,
        },
        args.reason ?? 'branch_hours_change',
      );
    }
  }
}
