/**
 * Presentation helpers for daily-payroll closing center (Phase 3).
 * Does NOT compute readiness — only maps API codes to Arabic labels/styles.
 */

import type { EmpBranchWorkDayCloseState } from '@/lib/hr/empBranchWorkDayClose.types';
import type {
  DailyPayrollOpenDayItem,
  DailyPayrollReadinessBlockerCode,
  DailyPayrollReadinessEmployee,
  DailyPayrollReadinessResult,
} from '@/lib/hr/dailyPayrollReadiness.types';
import { READINESS_BLOCKER_LABELS } from '@/lib/hr/dailyPayrollReadiness.recommend';

export const EMPLOYEE_STATUS_LABELS = {
  ready: 'جاهز',
  missing_check_in: 'ناقص حضور',
  missing_check_out: 'ناقص انصراف',
  open_attendance_session: 'جلسة مفتوحة',
  payroll_not_generated: 'اليومية غير مولدة',
  target_not_generated: 'التارجت غير مولد',
  payroll_ledger_missing: 'مشكلة ledger',
  salary_config_missing: 'إعدادات الراتب ناقصة',
  needs_review: 'يحتاج مراجعة',
} as const;

export type EmployeeStatusKey = keyof typeof EMPLOYEE_STATUS_LABELS;

/** Map first readiness blocker → table الحالة label (display only). */
export function employeeStatusFromReadiness(
  emp: DailyPayrollReadinessEmployee | undefined,
): { key: EmployeeStatusKey; label: string } {
  if (!emp) return { key: 'needs_review', label: EMPLOYEE_STATUS_LABELS.needs_review };
  if (emp.ready && emp.blockers.length === 0) {
    return { key: 'ready', label: EMPLOYEE_STATUS_LABELS.ready };
  }
  const first = emp.blockers[0];
  switch (first) {
    case 'missing_check_in':
      return { key: 'missing_check_in', label: EMPLOYEE_STATUS_LABELS.missing_check_in };
    case 'missing_check_out':
      return { key: 'missing_check_out', label: EMPLOYEE_STATUS_LABELS.missing_check_out };
    case 'open_attendance_session':
      return { key: 'open_attendance_session', label: EMPLOYEE_STATUS_LABELS.open_attendance_session };
    case 'payroll_not_generated':
      return { key: 'payroll_not_generated', label: EMPLOYEE_STATUS_LABELS.payroll_not_generated };
    case 'target_not_generated':
      return { key: 'target_not_generated', label: EMPLOYEE_STATUS_LABELS.target_not_generated };
    case 'payroll_ledger_missing':
      return { key: 'payroll_ledger_missing', label: EMPLOYEE_STATUS_LABELS.payroll_ledger_missing };
    case 'salary_config_missing':
      return { key: 'salary_config_missing', label: EMPLOYEE_STATUS_LABELS.salary_config_missing };
    default:
      return { key: 'needs_review', label: EMPLOYEE_STATUS_LABELS.needs_review };
  }
}

export function employeeStatusTone(key: EmployeeStatusKey): string {
  if (key === 'ready') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (key === 'needs_review' || key === 'payroll_ledger_missing') {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }
  return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
}

export function recommendedStateTone(state: EmpBranchWorkDayCloseState): string {
  switch (state) {
    case 'READY_TO_CLOSE':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'NEEDS_REVIEW':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'CLOSED':
      return 'border-rose-500/50 bg-zinc-950 text-zinc-100 ring-1 ring-rose-500/30';
    case 'REOPENED':
      return 'border-amber-500/50 bg-amber-500/10 text-amber-100';
    default:
      return 'border-zinc-600/50 bg-zinc-900/50 text-zinc-400';
  }
}

export function recommendedStateLabelAr(state: EmpBranchWorkDayCloseState): string {
  switch (state) {
    case 'READY_TO_CLOSE':
      return 'جاهز للإقفال';
    case 'NEEDS_REVIEW':
      return 'يحتاج مراجعة';
    case 'CLOSED':
      return 'مقفل';
    case 'REOPENED':
      return 'مُعاد فتحه';
    default:
      return 'مفتوح';
  }
}

