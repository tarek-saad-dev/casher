import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ActiveBranchContext } from './types';
import { BranchDomainError } from './types';
import {
  mapShiftMoveRow,
  SHIFT_MOVE_SELECT,
  type ShiftMoveRecord,
} from '@/modules/operations/infra/shiftMoveRecord';
import { openShiftSession } from '@/modules/operations/application/openShiftSession';
import {
  closeOwnOpenShiftSession,
  closeShiftSession,
} from '@/modules/operations/application/closeShiftSession';
import { handoffShift } from '@/modules/operations/application/handoffShiftSession';

/**
 * Shift instance (TblShiftMove).
 *
 * Intentional invariant: a user may have AT MOST ONE OPEN shift globally.
 * Ownership of that instance is UserID + BranchID + BusinessDayID + ShiftID.
 * Cross-branch transition is atomic handoff (never close-then-insert as two operations).
 *
 * See src/modules/operations/domain/invariants.ts
 */
export type { ShiftMoveRecord };

export async function getUserOpenShift(userId: number): Promise<ShiftMoveRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.Int, userId)
    .query(`
      SELECT TOP 1
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.UserID = @userId
      ORDER BY sm.ID DESC
    `);
  if (!result.recordset[0]) return null;
  return mapShiftMoveRow(result.recordset[0]);
}

export async function getUserOpenShiftForBranch(
  userId: number,
  branchId: number,
): Promise<ShiftMoveRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.Int, userId)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.UserID = @userId AND sm.BranchID = @branchId
      ORDER BY sm.ID DESC
    `);
  if (!result.recordset[0]) return null;
  return mapShiftMoveRow(result.recordset[0]);
}

export async function listOpenShiftsForBranch(branchId: number): Promise<ShiftMoveRecord[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.BranchID = @branchId
      ORDER BY sm.ID
    `);
  return result.recordset.map(mapShiftMoveRow);
}

export async function validateShiftBelongsToBranch(
  shiftMoveId: number,
  branchId: number,
): Promise<ShiftMoveRecord> {
  const db = await getPool();
  const result = await db
    .request()
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
    throw new BranchDomainError('SHIFT_NOT_FOUND', 'الوردية غير موجودة', 404);
  }
  const shift = mapShiftMoveRow(result.recordset[0]);
  if (shift.branchId !== branchId) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_MISMATCH',
      'الوردية لا تنتمي للفرع النشط',
      403,
    );
  }
  return shift;
}

export function openShift(
  branchContext: ActiveBranchContext,
  userId: number,
  shiftId: number,
): Promise<ShiftMoveRecord> {
  return openShiftSession(branchContext, userId, shiftId);
}

export function closeShift(
  branchContext: ActiveBranchContext,
  shiftMoveId: number,
): Promise<ShiftMoveRecord> {
  return closeShiftSession(branchContext, shiftMoveId);
}

export function closeOwnOpenShift(userId: number): Promise<ShiftMoveRecord> {
  return closeOwnOpenShiftSession(userId);
}

export { handoffShift };
