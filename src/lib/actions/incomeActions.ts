/**
 * Income / revenue domain actions — single execution path.
 */

import { sql } from '@/lib/db';
import {
  deleteCashMoveWithLinkedLedgerEntries,
  type DeleteCashMoveWithLedgerResult,
} from '@/lib/services/cashMoveHardDeleteService';

export interface IncomeSnapshot {
  ID: number;
  invID: number | null;
  invDate: string | Date;
  invType: string;
  ExpINID: number;
  GrandTolal: number;
  PaymentMethodID: number;
  Notes: string | null;
  ShiftMoveID: number | null;
}

export interface UpdateIncomeInput {
  invDate: string;
  amount: number;
  expInId: number;
  paymentMethodId: number;
  notes?: string | null;
  shiftMoveId?: number | null;
}

export async function getIncomeSnapshot(
  transaction: sql.Transaction,
  id: number,
): Promise<IncomeSnapshot | null> {
  const result = await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1
        ID, invID, invDate, invType, ExpINID, GrandTolal, PaymentMethodID,
        Notes, ShiftMoveID
      FROM dbo.TblCashMove
      WHERE ID = @id AND invType = N'ايرادات'
    `);
  return result.recordset[0] || null;
}

export async function updateIncome(
  transaction: sql.Transaction,
  id: number,
  input: UpdateIncomeInput,
): Promise<IncomeSnapshot> {
  const exists = await getIncomeSnapshot(transaction, id);
  if (!exists) throw new Error('الإيراد غير موجود');

  const parsedDate = new Date(input.invDate);
  if (isNaN(parsedDate.getTime())) throw new Error(`تاريخ غير صالح: ${input.invDate}`);

  // Validate category
  const catRes = await new sql.Request(transaction)
    .input('expInId', sql.Int, input.expInId)
    .query(`SELECT 1 FROM dbo.TblExpINCat WHERE ExpINID = @expInId`);
  if (catRes.recordset.length === 0) throw new Error('تصنيف الإيراد غير موجود');

  // Validate payment method
  const pmRes = await new sql.Request(transaction)
    .input('pmId', sql.Int, input.paymentMethodId)
    .query(`SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID = @pmId`);
  if (pmRes.recordset.length === 0) throw new Error('طريقة الدفع غير موجودة');

  await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .input('invDate', sql.Date, parsedDate)
    .input('expInId', sql.Int, input.expInId)
    .input('amount', sql.Decimal(10, 2), input.amount)
    .input('notes', sql.NVarChar(sql.MAX), input.notes?.trim() || null)
    .input('paymentMethodId', sql.Int, input.paymentMethodId)
    .input('shiftMoveId', sql.Int, input.shiftMoveId ?? null)
    .query(`
      UPDATE dbo.TblCashMove
      SET
        invDate = @invDate,
        ExpINID = @expInId,
        GrandTolal = @amount,
        Notes = @notes,
        PaymentMethodID = @paymentMethodId,
        ShiftMoveID = COALESCE(@shiftMoveId, ShiftMoveID)
      WHERE ID = @id AND invType = N'ايرادات'
    `);

  const updated = await getIncomeSnapshot(transaction, id);
  if (!updated) throw new Error('فشل تحديث الإيراد');
  return updated;
}

export async function deleteIncome(
  transaction: sql.Transaction,
  id: number,
): Promise<Extract<DeleteCashMoveWithLedgerResult, { deleted: true }>> {
  const existing = await getIncomeSnapshot(transaction, id);
  if (!existing) {
    throw new Error('الإيراد غير موجود أو تم حذفه');
  }

  const result = await deleteCashMoveWithLinkedLedgerEntries(transaction, id);
  if (!result.deleted) {
    throw new Error('الإيراد غير موجود أو تم حذفه');
  }

  return result;
}
