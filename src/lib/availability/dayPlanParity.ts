/**
 * Phase 1D — Read parity diagnostics (dev / explicit flag only).
 * Compares canonical day plan vs legacy flow-board windows vs integrity window.
 */

import type { EmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import { selectPrimaryEffectiveWindow } from '@/lib/availability/effectiveWindows';

export type ParityDifferenceCategory =
  | 'LEGACY_WEEKLY_DIVERGENCE'
  | 'BRANCH_SCOPE_DIVERGENCE'
  | 'OVERRIDE_DIVERGENCE'
  | 'OVERNIGHT_DIVERGENCE'
  | 'BUSINESS_DATE_DIVERGENCE';

export type LegacyDayStatusSnapshot = {
  isWorkingDay: boolean;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  scheduleSource?: string;
};

export type IntegrityWindowSnapshot = {
  isWorking: boolean;
  start: string | null;
  end: string | null;
  shiftStartMs?: number;
  shiftEndMs?: number;
};

function isParityDiagEnabled(): boolean {
  if (process.env.AVAILABILITY_PARITY_DIAG === '1') return true;
  if (process.env.AVAILABILITY_PARITY_DIAG === 'true') return true;
  return process.env.NODE_ENV === 'development';
}

function windowsEqual(
  aStart: string | null | undefined,
  aEnd: string | null | undefined,
  bStart: string | null | undefined,
  bEnd: string | null | undefined,
): boolean {
  return (aStart ?? null) === (bStart ?? null) && (aEnd ?? null) === (bEnd ?? null);
}

/**
 * Log a structured mismatch when canonical vs legacy/integrity windows diverge.
 * Sampling: always when AVAILABILITY_PARITY_DIAG=true; in development only on mismatch.
 */
export function logDayPlanParityMismatch(args: {
  empId: number;
  branchId: number | null;
  businessDate: string;
  canonical: EmployeeDayPlan;
  legacy?: LegacyDayStatusSnapshot | null;
  integrity?: IntegrityWindowSnapshot | null;
}): void {
  if (!isParityDiagEnabled()) return;

  const canonWin = selectPrimaryEffectiveWindow(args.canonical.effectiveWindows);
  const canonStart = args.canonical.isWorking ? (canonWin?.start ?? null) : null;
  const canonEnd = args.canonical.isWorking ? (canonWin?.end ?? null) : null;

  const categories: ParityDifferenceCategory[] = [];

  if (args.legacy) {
    const legacyWorking = args.legacy.isWorkingDay;
    if (legacyWorking !== args.canonical.isWorking) {
      categories.push('LEGACY_WEEKLY_DIVERGENCE');
    } else if (
      !windowsEqual(canonStart, canonEnd, args.legacy.effectiveStart, args.legacy.effectiveEnd)
    ) {
      if (args.canonical.isOvernight) categories.push('OVERNIGHT_DIVERGENCE');
      else if (
        args.legacy.scheduleSource === 'TblEmpWorkSchedule' &&
        args.canonical.baseScheduleSource === 'BRANCH_WEEKLY'
      ) {
        categories.push('BRANCH_SCOPE_DIVERGENCE');
      } else if (args.canonical.appliedOverrides.length) {
        categories.push('OVERRIDE_DIVERGENCE');
      } else {
        categories.push('LEGACY_WEEKLY_DIVERGENCE');
      }
    }
  }

  if (args.integrity) {
    if (args.integrity.isWorking !== args.canonical.isWorking) {
      categories.push('LEGACY_WEEKLY_DIVERGENCE');
    } else if (!windowsEqual(canonStart, canonEnd, args.integrity.start, args.integrity.end)) {
      if (args.canonical.isOvernight) categories.push('OVERNIGHT_DIVERGENCE');
      else categories.push('OVERRIDE_DIVERGENCE');
    }
  }

  if (!categories.length) return;

  console.warn(
    '[availability-parity]',
    JSON.stringify({
      event: 'day_plan_parity_mismatch',
      empId: args.empId,
      branchId: args.branchId,
      businessDate: args.businessDate,
      categories: [...new Set(categories)],
      canonicalWindows: args.canonical.effectiveWindows,
      legacyWindows: args.legacy
        ? { start: args.legacy.effectiveStart, end: args.legacy.effectiveEnd, working: args.legacy.isWorkingDay }
        : null,
      integrityWindows: args.integrity
        ? { start: args.integrity.start, end: args.integrity.end, working: args.integrity.isWorking }
        : null,
      overrideIds: args.canonical.appliedOverrides.map((o) => o.OverrideID),
      scheduleSource: args.canonical.baseScheduleSource,
      overnight: args.canonical.isOvernight,
    }),
  );
}
