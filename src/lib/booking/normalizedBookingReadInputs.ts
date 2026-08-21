/**
 * Booking V2 B2.5 — normalized read inputs for Policy + future projections.
 * One shape for day-plan / duration / settings / busy so projections do not
 * re-derive rules from divergent loaders.
 *
 * Pure builders only — no Next.js, no writes.
 */

import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import type { BookingPolicySettings } from '@/lib/booking/domain/BookingPolicy';
import { BOOKING_TZ, parseBusinessDate } from '@/lib/booking/domain/BusinessDate';

export type NormalizedBusyInterval = {
  startAtMs: number;
  endAtMs: number;
  /** Branch that owns the busy row (informational). EmpID is global. */
  branchId: number | null;
  source?: 'booking' | 'queue' | 'hold' | 'other';
  label?: string;
};

export type NormalizedBookingReadInputs = {
  employeeId: number;
  branchId: number | null;
  businessDate: string;
  /** Shared day-plan preload (weekly, overrides, attendance, adjustments, freelance). */
  dayPlanInputs: EmployeeDayPlanBatchInputs;
  durationMinutes: number;
  settings: BookingPolicySettings;
  nowMs: number;
  /** Busy for this EmpID in ANY branch (global identity). */
  busyInAnyBranch: NormalizedBusyInterval[];
};

export function buildNormalizedBookingReadInputs(args: {
  employeeId: number;
  branchId: number | null;
  businessDate: string;
  dayPlanInputs: EmployeeDayPlanBatchInputs;
  durationMinutes: number;
  settings: BookingPolicySettings;
  nowMs?: number;
  busyInAnyBranch?: NormalizedBusyInterval[];
}): NormalizedBookingReadInputs {
  const businessDate = String(parseBusinessDate(args.businessDate));
  const timezone = args.settings.timeZone ?? args.dayPlanInputs.timezone ?? BOOKING_TZ;
  return {
    employeeId: args.employeeId,
    branchId: args.branchId,
    businessDate,
    dayPlanInputs: {
      ...args.dayPlanInputs,
      timezone,
    },
    durationMinutes: Math.round(args.durationMinutes),
    settings: {
      minNoticeMinutes: args.settings.minNoticeMinutes,
      maxBookingDaysAhead: args.settings.maxBookingDaysAhead,
      timeZone: timezone,
    },
    nowMs: args.nowMs ?? Date.now(),
    busyInAnyBranch: args.busyInAnyBranch ?? [],
  };
}
