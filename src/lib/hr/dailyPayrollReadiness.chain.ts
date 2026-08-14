/**
 * Phase 6B — recursive Smart Fix chain helpers (pure).
 * Maps real backend results → nested blockers. Never invents root causes.
 */

import { READINESS_BLOCKER_LABELS } from '@/lib/hr/dailyPayrollReadiness.recommend';
import { buildBlockerFix } from '@/lib/hr/dailyPayrollReadiness.fix';
import type {
  DailyPayrollReadinessBlocker,
  DailyPayrollReadinessBlockerCode,
  DailyPayrollReadinessResult,
  SmartFixActionResult,
} from '@/lib/hr/dailyPayrollReadiness.types';
import type { PayrollValidationReason } from '@/lib/payroll/dailyPayrollHrRules';

/** Backend validate reasons that map to salary_config_missing (evidenced ERROR_REASONS). */
const SALARY_CONFIG_REASONS = new Set<string>([
  'no_hourly_rate',
  'no_daily_rate',
  'no_branch_payroll_plan',
  'unsupported_payroll_method',
]);

/**
 * Map a generate/validate `missing[].reason` to a readiness blocker code.
 * Returns null when the reason is not a known actionable hard blocker.
 */
export function mapGenerateMissingReasonToBlockerCode(
  reason: string,
): DailyPayrollReadinessBlockerCode | null {
  if (SALARY_CONFIG_REASONS.has(reason)) return 'salary_config_missing';
  switch (reason as PayrollValidationReason) {
    case 'missing_checkin':
    case 'no_attendance':
      return 'missing_check_in';
    case 'missing_checkout':
      return 'missing_check_out';
    default:
      return null;
  }
}

export function buildBlockerFromCode(args: {
  code: DailyPayrollReadinessBlockerCode;
  branchId: number;
  workDate: string;
  empId: number | null;
  empName: string | null;
}): DailyPayrollReadinessBlocker {
  return {
    code: args.code,
    empId: args.empId,
    empName: args.empName,
    message: READINESS_BLOCKER_LABELS[args.code],
    fix: buildBlockerFix({
      code: args.code,
      branchId: args.branchId,
      workDate: args.workDate,
      empId: args.empId,
    }),
    rootCauseCode: null,
    causedBy: null,
  };
}

export function nestRootCause(
  parent: DailyPayrollReadinessBlocker,
  root: DailyPayrollReadinessBlocker,
): DailyPayrollReadinessBlocker {
  return {
    ...parent,
    rootCauseCode: root.code,
    causedBy: {
      ...root,
      rootCauseCode: null,
      causedBy: null,
    },
  };
}

/**
 * From generate 422 `missing[]`, build root blockers (backend reasons only).
 * Prefer employee matching `focusEmpId` when present.
 */
