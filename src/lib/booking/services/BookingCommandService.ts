/**
 * Booking V2 — BookingCommandService
 *
 * Command façade for future write paths. This phase only exposes **evaluate**
 * (read-only policy checks). It does NOT create/cancel bookings and does NOT
 * change legacy POST /api/bookings or public create contracts.
 *
 * When B3+ migrates writes, create/cancel will enter here while routes stay
 * thin adapters.
 */

import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import {
  BookingPolicy,
  type BookingPolicySettings,
  type PolicyEvaluationResult,
  type ServiceDurationPolicyInput,
} from '@/lib/booking/domain/BookingPolicy';
import type { BusinessDateString } from '@/lib/booking/domain/BusinessDate';
import { EffectiveWorkPlanService } from '@/lib/booking/services/EffectiveWorkPlanService';
import type { NormalizedBookingReadInputs } from '@/lib/booking/normalizedBookingReadInputs';

export type EvaluateBookingSlotCommand = {
  employeeId: number;
  branchId: number | null;
  businessDate: BusinessDateString | string;
  startTimeHhmm: string;
  /** Preferred absolute overnight flag (not legacy dayOffset). */
  calendarDayOffset?: 0 | 1;
  /** Legacy compatibility only. */
  dayOffset?: 0 | 1 | number | null;
  services: ServiceDurationPolicyInput[];
  inputs: EmployeeDayPlanBatchInputs;
  settings: BookingPolicySettings;
  nowMs?: number;
  busyInAnyBranch?: Array<{
    branchId: number | null;
    startAtMs: number;
    endAtMs: number;
  }>;
  systemDefaultMinutes?: number;
};

export const BookingCommandService = {
  /**
   * Read-only slot evaluation through BookingPolicy.
   * No persistence, no WhatsApp, no cache mutation.
   */
  evaluateSlot(command: EvaluateBookingSlotCommand): PolicyEvaluationResult {
    const duration = BookingPolicy.resolveServiceDurations({
      services: command.services,
      systemDefaultMinutes: command.systemDefaultMinutes,
    });

    return BookingPolicy.evaluateSlot({
      employeeId: command.employeeId,
      branchId: command.branchId,
      businessDate: command.businessDate,
      startTimeHhmm: command.startTimeHhmm,
      calendarDayOffset: command.calendarDayOffset,
      dayOffset: command.dayOffset,
      durationMinutes: duration.totalDurationMinutes,
      inputs: command.inputs,
      settings: command.settings,
      nowMs: command.nowMs,
      busyInAnyBranch: command.busyInAnyBranch,
    });
  },

  /**
   * Evaluate from shared normalized preload (future projection entry point).
   * Duration already resolved on the normalized inputs.
   */
  evaluateNormalizedSlot(args: {
    normalized: NormalizedBookingReadInputs;
    startTimeHhmm: string;
    calendarDayOffset?: 0 | 1;
    dayOffset?: 0 | 1 | number | null;
  }): PolicyEvaluationResult {
    return BookingPolicy.evaluateSlot({
      employeeId: args.normalized.employeeId,
      branchId: args.normalized.branchId,
      businessDate: args.normalized.businessDate,
      startTimeHhmm: args.startTimeHhmm,
      calendarDayOffset: args.calendarDayOffset,
      dayOffset: args.dayOffset,
      durationMinutes: args.normalized.durationMinutes,
      inputs: args.normalized.dayPlanInputs,
      settings: args.normalized.settings,
      nowMs: args.normalized.nowMs,
      busyInAnyBranch: args.normalized.busyInAnyBranch.map((b) => ({
        branchId: b.branchId,
        startAtMs: b.startAtMs,
        endAtMs: b.endAtMs,
      })),
    });
  },

  /** Expose work-plan resolve for callers that need plan-only (still no writes). */
  workPlan: EffectiveWorkPlanService,
};
