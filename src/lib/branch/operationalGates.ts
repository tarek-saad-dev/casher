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
import { getUserOpenShift, type ShiftMoveRecord } from './shiftSession';
import { getBranchById } from './repository';
import { validateUserBranchAccess } from './access';
import { requireOperationalSnapshot } from '@/modules/operations/application/OperationalContextService';
import { ensureBusinessDayCurrent } from '@/modules/operations/application/reconcileBusinessDay';
import { withOperationalRequestScope } from '@/modules/operations/requestScope';
import { lockOperationalWrite } from '@/modules/operations/infra/businessDayLock';

export { lockOperationalWrite };

async function toOperationalBranchContext(
  userId: number,
  branchId: number,
): Promise<ActiveBranchContext> {
  const branch = await getBranchById(branchId);
  if (!branch || !branch.isActive) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
  }
  const access = await validateUserBranchAccess(userId, branchId);
  return {
    userId,
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    shortName: branch.shortName,
    timeZone: branch.timeZone,
    businessDayCutoffTime: branch.businessDayCutoffTime,
    canOperate: access.canOperate,
    canViewReports: access.canViewReports,
    canSwitch: access.canSwitch,
  };
}

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
 * SHIFT-scope when the user has an OPEN ShiftSession: ownership is always the
 * operational branch, never the ViewBranch cookie.
 * DAY-scope fallback (view cookie) only when there is no OPEN shift.
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
  return withOperationalRequestScope(async () => {
    try {
      const openShift = await getUserOpenShift(userId);
      if (openShift?.status) {
        const snapshot = await requireOperationalSnapshot({
          userId,
          scope: 'SHIFT',
        });
        if (!snapshot.day || !snapshot.shift) {
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'لا توجد وردية مفتوحة لهذا المستخدم', code: 'NO_OPEN_SHIFT' },
              { status: 400 },
            ),
          };
        }
        const branch = await toOperationalBranchContext(userId, snapshot.context.branchId);
        return { ok: true, branch, day: snapshot.day, shift: snapshot.shift };
      }

      const branch = await requireBranchOperationAccess();
      if (!isActiveBranchContext(branch)) {
        return { ok: false, response: branch };
      }

      const snapshot = await requireOperationalSnapshot({
        userId,
        branchId: branch.branchId,
        scope: 'DAY',
      });
      if (!snapshot.day) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً', code: 'NO_OPEN_DAY' },
            { status: 400 },
          ),
        };
      }
      return { ok: true, branch, day: snapshot.day, shift: snapshot.shift };
    } catch (err) {
      const mapped = branchErrorResponse(err);
      if (mapped) return { ok: false, response: mapped };
      throw err;
    }
  });
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
  try {
    await ensureBusinessDayCurrent(branch.branchId, {
      mode: 'STRICT',
      trigger: 'STRICT_CATCH_UP',
    });
  } catch (err) {
    const mapped = branchErrorResponse(err);
    if (mapped) return { ok: false, response: mapped };
    throw err;
  }

  const open = await getOpenBusinessDay(branch.branchId);
  if (open) {
    return { ok: true, day: open, dateYmd: open.newDay };
  }

  const businessDate = getBranchBusinessDate(branch);
  const byDate = await resolveBranchDayForDate(branch.branchId, businessDate);
  if (!byDate.ok) return byDate;
  return { ok: true, day: byDate.day, dateYmd: byDate.day.newDay };
}