export function rootBlockersFromGenerateMissing(args: {
  missing: NonNullable<SmartFixActionResult['missing']>;
  branchId: number;
  workDate: string;
  focusEmpId?: number | null;
}): DailyPayrollReadinessBlocker[] {
  const ordered = [...args.missing];
  if (args.focusEmpId != null) {
    ordered.sort((a, b) => {
      const aMatch = a.empId === args.focusEmpId ? 0 : 1;
      const bMatch = b.empId === args.focusEmpId ? 0 : 1;
      return aMatch - bMatch;
    });
  }

  const out: DailyPayrollReadinessBlocker[] = [];
  const seen = new Set<string>();
  for (const row of ordered) {
    const code = mapGenerateMissingReasonToBlockerCode(row.reason);
    if (!code) continue;
    const key = `${code}:${row.empId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      buildBlockerFromCode({
        code,
        branchId: args.branchId,
        workDate: args.workDate,
        empId: row.empId,
        empName: row.empName,
      }),
    );
  }
  return out;
}

/** Attach first known root under parent; return updated parent + any siblings. */
export function applyDiscoveredRootsToParent(
  parent: DailyPayrollReadinessBlocker,
  roots: DailyPayrollReadinessBlocker[],
): { nested: DailyPayrollReadinessBlocker; extras: DailyPayrollReadinessBlocker[] } {
  if (roots.length === 0) {
    return { nested: parent, extras: [] };
  }
  const [primary, ...rest] = roots;
  return {
    nested: nestRootCause(parent, primary),
    extras: rest,
  };
}

export function resolutionAttemptKey(args: {
  branchId: number;
  workDate: string;
  empId: number | null;
  surfaceCode: DailyPayrollReadinessBlockerCode;
  actionType: string;
  rootCode?: DailyPayrollReadinessBlockerCode | null;
}): string {
  return [
    args.branchId,
    args.workDate,
    args.empId ?? '*',
    args.surfaceCode,
    args.actionType,
    args.rootCode ?? '-',
  ].join('|');
}

/**
 * Safe next auto-step after a successful sub-fix, based on refreshed readiness only.
 */
export function nextAutoContinueBlocker(
  readiness: DailyPayrollReadinessResult | null,
  opts: {
    preferEmpId?: number | null;
    /** Skip codes already attempted this session. */
    attemptedKeys: Set<string>;
  },
): DailyPayrollReadinessBlocker | null {
  if (!readiness || readiness.persistedState === 'CLOSED') return null;
  const blockers = readiness.blockers;
  if (blockers.length === 0) return null;

  const priority: DailyPayrollReadinessBlockerCode[] = [
    'missing_check_in',
    'missing_check_out',
    'open_attendance_session',
    'invalid_work_hours',
    'salary_config_missing',
    'payroll_not_generated',
    'target_not_generated',
    'target_sync_failed',
    'target_sync_pending',
    'payroll_ledger_missing',
  ];

  const sorted = [...blockers].sort((a, b) => {
    if (opts.preferEmpId != null) {
      const aEmp = a.empId === opts.preferEmpId ? 0 : 1;
      const bEmp = b.empId === opts.preferEmpId ? 0 : 1;
      if (aEmp !== bEmp) return aEmp - bEmp;
    }
    return priority.indexOf(a.code) - priority.indexOf(b.code);
  });

  for (const b of sorted) {
    // Only auto-continue inline safe steps (not external pages / attendance modal).
    if (
      b.fix.type !== 'generate_payroll' &&
      b.fix.type !== 'generate_target' &&
      b.fix.type !== 'retry_target_sync'
    ) {
      continue;
    }
    const key = resolutionAttemptKey({
      branchId: b.fix.branchId,
      workDate: b.fix.workDate,
      empId: b.empId,
      surfaceCode: b.code,
      actionType: b.fix.type,
    });
    if (opts.attemptedKeys.has(key)) continue;
    return b;
  }
  return null;
}

/**
 * If target fix is requested but readiness already has payroll_not_generated
 * for the same emp (or day), nest payroll as root — readiness authority.
 */
export function nestPayrollUnderTargetIfPresent(
  targetBlocker: DailyPayrollReadinessBlocker,
  readiness: DailyPayrollReadinessResult | null,
): DailyPayrollReadinessBlocker {
  if (!readiness) return targetBlocker;
  const payroll = readiness.blockers.find(
    (b) =>
      b.code === 'payroll_not_generated' &&
      (targetBlocker.empId == null || b.empId === targetBlocker.empId || b.empId == null),
  );
  if (!payroll) return targetBlocker;
  return nestRootCause(targetBlocker, payroll);
}

/** Merge readiness list with an updated nested parent (by code+empId). */
export function mergeDisplayBlockers(
  readinessBlockers: DailyPayrollReadinessBlocker[],
  override: DailyPayrollReadinessBlocker | null,
  extras: DailyPayrollReadinessBlocker[] = [],
): DailyPayrollReadinessBlocker[] {
  const list = readinessBlockers.map((b) => {
    if (
      override &&
      b.code === override.code &&
      b.empId === override.empId
    ) {
      return override;
    }
    return { ...b, causedBy: b.causedBy ?? null, rootCauseCode: b.rootCauseCode ?? null };
  });

  for (const extra of extras) {
    const exists = list.some((b) => b.code === extra.code && b.empId === extra.empId);
    if (!exists) list.push(extra);
  }
  return list;
}

export function isClosedImmutableCode(code: string | null | undefined): boolean {
  return code === 'PAYROLL_DAY_CLOSED';
}
