import 'server-only';
import { sql } from '@/lib/db';
import {
  mapShiftMoveRow,
  SHIFT_MOVE_SELECT,
  type ShiftMoveRecord,
} from '@/modules/operations/infra/shiftMoveRecord';

/**
 * Non-locking discovery of the user's open shift.
 * Financial writes must lock TblNewDay before TblShiftMove (lockOperationalWrite).
 * UPDLOCK/HOLDLOCK here would invert that order and deadlock with sales,
 * expenses, purchases, treasury, and day close.
 */
export const USER_OPEN_SHIFT_DISCOVERY_SQL = `
  SELECT TOP 1
    ${SHIFT_MOVE_SELECT}
  FROM dbo.TblShiftMove sm WITH (NOLOCK)
  LEFT JOIN dbo.TblUser u WITH (NOLOCK) ON u.UserID = sm.UserID
  LEFT JOIN dbo.TblShift s WITH (NOLOCK) ON s.ShiftID = sm.ShiftID
  WHERE sm.Status = 1 AND sm.UserID = @userId
  ORDER BY sm.ID DESC
`;

/** Read the user's globally open shift inside the caller transaction without locking it. */
export async function getUserOpenShiftInTransaction(
  tx: sql.Transaction,
  userId: number,
): Promise<ShiftMoveRecord | null> {
  const result = await new sql.Request(tx)
    .input('userId', sql.Int, userId)
    .query(USER_OPEN_SHIFT_DISCOVERY_SQL);
  if (!result.recordset[0]) return null;
  return mapShiftMoveRow(result.recordset[0]);
}
