/**
 * Daily payroll readiness (Phase 2) — BranchID + WorkDate.
 * Read-only; does not mutate TblEmpBranchWorkDayClose.
 */

import type { EmpBranchWorkDayCloseState } from '@/lib/hr/empBranchWorkDayClose.types';

export const DAILY_PAYROLL_READINESS_BLOCKER_CODES = [
  'missing_check_in',
  'missing_check_out',
  'open_attendance_session',
  'invalid_work_hours',
  'payroll_not_generated',
  'target_not_generated',
  'payroll_ledger_missing',
  'target_sync_pending',
  'target_sync_failed',
  /** Hard-missing rate/plan from existing validate (no_hourly_rate / no_daily_rate / no_branch_payroll_plan / unsupported_payroll_method). */
  'salary_config_missing',
] as const;

export type DailyPayrollReadinessBlockerCode =
  (typeof DAILY_PAYROLL_READINESS_BLOCKER_CODES)[number];

export type DailyPayrollFixType =
  | 'attendance_modal'
  | 'payroll_settings'
  | 'generate_payroll'
  | 'generate_target'
  | 'retry_target_sync'
  | 'ledger_reconciliation'
  | 'open_page';

export interface DailyPayrollBlockerFix {
  type: DailyPayrollFixType;
  branchId: number;
  workDate: string;
  employeeId: number | null;
  /** Deep-link when inline modal is not available. */
  targetUrl?: string | null;
  labelAr: string;
}

export interface DailyPayrollReadinessBlocker {
  code: DailyPayrollReadinessBlockerCode;
  empId: number | null;
  empName: string | null;
  message: string;
  fix: DailyPayrollBlockerFix;
  /**
   * Deeper root blocker code when a fix attempt returned a known business cause
   * (from backend missing/reason/code — never invent).
   */
  rootCauseCode?: DailyPayrollReadinessBlockerCode | null;
  /** Nested root-cause blocker shown under this surface blocker in Smart Fix. */
  causedBy?: DailyPayrollReadinessBlocker | null;
}

/** Structured result from Smart Fix actions (inspect backend, do not invent causes). */
export interface SmartFixActionResult {
  ok: boolean;
  message: string;
  /** EmpBranchWorkDayClose / API business code when present. */
  code?: string | null;
  /** Generate validate missing[] — authoritative reasons from backend. */
  missing?: Array<{
    empId: number;
    empName: string;
    reason: string;
  }>;
}

export interface DailyPayrollReadinessWarning {
  code: string;
  empId: number | null;
  empName: string | null;
  message: string;
}

export interface DailyPayrollReadinessEmployee {
  empId: number;
  empName: string;
  ready: boolean;
  blockers: DailyPayrollReadinessBlockerCode[];
  hasAttendance: boolean;
  hasOpenSession: boolean;
  payrollGenerated: boolean;
  targetGenerated: boolean;
  payrollLedgerOk: boolean | null;
  targetSyncStatus: 'up_to_date' | 'pending' | 'processing' | 'failed' | 'none';
}

export interface DailyPayrollReadinessSummary {
  employeeCount: number;
  readyEmployeeCount: number;
  blockerCount: number;
  warningCount: number;
  payrollRowCount: number;
  targetRowCount: number;
  totalHours: number;
  totalWage: number;
  totalTargetAmount: number;
  hasActivity: boolean;
}

export interface DailyPayrollReadinessResult {
  branchId: number;
  branchCode: string;
  branchName: string;
  workDate: string;
  persistedState: EmpBranchWorkDayCloseState;
  isVirtualOpen: boolean;
  recommendedState: EmpBranchWorkDayCloseState;
  readyToClose: boolean;
  blockers: DailyPayrollReadinessBlocker[];
  warnings: DailyPayrollReadinessWarning[];
  employees: DailyPayrollReadinessEmployee[];
  summary: DailyPayrollReadinessSummary;
  /** Close/reopen audit from TblEmpBranchWorkDayClose (null when virtual OPEN). */
  closeAudit: {
    closedAt: string | null;
    closedByUserId: number | null;
    reopenedAt: string | null;
    reopenedByUserId: number | null;
    reopenReason: string | null;
  } | null;
  /** Wall-clock ms for this evaluation (diagnostics). */
  elapsedMs: number;
}

export interface DailyPayrollOpenDayItem {
  branchId: number;
  branchCode: string;
  branchName: string;
  workDate: string;
  persistedState: EmpBranchWorkDayCloseState;
  recommendedState: EmpBranchWorkDayCloseState;
  readyToClose: boolean;
  blockerCount: number;
  readyEmployeeCount: number;
  employeeCount: number;
  shortBlockerSummary: string;
}

export interface DailyPayrollOpenDaysResult {
  items: DailyPayrollOpenDayItem[];
  /** Legacy lookback window when fromWorkDate is not used. */
  lookbackDays: number;
  /** Inclusive lower bound actually applied (YYYY-MM-DD). */
  fromWorkDate: string | null;
  /** Inclusive upper bound actually applied (YYYY-MM-DD), if any. */
  toWorkDate: string | null;
  elapsedMs: number;
}
