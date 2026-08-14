/**
 * Pure transition rules for TblEmpBranchWorkDayClose (Phase 1).
 * No DB I/O — unit-testable without SQL.
 */

import {
  EMP_BRANCH_WORKDAY_CLOSE_STATES,
  EmpBranchWorkDayCloseError,
  type EmpBranchWorkDayCloseState,
} from '@/lib/hr/empBranchWorkDayClose.types';

const WORK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Allowed edges: from → set of to. Same-state is never allowed here. */
export const EMP_BRANCH_WORKDAY_CLOSE_TRANSITIONS: Record<
  EmpBranchWorkDayCloseState,
  ReadonlySet<EmpBranchWorkDayCloseState>
> = {
  OPEN: new Set(['NEEDS_REVIEW', 'READY_TO_CLOSE']),
  NEEDS_REVIEW: new Set(['OPEN', 'READY_TO_CLOSE']),
  READY_TO_CLOSE: new Set(['NEEDS_REVIEW', 'OPEN', 'CLOSED']),
  CLOSED: new Set(['REOPENED']),
  REOPENED: new Set(['NEEDS_REVIEW', 'READY_TO_CLOSE', 'OPEN']),
};

export function isEmpBranchWorkDayCloseState(
  value: string,
): value is EmpBranchWorkDayCloseState {
  return (EMP_BRANCH_WORKDAY_CLOSE_STATES as readonly string[]).includes(value);
}

export function validateWorkDateYmd(workDate: string): string | null {
  if (!WORK_DATE_RE.test(workDate)) {
    return 'WorkDate يجب أن يكون بصيغة YYYY-MM-DD';
  }
  const [y, m, d] = workDate.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return 'WorkDate غير صالح';
  }
  return null;
}

export function canTransitionEmpBranchWorkDayClose(
  from: EmpBranchWorkDayCloseState,
  to: EmpBranchWorkDayCloseState,
): boolean {
  if (from === to) return false;
  return EMP_BRANCH_WORKDAY_CLOSE_TRANSITIONS[from].has(to);
}

export interface TransitionAuditPatch {
  state: EmpBranchWorkDayCloseState;
  closedAt?: 'now' | 'keep' | 'clear';
  closedByUserId?: number | 'keep' | null;
  reopenedAt?: 'now' | 'keep' | 'clear';
  reopenedByUserId?: number | 'keep' | null;
  reopenReason?: string | 'keep' | null;
}

/**
 * Validate transition + build audit field patch.
 * CLOSED requires actorUserId; REOPENED requires non-empty reopenReason + actorUserId.
 */
export function planEmpBranchWorkDayCloseTransition(args: {
  from: EmpBranchWorkDayCloseState;
  to: EmpBranchWorkDayCloseState;
  actorUserId: number;
  reopenReason?: string | null;
}): TransitionAuditPatch {
  const { from, to, actorUserId } = args;

  if (!Number.isFinite(actorUserId) || actorUserId <= 0) {
    throw new EmpBranchWorkDayCloseError(
      'INVALID_ACTOR',
      'معرف المستخدم غير صالح',
    );
  }

  if (!canTransitionEmpBranchWorkDayClose(from, to)) {
    throw new EmpBranchWorkDayCloseError(
      'INVALID_TRANSITION',
      `انتقال غير مسموح: ${from} → ${to}`,
    );
  }

  if (to === 'CLOSED') {
    return {
      state: 'CLOSED',
      closedAt: 'now',
      closedByUserId: actorUserId,
      // Preserve last reopen metadata for history until next reopen overwrites.
      reopenedAt: 'keep',
      reopenedByUserId: 'keep',
      reopenReason: 'keep',
    };
  }

  if (to === 'REOPENED') {
    const reason = (args.reopenReason ?? '').trim();
    if (!reason) {
      throw new EmpBranchWorkDayCloseError(
        'REOPEN_REASON_REQUIRED',
        'سبب إعادة الفتح مطلوب',
      );
    }
    if (reason.length > 500) {
      throw new EmpBranchWorkDayCloseError(
        'REOPEN_REASON_TOO_LONG',
        'سبب إعادة الفتح أطول من 500 حرف',
      );
    }
    return {
      state: 'REOPENED',
      closedAt: 'keep',
      closedByUserId: 'keep',
      reopenedAt: 'now',
      reopenedByUserId: actorUserId,
      reopenReason: reason,
    };
  }

  // Non-terminal operational states — do not clear close/reopen audit.
  return {
    state: to,
    closedAt: 'keep',
    closedByUserId: 'keep',
    reopenedAt: 'keep',
    reopenedByUserId: 'keep',
    reopenReason: 'keep',
  };
}

/**
 * Close when readiness engine verified READY_TO_CLOSE.
 * Allows OPEN / NEEDS_REVIEW / READY_TO_CLOSE / REOPENED → CLOSED in one step
 * (readiness is the gate; persisted READY_TO_CLOSE is not required beforehand).
 */
export function planCloseWhenReadinessReady(args: {
  from: EmpBranchWorkDayCloseState;
  actorUserId: number;
  readinessVerified: boolean;
}): TransitionAuditPatch {
  if (!Number.isFinite(args.actorUserId) || args.actorUserId <= 0) {
    throw new EmpBranchWorkDayCloseError(
      'INVALID_ACTOR',
      'معرف المستخدم غير صالح',
    );
  }
  if (!args.readinessVerified) {
    throw new EmpBranchWorkDayCloseError(
      'NOT_READY_TO_CLOSE',
      'اليوم غير جاهز للإقفال',
    );
  }
  if (args.from === 'CLOSED') {
    throw new EmpBranchWorkDayCloseError(
      'PAYROLL_DAY_CLOSED',
      'يوم الموظفين مقفل بالفعل لهذا الفرع والتاريخ',
    );
  }
  return {
    state: 'CLOSED',
    closedAt: 'now',
    closedByUserId: args.actorUserId,
    reopenedAt: 'keep',
    reopenedByUserId: 'keep',
    reopenReason: 'keep',
  };
}

export const PAYROLL_DAY_CLOSED_CODE = 'PAYROLL_DAY_CLOSED' as const;
export const PAYROLL_DAY_CLOSED_MESSAGE =
  'يوم الموظفين مقفل لهذا الفرع والتاريخ — أعد فتح اليوم قبل التعديل';
