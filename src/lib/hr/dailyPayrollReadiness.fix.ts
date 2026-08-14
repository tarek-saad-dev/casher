/**
 * Pure mapping: readiness blocker → actionable fix descriptor (Phase 6).
 * Does not call APIs; frontend executes using existing flows.
 */

import type {
  DailyPayrollBlockerFix,
  DailyPayrollFixType,
  DailyPayrollReadinessBlocker,
  DailyPayrollReadinessBlockerCode,
} from '@/lib/hr/dailyPayrollReadiness.types';

export const FIX_TYPE_LABELS_AR: Record<DailyPayrollFixType, string> = {
  attendance_modal: 'تعديل الحضور',
  payroll_settings: 'ضبط إعدادات الراتب',
  generate_payroll: 'توليد اليوميات',
  generate_target: 'توليد التارجت',
  retry_target_sync: 'إعادة مزامنة التارجت',
  ledger_reconciliation: 'مراجعة الدفتر',
  open_page: 'فتح الصفحة',
};

function payrollSettingsUrl(empId: number, branchId: number): string {
  // branchId retained for fix descriptor context; agreement UI is global.
  void branchId;
  return `/admin/hr?tab=employees&empId=${empId}`;
}

function ledgerReconciliationUrl(workDate: string, branchId: number): string {
  return `/admin/hr?tab=employee-ledger-reconciliation&workDate=${encodeURIComponent(workDate)}&branchId=${branchId}`;
}

function attendancePageUrl(workDate: string, empId: number | null, branchId: number): string {
  const q = new URLSearchParams({
    tab: 'attendance',
    date: workDate,
    branchId: String(branchId),
  });
  if (empId != null) q.set('empId', String(empId));
  return `/admin/hr?${q.toString()}`;
}

export function fixTypeForBlockerCode(
  code: DailyPayrollReadinessBlockerCode,
): DailyPayrollFixType {
  switch (code) {
    case 'missing_check_in':
    case 'missing_check_out':
    case 'open_attendance_session':
    case 'invalid_work_hours':
      return 'attendance_modal';
    case 'salary_config_missing':
      return 'payroll_settings';
    case 'payroll_not_generated':
      return 'generate_payroll';
    case 'target_not_generated':
      return 'generate_target';
    case 'target_sync_pending':
    case 'target_sync_failed':
      return 'retry_target_sync';
    case 'payroll_ledger_missing':
      return 'ledger_reconciliation';
    default:
      return 'open_page';
  }
}

export function buildBlockerFix(args: {
  code: DailyPayrollReadinessBlockerCode;
  branchId: number;
  workDate: string;
  empId: number | null;
}): DailyPayrollBlockerFix {
  const type = fixTypeForBlockerCode(args.code);
  let targetUrl: string | null = null;

  if (type === 'payroll_settings' && args.empId != null) {
    targetUrl = payrollSettingsUrl(args.empId, args.branchId);
  } else if (type === 'ledger_reconciliation') {
    targetUrl = ledgerReconciliationUrl(args.workDate, args.branchId);
  } else if (type === 'attendance_modal') {
    // Fallback deep-link if inline modal unavailable
    targetUrl = attendancePageUrl(args.workDate, args.empId, args.branchId);
  } else if (type === 'open_page') {
    targetUrl = `/admin/hr?tab=daily-payroll&branchId=${args.branchId}&workDate=${args.workDate}`;
  }

  return {
    type,
    branchId: args.branchId,
    workDate: args.workDate,
    employeeId: args.empId,
    targetUrl,
    labelAr: FIX_TYPE_LABELS_AR[type],
  };
}

export function attachFixesToBlockers(
  blockers: Array<Omit<DailyPayrollReadinessBlocker, 'fix'> | DailyPayrollReadinessBlocker>,
  ctx: { branchId: number; workDate: string },
): DailyPayrollReadinessBlocker[] {
  return blockers.map((b) => ({
    ...b,
    fix: buildBlockerFix({
      code: b.code,
      branchId: ctx.branchId,
      workDate: ctx.workDate,
      empId: b.empId,
    }),
  }));
}
