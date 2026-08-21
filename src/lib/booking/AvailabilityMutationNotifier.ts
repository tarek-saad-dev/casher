/**
 * Booking V2 B8.6 — Central Availability Mutation Hooks.
 *
 * Single entry point for Hawai availability-affecting writes.
 * Prefer this over scattering HotAvailabilityInvalidation calls in routes.
 *
 * Transaction rule: wrap the mutation in `runWithPostCommit` so revision /
 * cache invalidation runs only after success. Rollback discards pending work.
 *
 * Occupancy (booking/hold/queue) is EmpID-global across branches.
 * Schedule / branch rules stay branch-scoped where applicable.
 */

import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getCairoBusinessDate, shiftCalendarDate } from '@/lib/businessDate';

function defaultHorizonDates(fromBusinessDate?: string, days = 14): string[] {
  const start = fromBusinessDate ?? getCairoBusinessDate();
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < days; i++) {
    out.push(cur);
    cur = shiftCalendarDate(cur, 1);
  }
  return out;
}

export type AvailabilityMutationReason = string;

export type EmployeeDayChangedArgs = {
  employeeId: number;
  businessDate: string;
  branchId?: number | null;
  reason?: AvailabilityMutationReason;
};

export type EmployeeWeeklyScheduleChangedArgs = {
  employeeId: number;
  branchId: number;
  businessDates?: string[];
  reason?: AvailabilityMutationReason;
};

export type EmployeeBranchAssignmentChangedArgs = {
  employeeId: number;
  branchId: number;
  /** Horizon to refresh (defaults to booking horizon from today). */
  businessDates?: string[];
  reason?: AvailabilityMutationReason;
};

export type BranchHoursChangedArgs = {
  branchId: number;
  businessDates?: string[];
  employeeIds?: number[];
  reason?: AvailabilityMutationReason;
};

export type BranchExceptionalHoursChangedArgs = BranchHoursChangedArgs;

export type OccupancyChangedArgs = {
  employeeId: number;
  businessDate: string;
  branchId?: number | null;
  reason?: AvailabilityMutationReason;
};

export type BookingOccupancyRescheduledArgs = {
  employeeId: number;
  oldBusinessDate: string;
  newBusinessDate: string;
  oldBranchId?: number | null;
  newBranchId?: number | null;
  oldEmployeeId?: number | null;
  reason?: AvailabilityMutationReason;
};

type PendingNotification =
  | { kind: 'employeeDayChanged'; args: EmployeeDayChangedArgs }
  | { kind: 'employeeWeeklyScheduleChanged'; args: EmployeeWeeklyScheduleChangedArgs }
  | { kind: 'employeeBranchAssignmentChanged'; args: EmployeeBranchAssignmentChangedArgs }
  | { kind: 'branchHoursChanged'; args: BranchHoursChangedArgs }
  | { kind: 'branchExceptionalHoursChanged'; args: BranchExceptionalHoursChangedArgs }
  | { kind: 'bookingOccupancyChanged'; args: OccupancyChangedArgs }
  | { kind: 'bookingOccupancyCancelled'; args: OccupancyChangedArgs }
  | { kind: 'bookingOccupancyRescheduled'; args: BookingOccupancyRescheduledArgs }
  | { kind: 'holdOccupancyChanged'; args: OccupancyChangedArgs }
  | { kind: 'queueOccupancyChanged'; args: OccupancyChangedArgs };

class MutationDeferral {
  private pending: PendingNotification[] = [];
  private discarded = false;

  enqueue(n: PendingNotification): void {
    if (this.discarded) return;
    this.pending.push(n);
  }

  discard(): void {
    this.discarded = true;
    this.pending = [];
  }

  async flush(): Promise<void> {
    if (this.discarded) return;
    const batch = this.pending;
    this.pending = [];
    for (const n of batch) {
      await applyNotification(n);
    }
  }

  /** Test / introspection */
  get size(): number {
    return this.pending.length;
  }

  get wasDiscarded(): boolean {
    return this.discarded;
  }
}

const deferralAls = new AsyncLocalStorage<MutationDeferral>();

/** @internal test helper */
export function __peekMutationDeferralPendingCount(): number {
  return deferralAls.getStore()?.size ?? 0;
}

