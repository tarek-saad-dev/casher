/**
 * Expense domain actions — single execution path.
 */

import { sql } from '@/lib/db';
import {
  deleteCashMoveWithLinkedLedgerEntries,
  type DeleteCashMoveWithLedgerResult,
} from '@/lib/services/cashMoveHardDeleteService';

export interface ExpenseSnapshot {
  ID: number;
  invID: number | null;
  invDate: string | Date;
  invType: string;
  inOut: string;
  ExpINID: number;
  GrandTolal: number;
  PaymentMethodID: number;
  Notes: string | null;
  ShiftMoveID: number | null;
  EditHistory: unknown;
}

export interface UpdateExpenseInput {
  expINID: number;
  grandTotal: number;
  paymentMethodId: number;
  notes?: string | null;
  editedByUserId: number;
  editedByUserName: string;
}

export async function getExpenseSnapshot(
  transaction: sql.Transaction,
  id: number,
): Promise<ExpenseSnapshot | null> {
  const result = await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1
        ID, invID, invDate, invType, inOut, ExpINID, GrandTolal, PaymentMethodID,
        Notes, ShiftMoveID, EditHistory
      FROM dbo.TblCashMove
      WHERE ID = @id AND invType = N'مصروفات'
    `);
  return result.recordset[0] || null;
}

export async function updateExpense(
  transaction: sql.Transaction,
  id: number,
  input: UpdateExpenseInput,
): Promise<ExpenseSnapshot> {
  const current = await getExpenseSnapshot(transaction, id);
  if (!current) throw new Error('المصروف غير موجود');

  const editEntry = {
    editedAt: new Date().toISOString(),
    editedBy: input.editedByUserName,
    userId: input.editedByUserId,
    changes: {
      expINID: { old: current.ExpINID, new: input.expINID },
      grandTotal: { old: current.GrandTolal, new: input.grandTotal },
      paymentMethodId: { old: current.PaymentMethodID, new: input.paymentMethodId },
      notes: { old: current.Notes, new: input.notes ?? null },
    },
  };

  let editHistory: any[] = [];
  if (current.EditHistory) {
    try {
      editHistory = JSON.parse(String(current.EditHistory));
    } catch {
      editHistory = [];
    }
  }
  editHistory.push(editEntry);

  await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .input('expINID', sql.Int, input.expINID)
    .input('grandTotal', sql.Decimal(10, 2), input.grandTotal)
    .input('paymentMethodId', sql.Int, input.paymentMethodId)
    .input('notes', sql.NVarChar(sql.MAX), input.notes || null)
    .input('editHistory', sql.NVarChar(sql.MAX), JSON.stringify(editHistory))
    .query(`
      UPDATE dbo.TblCashMove
      SET ExpINID = @expINID,
          GrandTolal = @grandTotal,
          PaymentMethodID = @paymentMethodId,
          Notes = @notes,
          EditHistory = @editHistory
      WHERE ID = @id AND invType = N'مصروفات'
    `);

  const updated = await getExpenseSnapshot(transaction, id);
  if (!updated) throw new Error('فشل تحديث المصروف');
  return updated;
}

export async function updateExpenseCategory(
  transaction: sql.Transaction,
  id: number,
  expINID: number,
): Promise<ExpenseSnapshot> {
  const current = await getExpenseSnapshot(transaction, id);
  if (!current) throw new Error('المصروف غير موجود');

  if (current.invType !== 'مصروفات' || current.inOut !== 'out') {
    throw new Error('هذه المعاملة ليست مصروف');
  }

  const catRes = await new sql.Request(transaction)
    .input('expinid', sql.Int, expINID)
    .query(`SELECT 1 FROM dbo.TblExpINCat WHERE ExpINID = @expinid AND ExpINType = N'مصروفات'`);
  if (catRes.recordset.length === 0) {
    throw new Error('الفئة المحددة غير موجودة أو ليست فئة مصروفات');
  }

  await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .input('expinid', sql.Int, expINID)
    .query(`UPDATE dbo.TblCashMove SET ExpINID = @expinid WHERE ID = @id AND invType = N'مصروفات'`);

  const updated = await getExpenseSnapshot(transaction, id);
  if (!updated) throw new Error('فشل تحديث تصنيف المصروف');
  return updated;
}

export async function deleteExpense(
  transaction: sql.Transaction,
  id: number,
): Promise<Extract<DeleteCashMoveWithLedgerResult, { deleted: true }>> {
  const existing = await getExpenseSnapshot(transaction, id);
  if (!existing) {
    throw new Error('المصروف غير موجود أو تم حذفه');
  }

  const result = await deleteCashMoveWithLinkedLedgerEntries(transaction, id);
  if (!result.deleted) {
    throw new Error('المصروف غير موجود أو تم حذفه');
  }

  return result;
}
