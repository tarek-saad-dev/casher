import 'server-only';
import { sql } from '@/lib/db';
import { BranchDomainError } from '@/lib/branch/types';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import {
  mapDayRow,
  mapShiftMoveRow,
  SHIFT_MOVE_SELECT,
  type ShiftMoveRecord,
} from './shiftMoveRecord';
import {
  assertDayShiftOwnership,
  assertTargetDayIsOpenForShift,
} from '../domain/shiftOwnership';

/**
 * Shared operational locking contract.
 *
 * Financial writes and BusinessDay close must lock the same TblNewDay row
 * with UPDLOCK so they serialize: one commits, the other either waits then
 * succeeds or fails BUSINESS_DAY_CLOSED.
 *
 * Lock order:
 *   Day mutations (open/close/close-and-open): TblBranch → TblNewDay → shifts
 *   Financial writes: exact TblNewDay → optional TblShiftMove
 *   Shift open/handoff (Phase 1B): TblUser → TblBranch → TblShiftMove → TblNewDay
 */
export async function lockBranchForDayMutation(
  tx: sql.Transaction,
  branchId: number,
): Promise<void> {
  const res = await new sql.Request(tx)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT BranchID
      FROM dbo.TblBranch WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE BranchID = @branchId
    `);
  if (!res.recordset[0]) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
  }
}

export async function lockOpenBusinessDay(
  tx: sql.Transaction,
  args: { branchId: number; businessDayId: number },
): Promise<BusinessDayRecord> {
  const res = await new sql.Request(tx)
    .input('id', sql.Int, args.businessDayId)
    .query(`
      SELECT ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE ID = @id
    `);
  const day = res.recordset[0] ? mapDayRow(res.recordset[0]) : null;
  if (!day) {
    throw new BranchDomainError(
      'NO_OPEN_DAY',
      'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً',
      400,
    );
  }
  if (day.branchId !== args.branchId) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'يوم العمل لا ينتمي للفرع المحدد',
      400,
    );
  }
  assertTargetDayIsOpenForShift(args.branchId, day);
  return day;
}

export async function tryLockCurrentOpenBusinessDay(
  tx: sql.Transaction,
  args: { branchId: number },
): Promise<BusinessDayRecord | null> {
  const res = await new sql.Request(tx)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT TOP 1 ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE BranchID = @branchId AND Status = 1
      ORDER BY ID DESC
    `);
  return res.recordset[0] ? mapDayRow(res.recordset[0]) : null;
}

export async function lockCurrentOpenBusinessDay(
  tx: sql.Transaction,
  args: { branchId: number },
): Promise<BusinessDayRecord> {
  const day = await tryLockCurrentOpenBusinessDay(tx, args);
  assertTargetDayIsOpenForShift(args.branchId, day);
  return day;
}

export async function lockShiftSessionForWrite(
  tx: sql.Transaction,
  args: { shiftSessionId: number; branchId: number; businessDayId: number },
): Promise<ShiftMoveRecord> {
  const res = await new sql.Request(tx)
    .input('id', sql.Int, args.shiftSessionId)
    .query(`
      SELECT
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.ID = @id
    `);
  if (!res.recordset[0]) {
    throw new BranchDomainError('SHIFT_NOT_FOUND', 'الوردية غير موجودة', 404);
  }
  const shift = mapShiftMoveRow(res.recordset[0]);
  if (!shift.status) {
    throw new BranchDomainError(
      'NO_OPEN_SHIFT',
      'لا توجد وردية مفتوحة لهذا المستخدم',
      400,
    );
  }
  if (shift.branchId !== args.branchId || shift.businessDayId !== args.businessDayId) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'تعارض ملكية الفرع بين اليوم والوردية',
      400,
    );
  }
  return shift;
}

/**
 * Call immediately after BEGIN on operational financial writes.
 * Locks the exact BusinessDay (must still be OPEN) and, when given,
 * the ShiftSession that will be stamped on the write.
 */
export async function lockOperationalWrite(
  tx: sql.Transaction,
  args: {
    branchId: number;
    businessDayId: number;
    shiftSessionId?: number | null;
    requireShift?: boolean;
  },
): Promise<{ day: BusinessDayRecord; shift: ShiftMoveRecord | null }> {
  const day = await lockOpenBusinessDay(tx, {
    branchId: args.branchId,
    businessDayId: args.businessDayId,
  });
  if (args.requireShift && args.shiftSessionId == null) {
    throw new BranchDomainError(
      'NO_OPEN_SHIFT',
      'لا توجد وردية مفتوحة لهذا المستخدم',
      400,
    );
  }
  if (args.shiftSessionId == null) {
    return { day, shift: null };
  }
  const shift = await lockShiftSessionForWrite(tx, {
    shiftSessionId: args.shiftSessionId,
    branchId: args.branchId,
    businessDayId: day.id,
  });
  assertDayShiftOwnership(args.branchId, day, shift);
  return { day, shift };
}
