import 'server-only';
import { sql } from '@/lib/db';
import {
  mapShiftMoveRow,
  SHIFT_MOVE_SELECT,
  type ShiftMoveRecord,
} from '@/modules/operations/infra/shiftMoveRecord';

/** Read the user's globally open shift inside the caller transaction (with row lock). */
export async function getUserOpenShiftInTransaction(
  tx: sql.Transaction,
  userId: number,
): Promise<ShiftMoveRecord | null> {
  const result = await new sql.Request(tx)
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
  if (!result.recordset[0]) return null;
  return mapShiftMoveRow(result.recordset[0]);
}
