/**
 * Branch + WorkDate employee payroll closing state (Phase 1 foundation).
 * No row ⇒ OPEN. Independent of TblEmpDailyPayroll.Status and TblNewDay.
 */

export const EMP_BRANCH_WORKDAY_CLOSE_STATES = [
  'OPEN',
  'NEEDS_REVIEW',
  'READY_TO_CLOSE',
  'CLOSED',
  'REOPENED',
] as const;

export type EmpBranchWorkDayCloseState = (typeof EMP_BRANCH_WORKDAY_CLOSE_STATES)[number];

export interface EmpBranchWorkDayCloseRow {
  id: number;
  branchId: number;
  workDate: string;
  state: EmpBranchWorkDayCloseState;
  closedAt: string | null;
  closedByUserId: number | null;
  reopenedAt: string | null;
  reopenedByUserId: number | null;
  reopenReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: number | null;
  updatedByUserId: number | null;
}

/** Effective view: missing DB row is OPEN with null audit fields. */
export interface EmpBranchWorkDayCloseView {
  branchId: number;
  workDate: string;
  state: EmpBranchWorkDayCloseState;
  /** true when no DB row exists (virtual OPEN). */
  isVirtualOpen: boolean;
  row: EmpBranchWorkDayCloseRow | null;
}

export interface EmpBranchWorkDayCloseTransitionInput {
  branchId: number;
  workDate: string;
  toState: EmpBranchWorkDayCloseState;
  actorUserId: number;
  /** Required when toState === REOPENED */
  reopenReason?: string | null;
}

export class EmpBranchWorkDayCloseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmpBranchWorkDayCloseError';
    this.code = code;
  }
}
