import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BranchDomainError } from '@/lib/branch/types';
import { now as businessClockNow } from '../clock/BusinessClock';
import {
  formatLegacyEndTime,
  formatLegacyStartTime,
  mapDayRow,
  mapShiftMoveRow,
  SHIFT_MOVE_SELECT,
  type ShiftMoveRecord,
} from '../infra/shiftMoveRecord';
import {
  assertDayShiftOwnership,
} from '../domain/shiftOwnership';
import { lockBranchForDayMutation, lockCurrentOpenBusinessDay } from './businessDayLock';

export type ShiftMutationMode = 'open' | 'handoff';

/**
 * Atomic open-or-handoff.
 *
 * Lock order (always): TblUser → target TblBranch → current OPEN TblShiftMove → target TblNewDay.
 * The branch key serializes with BusinessDay close (which also locks TblBranch first).
 * Unique index UX_TblShiftMove_OneOpenPerUser is the last integrity net only.
 */
export async function executeOpenOrHandoffShift(args: {
  userId: number;
  targetBranchId: number;
  shiftId: number;
  mode?: ShiftMutationMode;
}): Promise<ShiftMoveRecord> {
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    const opened = await openOrHandoffInTransaction(tx, args);
    await tx.commit();
    return opened;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    if (
      /UX_TblShiftMove_OneOpenPerUser/i.test(message) ||
      /Cannot insert duplicate key/i.test(message)
    ) {
      throw new BranchDomainError(
        'ALREADY_OPEN_SHIFT',
        'لديك وردية مفتوحة بالفعل — أغلقها أولاً ثم افتح وردية في هذا الفرع',
        400,
      );
    }
    throw err;
  }
}

async function openOrHandoffInTransaction(
  tx: sql.Transaction,
  args: {
    userId: number;
    targetBranchId: number;
    shiftId: number;
    mode?: ShiftMutationMode;
  },
): Promise<ShiftMoveRecord> {
  const { userId, targetBranchId, shiftId, mode = 'open' } = args;

  const userLock = await new sql.Request(tx)
    .input('userId', sql.Int, userId)
    .query(`
      SELECT UserID
      FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE UserID = @userId
    `);
  if (!userLock.recordset[0]) {
    throw new BranchDomainError('USER_NOT_FOUND', 'المستخدم غير موجود', 401);
  }

  await lockBranchForDayMutation(tx, targetBranchId);

  const openRes = await new sql.Request(tx)
    .input('userId', sql.Int, userId)
    .query(`
      SELECT TOP 1
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.UserID = @userId
      ORDER BY sm.ID DESC
    `);
  const current = openRes.recordset[0] ? mapShiftMoveRow(openRes.recordset[0]) : null;

  if (current) {
    await assertExistingOpenShiftOwnership(tx, current);
  }

  const day = await lockCurrentOpenBusinessDay(tx, { branchId: targetBranchId });

  if (current) {
    if (current.branchId === targetBranchId) {
      assertDayShiftOwnership(targetBranchId, day, current);
      throw new BranchDomainError(
        mode === 'handoff' ? 'ALREADY_OPEN_ON_TARGET_BRANCH' : 'ALREADY_OPEN_SHIFT',
        'لديك وردية مفتوحة بالفعل — يجب إغلاقها أولاً',
        400,
      );
    }
    await updateShiftClosed(tx, current.id, current.branchId);
  }

  const at = businessClockNow();
  const inserted = await new sql.Request(tx)
    .input('branchId', sql.Int, targetBranchId)
    .input('businessDayId', sql.Int, day.id)
    .input('newDay', sql.Date, day.newDay)
    .input('userID', sql.Int, userId)
    .input('shiftID', sql.Int, shiftId)
    .input('startDate', sql.Date, day.newDay)
    .input('startTime', sql.NChar(10), formatLegacyStartTime(at))
    .query(`
      INSERT INTO dbo.TblShiftMove (
        BranchID, BusinessDayID, NewDay, UserID, ShiftID, StartDate, StartTime, Status
      )
      OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.BusinessDayID, INSERTED.NewDay,
             INSERTED.UserID, INSERTED.ShiftID, INSERTED.StartDate, INSERTED.StartTime,
             INSERTED.EndDate, INSERTED.EndTime, INSERTED.Status
      VALUES (
        @branchId, @businessDayId, @newDay, @userID, @shiftID, @startDate, @startTime, 1
      )
    `);

  if (!inserted.recordset[0]) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تعذر فتح الوردية', 400);
  }
  const opened = mapShiftMoveRow(inserted.recordset[0]);
  assertDayShiftOwnership(targetBranchId, day, opened);
  return opened;
}

async function assertExistingOpenShiftOwnership(
  tx: sql.Transaction,
  current: ShiftMoveRecord,
): Promise<void> {
  const dayRes = await new sql.Request(tx)
    .input('dayId', sql.Int, current.businessDayId)
    .query(`
      SELECT ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay
      WHERE ID = @dayId
    `);
  if (!dayRes.recordset[0]) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'يوم العمل المرتبط بالوردية غير موجود',
      400,
    );
  }
  assertDayShiftOwnership(current.branchId, mapDayRow(dayRes.recordset[0]), current);
}

