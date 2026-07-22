import 'server-only';
import { NextResponse } from 'next/server';
import {
  isActiveBranchContext,
  requireActiveBranchContext,
  requireBranchOperationAccess,
} from './context';
import { BranchDomainError, type ActiveBranchContext } from './types';
import { getOpenBusinessDay, type BusinessDayRecord } from './businessDay';
import {
  getUserOpenShift,
  getUserOpenShiftForBranch,
  type ShiftMoveRecord,
} from './shiftSession';

export function branchErrorResponse(err: unknown): NextResponse | null {
  if (
    err instanceof BranchDomainError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: string }).name === 'BranchDomainError')
  ) {
    const e = err as BranchDomainError & { openShifts?: unknown[] };
    return NextResponse.json(
      {
        error: e.message,
        code: e.code,
        ...(e.openShifts ? { openShifts: e.openShifts } : {}),
      },
      { status: e.status || 403 },
    );
  }
  return null;
}

export async function requireBranchOperatorContext(): Promise<
  ActiveBranchContext | NextResponse
> {
  return requireBranchOperationAccess();
}

/**
 * Resolve open business day + optional user open shift for financial writes.
 * Day/shift are branch-aware; financial rows remain unscoped until Phase 1D.
 */
export async function resolveBranchDayAndShiftForWrite(userId: number): Promise<
  | {
      ok: true;
      branch: ActiveBranchContext;
      day: BusinessDayRecord;
      shift: ShiftMoveRecord | null;
    }
  | { ok: false; response: NextResponse }
> {
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) {
    return { ok: false, response: branch };
  }

  const day = await getOpenBusinessDay(branch.branchId);
  if (!day) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً', code: 'NO_OPEN_DAY' },
        { status: 400 },
      ),
    };
  }

  const anyOpen = await getUserOpenShift(userId);
  if (anyOpen && anyOpen.branchId !== branch.branchId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'لديك وردية مفتوحة في فرع آخر — يجب إغلاقها أولاً',
          code: 'OPEN_SHIFT_OTHER_BRANCH',
        },
        { status: 400 },
      ),
    };
  }

  const shift = await getUserOpenShiftForBranch(userId, branch.branchId);
  return { ok: true, branch, day, shift };
}

export async function requireAuthenticatedBranchContext(): Promise<
  ActiveBranchContext | NextResponse
> {
  return requireActiveBranchContext();
}
