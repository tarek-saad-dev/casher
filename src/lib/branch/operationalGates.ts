import 'server-only';
import { NextResponse } from 'next/server';
import {
  isActiveBranchContext,
  requireActiveBranchContext,
  requireBranchOperationAccess,
} from './context';
import { BranchDomainError, type ActiveBranchContext } from './types';
import {
  getBranchBusinessDate,
  getBusinessDayByDate,
  getOpenBusinessDay,
  type BusinessDayRecord,
} from './businessDay';
import {
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
 * Callers must stamp BranchID + BusinessDayID on financial roots from this context.
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

  // Scope to the active branch only — an open shift on another branch must not block POS.
  const shift = await getUserOpenShiftForBranch(userId, branch.branchId);
  return { ok: true, branch, day, shift };
}

export async function requireAuthenticatedBranchContext(): Promise<
  ActiveBranchContext | NextResponse
> {
  return requireActiveBranchContext();
}

/**
 * Resolve the business day for an explicit (typically past) date on the active
 * branch. Never attaches to the currently open day and never creates a day —
 * callers must have a matching TblNewDay row already, or the write is rejected.
 */
export async function resolveBranchDayForDate(
  branchId: number,
  dateYmd: string,
): Promise<
  | { ok: true; day: BusinessDayRecord }
  | { ok: false; response: NextResponse }
> {
  const day = await getBusinessDayByDate(branchId, dateYmd);
  if (!day) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'لا يوجد يوم عمل مطابق لهذا التاريخ في الفرع النشط — لا يمكن الإضافة',
          code: 'NO_BUSINESS_DAY_FOR_DATE',
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, day };
}

/**
 * POS "today" writes on the active branch:
 * 1) Prefer the currently open business day (correct branch + overnight continuity).
 * 2) Else look up the cutoff-aware branch business date (before 04:00 stays prior day).
 *
 * Never trusts a browser calendar date that rolled at midnight.
 */
export async function resolveActiveBranchDayForPosWrite(
  branch: ActiveBranchContext,
): Promise<
  | { ok: true; day: BusinessDayRecord; dateYmd: string }
  | { ok: false; response: NextResponse }
> {
  const open = await getOpenBusinessDay(branch.branchId);
  if (open) {
    return { ok: true, day: open, dateYmd: open.newDay };
  }

  const businessDate = getBranchBusinessDate(branch);
  const byDate = await resolveBranchDayForDate(branch.branchId, businessDate);
  if (!byDate.ok) return byDate;
  return { ok: true, day: byDate.day, dateYmd: byDate.day.newDay };
}
