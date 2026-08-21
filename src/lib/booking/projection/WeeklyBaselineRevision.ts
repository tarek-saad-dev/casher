/**
 * Booking V2 B3 — revision board for weekly baseline invalidation.
 *
 * Bumping a scope raises the expected revision for matching Emp×Branch×DOW keys.
 * Stored projections with a lower revision are treated as stale and rebuilt.
 *
 * In-memory by default; DB adapter can mirror revision numbers on projection rows.
 * Not Redis. Not required for correctness — missing/stale → rebuild from SoT.
 */

import {
  parseWeeklyBaselineKey,
  weeklyBaselineKeyString,
  type WeeklyBaselineKey,
} from '@/lib/booking/domain/WeeklyBaseline';

export type WeeklyBaselineInvalidationReason =
  | 'weekly_schedule_changed'
  | 'branch_hours_changed'
  | 'employee_branch_assignment_changed'
  | 'manual_rebuild'
  | 'full_rebuild';

export type WeeklyBaselineInvalidationEvent = {
  reason: WeeklyBaselineInvalidationReason;
  employeeId?: number;
  branchId?: number;
  dayOfWeek?: number;
  atMs: number;
  revisionAfter: number;
};

export type WeeklyBaselineRevisionBoard = {
  /** Current expected revision for a concrete key (max of matching scopes). */
  currentRevision(key: WeeklyBaselineKey): number;
  /**
   * Invalidate affected baselines. Returns the new global revision watermark
   * and how many concrete key slots were touched in the board.
   */
  invalidate(args: {
    reason: WeeklyBaselineInvalidationReason;
    employeeId?: number;
    branchId?: number;
    dayOfWeek?: number;
    atMs?: number;
  }): { revision: number; event: WeeklyBaselineInvalidationEvent };
  /** Mark a concrete key at a known revision (after successful rebuild). */
  noteBuilt(key: WeeklyBaselineKey, revision: number): void;
  recentEvents(limit?: number): WeeklyBaselineInvalidationEvent[];
};

/**
 * Scope revisions:
 * - global watermark always increases
 * - optional finer keys: branch, emp+branch, emp+branch+dow
 * currentRevision(key) = max(global, branch, empBranch, exact)
 */
export function createWeeklyBaselineRevisionBoard(): WeeklyBaselineRevisionBoard {
  let global = 1;
  const byBranch = new Map<number, number>();
  const byEmpBranch = new Map<string, number>();
  const byExact = new Map<string, number>();
  const events: WeeklyBaselineInvalidationEvent[] = [];

  const empBranchKey = (empId: number, branchId: number) => `${empId}:${branchId}`;

  return {
    currentRevision(key) {
      const k = parseWeeklyBaselineKey(key);
      const exact = byExact.get(weeklyBaselineKeyString(k)) ?? 0;
      const eb = byEmpBranch.get(empBranchKey(k.employeeId, k.branchId)) ?? 0;
      const br = byBranch.get(k.branchId) ?? 0;
      return Math.max(global, br, eb, exact);
    },

    invalidate(args) {
      global += 1;
      const revision = global;
      let touched = 0;

      if (
        args.employeeId != null &&
        args.branchId != null &&
        args.dayOfWeek != null
      ) {
        const key = parseWeeklyBaselineKey({
          employeeId: args.employeeId,
          branchId: args.branchId,
          dayOfWeek: args.dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        });
        byExact.set(weeklyBaselineKeyString(key), revision);
        touched = 1;
      } else if (args.employeeId != null && args.branchId != null) {
        byEmpBranch.set(empBranchKey(args.employeeId, args.branchId), revision);
        touched = 7; // all DOWs conceptually
      } else if (args.branchId != null) {
        byBranch.set(args.branchId, revision);
        touched = -1; // all employees at branch
      }
      // else: global-only bump (full rebuild)

      const event: WeeklyBaselineInvalidationEvent = {
        reason: args.reason,
        employeeId: args.employeeId,
        branchId: args.branchId,
        dayOfWeek: args.dayOfWeek,
        atMs: args.atMs ?? Date.now(),
        revisionAfter: revision,
      };
      events.push(event);
      if (events.length > 200) events.shift();
      void touched;
      return { revision, event };
    },

    noteBuilt(key, revision) {
      const k = parseWeeklyBaselineKey(key);
      const id = weeklyBaselineKeyString(k);
      const cur = byExact.get(id) ?? 0;
      if (revision >= cur) byExact.set(id, revision);
    },

    recentEvents(limit = 20) {
      return events.slice(-limit);
    },
  };
}