export function formatWorkDateAr(workDate: string): string {
  const [y, m, d] = workDate.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return workDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(dt);
  } catch {
    return workDate;
  }
}

export function shortBranchName(item: Pick<DailyPayrollOpenDayItem, 'branchCode' | 'branchName'>): string {
  if (item.branchCode === 'GLEEM') return 'جليم';
  if (item.branchCode === 'CAMP_CAESAR') return 'كامب شيزار';
  return item.branchName || item.branchCode;
}

export function openDayChipLabel(item: DailyPayrollOpenDayItem): string {
  const datePart = formatWorkDateAr(item.workDate);
  const branch = shortBranchName(item);
  if (item.readyToClose || item.recommendedState === 'READY_TO_CLOSE') {
    return `${datePart} · ${branch} · ✓ جاهز`;
  }
  if (item.blockerCount > 0 || item.recommendedState === 'NEEDS_REVIEW') {
    return `${datePart} · ${branch} · ⚠ ${item.blockerCount} مشاكل`;
  }
  return `${datePart} · ${branch} · مفتوح`;
}

export function openDayChipTone(item: DailyPayrollOpenDayItem): string {
  if (item.readyToClose || item.recommendedState === 'READY_TO_CLOSE') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  if (item.blockerCount > 0 || item.recommendedState === 'NEEDS_REVIEW') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
  return 'border-zinc-600/50 bg-zinc-900/60 text-zinc-300';
}

export function summarizeOpenDays(items: DailyPayrollOpenDayItem[]): {
  openCount: number;
  readyCount: number;
  reviewCount: number;
  oldest: DailyPayrollOpenDayItem | null;
} {
  let readyCount = 0;
  let reviewCount = 0;
  for (const i of items) {
    if (i.readyToClose || i.recommendedState === 'READY_TO_CLOSE') readyCount += 1;
    else if (i.blockerCount > 0 || i.recommendedState === 'NEEDS_REVIEW') reviewCount += 1;
  }
  return {
    openCount: items.length,
    readyCount,
    reviewCount,
    oldest: items[0] ?? null,
  };
}

export function workflowSteps(readiness: DailyPayrollReadinessResult | null): Array<{
  key: string;
  label: string;
  done: boolean;
  active: boolean;
}> {
  if (!readiness) {
    return [
      { key: 'att', label: 'الحضور', done: false, active: true },
      { key: 'pay', label: 'اليوميات', done: false, active: false },
      { key: 'tgt', label: 'التارجت', done: false, active: false },
      { key: 'rev', label: 'المراجعة', done: false, active: false },
      { key: 'cls', label: 'الإقفال', done: false, active: false },
    ];
  }
  const codes = new Set(readiness.blockers.map((b) => b.code));
  const attOk =
    !codes.has('missing_check_in') &&
    !codes.has('missing_check_out') &&
    !codes.has('open_attendance_session') &&
    !codes.has('invalid_work_hours');
  const payOk = !codes.has('payroll_not_generated') && !codes.has('payroll_ledger_missing');
  const tgtOk =
    !codes.has('target_not_generated') &&
    !codes.has('target_sync_pending') &&
    !codes.has('target_sync_failed');
  const reviewOk = readiness.summary.blockerCount === 0 && readiness.summary.hasActivity;
  const closed = readiness.persistedState === 'CLOSED';

  return [
    { key: 'att', label: 'الحضور', done: attOk, active: !attOk },
    { key: 'pay', label: 'اليوميات', done: payOk && attOk, active: attOk && !payOk },
    { key: 'tgt', label: 'التارجت', done: tgtOk && payOk && attOk, active: attOk && payOk && !tgtOk },
    {
      key: 'rev',
      label: 'المراجعة',
      done: reviewOk,
      active: attOk && payOk && tgtOk && !reviewOk,
    },
    { key: 'cls', label: 'الإقفال', done: closed, active: reviewOk && !closed },
  ];
}

export function blockerMessageAr(
  code: DailyPayrollReadinessBlockerCode,
  fallback?: string | null,
): string {
  return READINESS_BLOCKER_LABELS[code] ?? fallback ?? code;
}

export function selectionKey(branchId: number, workDate: string): string {
  return `${branchId}|${workDate}`;
}
