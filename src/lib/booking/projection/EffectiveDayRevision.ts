/**
 * Booking V2 B4 — date-scoped revision board for Effective Day projections.
 * Invalidation touches Emp×Branch×BusinessDate only (no global public cache flush).
 */

import {
  effectiveDayKeyString,
  parseEffectiveDayKey,
  type EffectiveDayKey,
} from '@/lib/booking/domain/EffectiveDay';

export type EffectiveDayInvalidationReason =
  | 'late_start_changed'
  | 'early_leave_changed'
  | 'block_range_changed'
  | 'close_day_changed'
  | 'attendance_changed'
  | 'daily_adjustment_changed'
  | 'branch_exception_changed'
  | 'freelancer_changed'
  | 'assignment_day_changed'
  | 'weekly_baseline_changed'
  | 'manual_rebuild';

export type EffectiveDayInvalidationEvent = {
  reason: EffectiveDayInvalidationReason;
  employeeId?: number;
  branchId?: number;
  businessDate?: string;
  atMs: number;
  revisionAfter: number;
};

export type EffectiveDayRevisionBoard = {
  currentRevision(key: EffectiveDayKey): number;
  invalidate(args: {
    reason: EffectiveDayInvalidationReason;
    employeeId?: number;
    branchId?: number;
    businessDate?: string;
    atMs?: number;
  }): { revision: number; event: EffectiveDayInvalidationEvent };
  noteBuilt(key: EffectiveDayKey, revision: number): void;
  recentEvents(limit?: number): EffectiveDayInvalidationEvent[];
};

export function createEffectiveDayRevisionBoard(): EffectiveDayRevisionBoard {
  let global = 1;
  const byExact = new Map<string, number>();
  const byEmpBranch = new Map<string, number>();
  const byBranchDate = new Map<string, number>();
  const events: EffectiveDayInvalidationEvent[] = [];

  const eb = (empId: number, branchId: number) => `${empId}:${branchId}`;
  const bd = (branchId: number, date: string) => `${branchId}:${date}`;

  return {
    currentRevision(key) {
      const k = parseEffectiveDayKey(key);
      const date = String(k.businessDate);
      const exact = byExact.get(effectiveDayKeyString(k)) ?? 0;
      const empBr = byEmpBranch.get(eb(k.employeeId, k.branchId)) ?? 0;
      const brDate = byBranchDate.get(bd(k.branchId, date)) ?? 0;
      return Math.max(global, exact, empBr, brDate);
    },

    invalidate(args) {
      global += 1;
      const revision = global;

      if (
        args.employeeId != null &&
        args.branchId != null &&
        args.businessDate
      ) {
        const key = parseEffectiveDayKey({
          employeeId: args.employeeId,
          branchId: args.branchId,
          businessDate: args.businessDate,
        });
        byExact.set(effectiveDayKeyString(key), revision);
      } else if (args.employeeId != null && args.branchId != null) {
        byEmpBranch.set(eb(args.employeeId, args.branchId), revision);
      } else if (args.branchId != null && args.businessDate) {
        byBranchDate.set(bd(args.branchId, args.businessDate), revision);
      }

      const event: EffectiveDayInvalidationEvent = {
        reason: args.reason,
        employeeId: args.employeeId,
        branchId: args.branchId,
        businessDate: args.businessDate,
        atMs: args.atMs ?? Date.now(),
        revisionAfter: revision,
      };
      events.push(event);
      if (events.length > 300) events.shift();
      return { revision, event };
    },

    noteBuilt(key, revision) {
      const k = parseEffectiveDayKey(key);
      const id = effectiveDayKeyString(k);
      const cur = byExact.get(id) ?? 0;
      if (revision >= cur) byExact.set(id, revision);
    },

    recentEvents(limit = 20) {
      return events.slice(-limit);
    },
  };
}