export async function executeCloseShiftById(args: {
  shiftMoveId: number;
  expectedBranchId?: number;
  expectedUserId?: number;
}): Promise<ShiftMoveRecord> {
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    const closed = await closeShiftInTransaction(tx, args);
    await tx.commit();
    return closed;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw err;
  }
}

async function closeShiftInTransaction(
  tx: sql.Transaction,
  args: {
    shiftMoveId: number;
    expectedBranchId?: number;
    expectedUserId?: number;
  },
): Promise<ShiftMoveRecord> {
  const peek = await new sql.Request(tx)
    .input('id', sql.Int, args.shiftMoveId)
    .query(`
      SELECT TOP 1 UserID, BranchID, Status
      FROM dbo.TblShiftMove
      WHERE ID = @id
    `);
  const peeked = peek.recordset[0] as
    | { UserID: number; BranchID: number; Status: boolean }
    | undefined;
  if (!peeked) {
    throw new BranchDomainError('SHIFT_NOT_FOUND', 'الوردية غير موجودة', 404);
  }

  await new sql.Request(tx)
    .input('userId', sql.Int, Number(peeked.UserID))
    .query(`
      SELECT UserID
      FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE UserID = @userId
    `);

  const locked = await new sql.Request(tx)
    .input('id', sql.Int, args.shiftMoveId)
    .query(`
      SELECT
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.ID = @id
    `);
  if (!locked.recordset[0]) {
    throw new BranchDomainError('SHIFT_NOT_FOUND', 'الوردية غير موجودة', 404);
  }
  const shift = mapShiftMoveRow(locked.recordset[0]);

  if (args.expectedBranchId != null && shift.branchId !== args.expectedBranchId) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_MISMATCH',
      'الوردية لا تنتمي للفرع النشط',
      403,
    );
  }
  if (args.expectedUserId != null && shift.userId !== args.expectedUserId) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح بإغلاق هذه الوردية',
      403,
    );
  }
  if (!shift.status) {
    throw new BranchDomainError(
      'SHIFT_ALREADY_CLOSED',
      'هذه الوردية مغلقة بالفعل',
      400,
    );
  }

  const dayCheck = await new sql.Request(tx)
    .input('dayId', sql.Int, shift.businessDayId)
    .query(`
      SELECT ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay
      WHERE ID = @dayId
    `);
  if (!dayCheck.recordset[0]) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'يوم العمل غير موجود', 404);
  }
  assertDayShiftOwnership(shift.branchId, mapDayRow(dayCheck.recordset[0]), shift);
  if (
    args.expectedBranchId != null &&
    Number(dayCheck.recordset[0].BranchID) !== args.expectedBranchId
  ) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_MISMATCH',
      'يوم العمل لا ينتمي للفرع النشط',
      403,
    );
  }

  return updateShiftClosed(tx, shift.id, shift.branchId);
}

export async function executeCloseOwnOpenShift(userId: number): Promise<ShiftMoveRecord> {
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('userId', sql.Int, userId)
      .query(`
        SELECT UserID
        FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        WHERE UserID = @userId
      `);

    const openRes = await new sql.Request(tx)
      .input('userId', sql.Int, userId)
      .query(`
        SELECT TOP 1
          ${SHIFT_MOVE_SELECT}
        FROM dbo.TblShiftMove sm WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
        LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
        WHERE sm.Status = 1 AND sm.UserID = @userId
        ORDER BY sm.ID DESC
      `);
    if (!openRes.recordset[0]) {
      throw new BranchDomainError('NO_OPEN_SHIFT', 'لا توجد وردية مفتوحة', 400);
    }
    const open = mapShiftMoveRow(openRes.recordset[0]);
    if (open.userId !== userId) {
      throw new BranchDomainError(
        'OPERATION_NOT_ALLOWED',
        'غير مصرح بإغلاق هذه الوردية',
        403,
      );
    }
    const closed = await updateShiftClosed(tx, open.id, open.branchId);
    await tx.commit();
    return closed;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw err;
  }
}

async function updateShiftClosed(
  tx: sql.Transaction,
  shiftMoveId: number,
  branchId: number,
): Promise<ShiftMoveRecord> {
  const at = businessClockNow();
  const updated = await new sql.Request(tx)
    .input('id', sql.Int, shiftMoveId)
    .input('branchId', sql.Int, branchId)
    .input('endDate', sql.Date, at)
    .input('endTime', sql.NVarChar(50), formatLegacyEndTime(at))
    .query(`
      UPDATE dbo.TblShiftMove
      SET Status = 0, EndDate = @endDate, EndTime = @endTime
      WHERE ID = @id AND BranchID = @branchId AND Status = 1
    `);
  const rows = Array.isArray(updated.rowsAffected)
    ? updated.rowsAffected.reduce((sum, n) => sum + Number(n || 0), 0)
    : Number(updated.rowsAffected || 0);
  if (rows < 1) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تعذر إغلاق الوردية', 400);
  }

  const result = await new sql.Request(tx)
    .input('id', sql.Int, shiftMoveId)
    .query(`
      SELECT
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.ID = @id
    `);
  if (!result.recordset[0]) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تعذر إغلاق الوردية', 400);
  }
  const closed = mapShiftMoveRow(result.recordset[0]);
  if (closed.status) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تعذر إغلاق الوردية', 400);
  }
  return closed;
}
