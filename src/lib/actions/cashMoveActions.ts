/**
 * Cash move domain actions — single execution path.
 */

import { sql } from '@/lib/db';

export interface CashMoveSnapshot {
  ID: number;
  invID: number | null;
  invType: string;
  invDate: string | Date;
  ExpINID: number | null;
  GrandTolal: number;
  PaymentMethodID: number;
  inOut: string;
  Notes: string | null;
  ShiftMoveID: number | null;
}

export async function getCashMoveSnapshot(
  transaction: sql.Transaction,
  id: number,
): Promise<CashMoveSnapshot | null> {
  const result = await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1
        ID, invID, invType, invDate, ExpINID, GrandTolal, PaymentMethodID,
        inOut, Notes, ShiftMoveID
      FROM dbo.TblCashMove
      WHERE ID = @id
    `);
  return result.recordset[0] || null;
}

export async function deleteCashMove(
  transaction: sql.Transaction,
  id: number,
): Promise<void> {
  const result = await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .query(`DELETE FROM dbo.TblCashMove WHERE ID = @id`);

  if (result.rowsAffected[0] === 0) {
    throw new Error('حركة الخزنة غير موجودة أو تم حذفها');
  }
}
