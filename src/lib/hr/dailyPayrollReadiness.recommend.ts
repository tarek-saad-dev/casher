/**
 * Pure readiness classification / recommended-state (no DB I/O).
 */

import type { EmpBranchWorkDayCloseState } from '@/lib/hr/empBranchWorkDayClose.types';
import type { PayrollValidationReason } from '@/lib/payroll/dailyPayrollHrRules';
import type {
  DailyPayrollReadinessBlocker,
  DailyPayrollReadinessBlockerCode,
  DailyPayrollReadinessEmployee,
  DailyPayrollReadinessResult,
  DailyPayrollReadinessSummary,
  DailyPayrollReadinessWarning,
} from '@/lib/hr/dailyPayrollReadiness.types';
import { buildBlockerFix } from '@/lib/hr/dailyPayrollReadiness.fix';

export const READINESS_BLOCKER_LABELS: Record<DailyPayrollReadinessBlockerCode, string> = {
  missing_check_in: 'ناقص حضور (check-in)',
  missing_check_out: 'ناقص انصراف',
  open_attendance_session: 'جلسة حضور مفتوحة',
  invalid_work_hours: 'ساعات عمل غير صالحة',
  payroll_not_generated: 'اليوميات غير مولّدة',
  target_not_generated: 'التارجت غير مولّد',
  payroll_ledger_missing: 'قيد دفتر الأجر اليومي ناقص',
  target_sync_pending: 'مزامنة تارجت معلّقة',
  target_sync_failed: 'فشل مزامنة التارجت',
  salary_config_missing: 'إعدادات الراتب ناقصة للموظف',
};

/** Map existing payroll validation reasons → readiness blocker codes (hard only). */
export function mapValidationReasonToReadinessBlocker(
  reason: PayrollValidationReason,
): DailyPayrollReadinessBlockerCode | null {
  switch (reason) {
    case 'missing_checkin':
      return 'missing_check_in';
    case 'missing_checkout':
      return 'missing_check_out';
    case 'no_attendance':
      // Branch-scoped validate already skips cross-branch no_attendance.
      return 'missing_check_in';
    default:
      // no_hourly_rate / no_daily_rate / no_branch_payroll_plan → keep as warnings
      // schedule exclusions are not hard blockers.
      return null;
  }
}

export function validationReasonToWarningCode(
  reason: PayrollValidationReason,
): string | null {
  switch (reason) {
    case 'no_hourly_rate':
    case 'no_daily_rate':
    case 'no_branch_payroll_plan':
    case 'unsupported_payroll_method':
      return reason;
    case 'not_scheduled_working_day':
    case 'part_time_day_off':
    case 'monthly_excluded':
    case 'freelance_no_attendance':
    case 'inactive_employee':
    case 'payroll_disabled':
      return reason; // informational — never hard-block close alone
    default:
      return null;
  }
}

export interface ReadinessEmployeeFacts {
  empId: number;
  empName: string;
  hasAttendance: boolean;
  hasOpenSession: boolean;
  hasAnyCheckIn: boolean;
  netMinutes: number;
  /** Closed payable attendance ready for payroll generate. */
  expectsPayroll: boolean;
  payrollGenerated: boolean;
  payrollId: number | null;
  dailyWage: number;
  /** Has enabled target plan covering this branch/date. */
  expectsTarget: boolean;
  targetGenerated: boolean;
  targetId: number | null;
  targetAmount: number;
  payrollLedgerPresent: boolean | null; // null = not applicable
  targetSyncStatus: DailyPayrollReadinessEmployee['targetSyncStatus'];
  validationReason: PayrollValidationReason | null;
  validationIsHardMissing: boolean;
}

export function classifyEmployeeReadiness(
  facts: ReadinessEmployeeFacts,
): {
  blockers: DailyPayrollReadinessBlockerCode[];
  warnings: DailyPayrollReadinessWarning[];
} {
  const blockers: DailyPayrollReadinessBlockerCode[] = [];
  const warnings: DailyPayrollReadinessWarning[] = [];

  if (facts.hasOpenSession) {
    blockers.push('open_attendance_session');
  } else if (facts.validationIsHardMissing && facts.validationReason) {
    const mapped = mapValidationReasonToReadinessBlocker(facts.validationReason);
    if (mapped === 'missing_check_out' || mapped === 'missing_check_in') {
      blockers.push(mapped);
    } else if (mapped) {
      blockers.push(mapped);
    }
  }

  // Anomaly: closed session with check-in flag but negative/impossible minutes before clamp.
  if (
    facts.hasAnyCheckIn &&
    !facts.hasOpenSession &&
    facts.netMinutes < 0
  ) {
    blockers.push('invalid_work_hours');
  }

  const salaryConfigHardMissing =
    Boolean(facts.validationIsHardMissing) &&
    (facts.validationReason === 'no_hourly_rate' ||
      facts.validationReason === 'no_daily_rate' ||
      facts.validationReason === 'no_branch_payroll_plan' ||
      facts.validationReason === 'unsupported_payroll_method');

  // Rate / plan hard-missing from existing validate → dedicated actionable blocker
  if (salaryConfigHardMissing && facts.validationReason) {
    warnings.push({
      code: facts.validationReason,
      empId: facts.empId,
      empName: facts.empName,
      message: facts.validationReason,
    });
    if (facts.expectsPayroll || facts.hasAttendance) {
      blockers.push('salary_config_missing');
    }
  }

  if (
    facts.expectsPayroll &&
    !facts.payrollGenerated &&
    !facts.hasOpenSession &&
    !salaryConfigHardMissing
  ) {
    blockers.push('payroll_not_generated');
  }

  if (
    facts.expectsTarget &&
    facts.expectsPayroll &&
    !facts.hasOpenSession &&
    !facts.targetGenerated
  ) {
    blockers.push('target_not_generated');
  }

  if (facts.payrollLedgerPresent === false) {
    blockers.push('payroll_ledger_missing');
  }

  if (facts.targetSyncStatus === 'pending' || facts.targetSyncStatus === 'processing') {
    blockers.push('target_sync_pending');
  } else if (facts.targetSyncStatus === 'failed') {
    blockers.push('target_sync_failed');
  }

  if (facts.validationReason && !facts.validationIsHardMissing) {
    const code = validationReasonToWarningCode(facts.validationReason);
    if (code) {
      warnings.push({
        code,
        empId: facts.empId,
        empName: facts.empName,
        message: code,
      });
    }
  }

  return { blockers: [...new Set(blockers)], warnings };
}

