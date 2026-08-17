/**
 * Paired "معادلة" income rows created with employee-advance deductions.
 * Deduction POST inserts expense then a matching ايرادات/معادلة cash move.
 */

import { sql } from '@/lib/db';

export interface DeductionExpenseForPairing {
  ID: number;
  BranchID: number;
  invDate: string | Date;
  ExpINID: number;
  GrandTolal: number;
  PaymentMethodID: number;
  ShiftMoveID: number | null;
}

export async function isEmployeeAdvanceExpense(
  transaction: sql.Transaction,
  expINID: number,
): Promise<boolean> {
  const result = await new sql.Request(transaction)
    .input('expINID', sql.Int, expINID)
    .query(`
      SELECT TOP 1 1 AS ok
      WHERE EXISTS (
        SELECT 1 FROM dbo.TblExpCatEmpMap m
        WHERE m.ExpINID = @expINID AND m.TxnKind = N'advance'
      )
      OR EXISTS (
        SELECT 1 FROM dbo.TblExpINCat c
        WHERE c.ExpINID = @expINID AND c.CatName LIKE N'%سلف%'
      )
    `);
  return result.recordset.length > 0;
}

/**
 * Finds the settlement income created with a deduction expense.
 * Prefer same invTime (inserted in the same POST), then same amount/payment.
 */
export async function findPairedDeductionSettlementId(
  transaction: sql.Transaction,
  expense: DeductionExpenseForPairing,
): Promise<number | null> {
  const isAdvance = await isEmployeeAdvanceExpense(transaction, expense.ExpINID);
  if (!isAdvance) return null;

  const timeRes = await new sql.Request(transaction)
    .input('id', sql.Int, expense.ID)
    .query(`
      SELECT TOP 1 invTime
      FROM dbo.TblCashMove
      WHERE ID = @id
    `);
  const invTime = (timeRes.recordset[0]?.invTime as string | null | undefined) ?? null;

  const result = await new sql.Request(transaction)
    .input('expenseId', sql.Int, expense.ID)
    .input('branchId', sql.Int, expense.BranchID)
    .input('invDate', sql.Date, expense.invDate)
    .input('amount', sql.Decimal(10, 2), expense.GrandTolal)
    .input('shiftMoveId', sql.Int, expense.ShiftMoveID)
    .input('paymentMethodId', sql.Int, expense.PaymentMethodID)
    .input('invTime', sql.NVarChar(50), invTime)
    .query(`
      SELECT TOP 1 cm.ID
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      WHERE cm.invType = N'ايرادات'
        AND cm.inOut = N'in'
        AND cat.CatName = N'معادلة'
        AND cm.BranchID = @branchId
        AND cm.invDate = @invDate
        AND cm.ID > @expenseId
        AND cm.Notes LIKE N'معادلة خصم%'
        AND (
          (@shiftMoveId IS NULL AND cm.ShiftMoveID IS NULL)
          OR cm.ShiftMoveID = @shiftMoveId
        )
        AND (
          (@invTime IS NOT NULL AND cm.invTime = @invTime)
          OR (
            cm.GrandTolal = @amount
            AND (
              (@paymentMethodId IS NULL AND cm.PaymentMethodID IS NULL)
              OR cm.PaymentMethodID = @paymentMethodId
            )
          )
        )
      ORDER BY
        CASE WHEN @invTime IS NOT NULL AND cm.invTime = @invTime THEN 0 ELSE 1 END,
        CASE WHEN cm.GrandTolal = @amount THEN 0 ELSE 1 END,
        cm.ID ASC
    `);

  const id = result.recordset[0]?.ID;
  return id != null ? Number(id) : null;
}

export async function syncPairedDeductionSettlement(
  transaction: sql.Transaction,
  expense: DeductionExpenseForPairing,
  updates: {
    grandTotal: number;
    paymentMethodId: number;
    employeeName?: string | null;
  },
): Promise<number | null> {
  const settlementId = await findPairedDeductionSettlementId(transaction, expense);
  if (settlementId == null) return null;

  const notes =
    updates.employeeName && updates.employeeName.trim()
      ? `معادلة خصم ${updates.employeeName.trim()}`
      : null;

  const req = new sql.Request(transaction)
    .input('id', sql.Int, settlementId)
    .input('grandTotal', sql.Decimal(10, 2), updates.grandTotal)
    .input('paymentMethodId', sql.Int, updates.paymentMethodId)
    .input('notes', sql.NVarChar(sql.MAX), notes);

  if (notes) {
    await req.query(`
      UPDATE dbo.TblCashMove
      SET GrandTolal = @grandTotal,
          PaymentMethodID = @paymentMethodId,
          Notes = @notes
      WHERE ID = @id AND invType = N'ايرادات'
    `);
  } else {
    await req.query(`
      UPDATE dbo.TblCashMove
      SET GrandTolal = @grandTotal,
          PaymentMethodID = @paymentMethodId
      WHERE ID = @id AND invType = N'ايرادات'
    `);
  }

  return settlementId;
}