async function applyNotification(n: PendingNotification): Promise<void> {
  const inv = await import('@/lib/booking/cache/HotAvailabilityInvalidation');
  switch (n.kind) {
    case 'employeeDayChanged':
      await inv.invalidateOnEffectiveDayChange({
        employeeId: n.args.employeeId,
        branchId: n.args.branchId ?? 0,
        businessDate: n.args.businessDate,
        reason: n.args.reason ?? 'employee_day_changed',
      });
      return;
    case 'employeeWeeklyScheduleChanged':
      await inv.invalidateOnWeeklyBaselineChange({
        employeeId: n.args.employeeId,
        branchId: n.args.branchId,
        businessDates: n.args.businessDates ?? defaultHorizonDates(),
        reason: n.args.reason ?? 'employee_weekly_schedule_changed',
      });
      return;
    case 'employeeBranchAssignmentChanged': {
      // Assignment affects bookability + weekly baseline at the branch.
      await inv.invalidateOnWeeklyBaselineChange({
        employeeId: n.args.employeeId,
        branchId: n.args.branchId,
        businessDates: n.args.businessDates ?? defaultHorizonDates(),
        reason: n.args.reason ?? 'employee_branch_assignment_changed',
      });
      return;
    }
    case 'branchHoursChanged':
    case 'branchExceptionalHoursChanged': {
      const dates = n.args.businessDates ?? defaultHorizonDates();
      let empIds = n.args.employeeIds ?? [];
      if (!empIds.length) {
        try {
          const { listBookableEmployeeIdsForBranch } = await import(
            '@/lib/branch/bookingQueueOwnership'
          );
          empIds = await listBookableEmployeeIdsForBranch(
            n.args.branchId,
            dates[0] ?? getCairoBusinessDate(),
            { publicOnly: false },
          );
        } catch {
          empIds = [];
        }
      }
      if (!empIds.length) return;
      await inv.invalidateOnBranchHoursChange({
        branchId: n.args.branchId,
        employeeIds: empIds,
        businessDates: dates,
        reason:
          n.args.reason ??
          (n.kind === 'branchExceptionalHoursChanged'
            ? 'branch_exceptional_hours_changed'
            : 'branch_hours_changed'),
      });
      return;
    }
    case 'bookingOccupancyChanged':
      await inv.invalidateOnBookingCreated({
        employeeId: n.args.employeeId,
        businessDate: n.args.businessDate,
        branchId: n.args.branchId,
        reason: n.args.reason ?? 'booking_occupancy_changed',
      });
      return;
    case 'bookingOccupancyCancelled':
      await inv.invalidateOnBookingCancelled({
        employeeId: n.args.employeeId,
        businessDate: n.args.businessDate,
        branchId: n.args.branchId,
        reason: n.args.reason ?? 'booking_occupancy_cancelled',
      });
      return;
    case 'bookingOccupancyRescheduled':
      await inv.invalidateOnBookingRescheduled({
        employeeId: n.args.employeeId,
        oldBusinessDate: n.args.oldBusinessDate,
        newBusinessDate: n.args.newBusinessDate,
        oldBranchId: n.args.oldBranchId,
        newBranchId: n.args.newBranchId,
        oldEmployeeId: n.args.oldEmployeeId,
      });
      return;
    case 'holdOccupancyChanged':
      await inv.invalidateOnHoldCreated({
        employeeId: n.args.employeeId,
        businessDate: n.args.businessDate,
        branchId: n.args.branchId,
        reason: n.args.reason ?? 'hold_occupancy_changed',
      });
      return;
    case 'queueOccupancyChanged':
      await inv.invalidateOnQueueChanged({
        employeeId: n.args.employeeId,
        businessDate: n.args.businessDate,
        branchId: n.args.branchId,
        reason: n.args.reason ?? 'queue_occupancy_changed',
      });
      return;
    default: {
      const _exhaustive: never = n;
      return _exhaustive;
    }
  }
}

async function publish(n: PendingNotification): Promise<void> {
  const deferral = deferralAls.getStore();
  if (deferral) {
    deferral.enqueue(n);
    return;
  }
  try {
    await applyNotification(n);
  } catch {
    /* never fail the write path */
  }
}

/**
 * Central notifier. All methods are best-effort (never throw into callers)
 * when applied immediately. Deferred notifications flush errors are also swallowed.
 */
export const AvailabilityMutationNotifier = {
  /**
   * Run a SoT mutation; queue notifications during the callback and flush
   * only after it resolves. On throw, discard — no revision/cache bump.
   */
  async runWithPostCommit<T>(fn: () => Promise<T>): Promise<T> {
    const deferral = new MutationDeferral();
    return deferralAls.run(deferral, async () => {
      try {
        const result = await fn();
        try {
          await deferral.flush();
        } catch {
          /* post-commit invalidate best-effort */
        }
        return result;
      } catch (err) {
        deferral.discard();
        throw err;
      }
    });
  },

  /** True when nested inside runWithPostCommit. */
  isDeferred(): boolean {
    return deferralAls.getStore() != null;
  },

  employeeDayChanged(args: EmployeeDayChangedArgs): Promise<void> {
    return publish({ kind: 'employeeDayChanged', args });
  },

  employeeWeeklyScheduleChanged(
    args: EmployeeWeeklyScheduleChangedArgs,
  ): Promise<void> {
    return publish({ kind: 'employeeWeeklyScheduleChanged', args });
  },

  employeeBranchAssignmentChanged(
    args: EmployeeBranchAssignmentChangedArgs,
  ): Promise<void> {
    return publish({ kind: 'employeeBranchAssignmentChanged', args });
  },

  branchHoursChanged(args: BranchHoursChangedArgs): Promise<void> {
    return publish({ kind: 'branchHoursChanged', args });
  },

  branchExceptionalHoursChanged(
    args: BranchExceptionalHoursChangedArgs,
  ): Promise<void> {
    return publish({ kind: 'branchExceptionalHoursChanged', args });
  },

  bookingOccupancyChanged(args: OccupancyChangedArgs): Promise<void> {
    return publish({ kind: 'bookingOccupancyChanged', args });
  },

  bookingOccupancyCancelled(args: OccupancyChangedArgs): Promise<void> {
    return publish({ kind: 'bookingOccupancyCancelled', args });
  },

  bookingOccupancyRescheduled(
    args: BookingOccupancyRescheduledArgs,
  ): Promise<void> {
    return publish({ kind: 'bookingOccupancyRescheduled', args });
  },

  holdOccupancyChanged(args: OccupancyChangedArgs): Promise<void> {
    return publish({ kind: 'holdOccupancyChanged', args });
  },

  queueOccupancyChanged(args: OccupancyChangedArgs): Promise<void> {
    return publish({ kind: 'queueOccupancyChanged', args });
  },
} as const;

export type AvailabilityMutationNotifierApi = typeof AvailabilityMutationNotifier;