export function recommendCloseState(args: {
  persistedState: EmpBranchWorkDayCloseState;
  blockerCount: number;
  hasActivity: boolean;
  allRequiredComplete: boolean;
}): EmpBranchWorkDayCloseState {
  if (args.persistedState === 'CLOSED') return 'CLOSED';
  // REOPENED stays visible via persistedState; recommended reflects current readiness.
  if (args.blockerCount > 0) return 'NEEDS_REVIEW';
  if (args.hasActivity && args.allRequiredComplete) return 'READY_TO_CLOSE';
  return 'OPEN';
}

export function buildReadinessFromFacts(args: {
  branchId: number;
  branchCode: string;
  branchName: string;
  workDate: string;
  persistedState: EmpBranchWorkDayCloseState;
  isVirtualOpen: boolean;
  closeAudit?: DailyPayrollReadinessResult['closeAudit'];
  facts: ReadinessEmployeeFacts[];
  payrollRowCount: number;
  targetRowCount: number;
  totalHours: number;
  totalWage: number;
  totalTargetAmount: number;
  elapsedMs: number;
}): DailyPayrollReadinessResult {
  const blockers: DailyPayrollReadinessBlocker[] = [];
  const warnings: DailyPayrollReadinessWarning[] = [];
  const employees: DailyPayrollReadinessEmployee[] = [];

  for (const f of args.facts) {
    const { blockers: codes, warnings: warns } = classifyEmployeeReadiness(f);
    warnings.push(...warns);
    for (const code of codes) {
      blockers.push({
        code,
        empId: f.empId,
        empName: f.empName,
        message: READINESS_BLOCKER_LABELS[code],
        fix: buildBlockerFix({
          code,
          branchId: args.branchId,
          workDate: args.workDate,
          empId: f.empId,
        }),
      });
    }
    employees.push({
      empId: f.empId,
      empName: f.empName,
      ready: codes.length === 0 && (f.expectsPayroll || f.hasAttendance || f.payrollGenerated),
      blockers: codes,
      hasAttendance: f.hasAttendance,
      hasOpenSession: f.hasOpenSession,
      payrollGenerated: f.payrollGenerated,
      targetGenerated: f.targetGenerated,
      payrollLedgerOk: f.payrollLedgerPresent,
      targetSyncStatus: f.targetSyncStatus,
    });
  }

  // Employees with activity who are ready: expectsPayroll path complete with no blockers
  const activeEmployees = employees.filter(
    (e) => e.hasAttendance || e.payrollGenerated || e.blockers.length > 0,
  );
  const readyEmployeeCount = activeEmployees.filter((e) => e.ready && e.blockers.length === 0).length;
  const hasActivity =
    args.payrollRowCount > 0 ||
    args.facts.some((f) => f.hasAttendance || f.expectsPayroll);

  const allRequiredComplete =
    hasActivity &&
    blockers.length === 0 &&
    args.facts
      .filter((f) => f.expectsPayroll)
      .every((f) => f.payrollGenerated && (!f.expectsTarget || f.targetGenerated));

  const recommendedState = recommendCloseState({
    persistedState: args.persistedState,
    blockerCount: blockers.length,
    hasActivity,
    allRequiredComplete,
  });

  // If REOPENED and ready, recommended is READY_TO_CLOSE (persisted stays REOPENED).
  // If REOPENED and blockers, recommended NEEDS_REVIEW.

  const summary: DailyPayrollReadinessSummary = {
    employeeCount: activeEmployees.length,
    readyEmployeeCount,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    payrollRowCount: args.payrollRowCount,
    targetRowCount: args.targetRowCount,
    totalHours: args.totalHours,
    totalWage: args.totalWage,
    totalTargetAmount: args.totalTargetAmount,
    hasActivity,
  };

  return {
    branchId: args.branchId,
    branchCode: args.branchCode,
    branchName: args.branchName,
    workDate: args.workDate,
    persistedState: args.persistedState,
    isVirtualOpen: args.isVirtualOpen,
    recommendedState,
    readyToClose: recommendedState === 'READY_TO_CLOSE',
    blockers,
    warnings,
    employees,
    summary,
    closeAudit: args.closeAudit ?? null,
    elapsedMs: args.elapsedMs,
  };
}

export function shortBlockerSummary(blockers: DailyPayrollReadinessBlocker[]): string {
  if (blockers.length === 0) return 'جاهز للإقفال';
  const counts = new Map<string, number>();
  for (const b of blockers) {
    counts.set(b.code, (counts.get(b.code) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .slice(0, 3)
    .map(([code, n]) => `${READINESS_BLOCKER_LABELS[code as DailyPayrollReadinessBlockerCode] ?? code}×${n}`);
  return parts.join(' · ');
}
