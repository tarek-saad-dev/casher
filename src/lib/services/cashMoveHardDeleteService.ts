/**
 * Hard-delete CashMove rows and any Employee Ledger entries linked via CashMoveID.
 *
 * Order matters for FK_TblEmpLedgerEntry_CashMoveID:
 * 1) delete linked TblEmpLedgerEntry rows
 * 2) delete TblCashMove
 *
 * Does not drop the FK, does not use ON DELETE CASCADE, and only touches
 * ledger rows where CashMoveID equals the selected cash move.
 */

import 'server-only';

import { sql } from '@/lib/db';

export interface CashMoveForDelete {
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

export type DeleteCashMoveWithLedgerResult =
  | { deleted: false; reason: 'not_found' }
  | { deleted: true; ledgerDeletedCount: number };

export class CashMoveHardDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashMoveHardDeleteError';
  }
}

export function cashMoveHardDeleteSuccessMessage(ledgerDeletedCount: number): string {
  return ledgerDeletedCount > 0
    ? 'تم حذف الحركة وحذف تأثيرها من دفتر الموظفين.'
    : 'تم حذف الحركة بنجاح.';
}

export async function getCashMoveForDelete(
  tx: sql.Transaction,
  cashMoveId: number,
): Promise<CashMoveForDelete | null> {
  const result = await new sql.Request(tx)
    .input('cashMoveId', sql.Int, cashMoveId)
    .query(`
      SELECT TOP 1
        ID, invID, invType, invDate, ExpINID, GrandTolal, PaymentMethodID,
        inOut, Notes, ShiftMoveID
      FROM dbo.TblCashMove
      WHERE ID = @cashMoveId
    `);

  return (result.recordset[0] as CashMoveForDelete | undefined) ?? null;
}

/**
 * Deletes active and voided ledger rows linked to this CashMove.
 * Does not touch rows with NULL CashMoveID or a different CashMoveID.
 */
export async function deleteLedgerEntriesLinkedToCashMove(
  tx: sql.Transaction,
  cashMoveId: number,
): Promise<number> {
  try {
    const result = await new sql.Request(tx)
      .input('cashMoveId', sql.Int, cashMoveId)
      .query(`
        DELETE FROM dbo.TblEmpLedgerEntry
        WHERE CashMoveID = @cashMoveId
      `);

    return Number(result.rowsAffected[0] ?? 0);
  } catch (err) {
    if (err instanceof CashMoveHardDeleteError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cashMoveHardDelete] deleteLedgerEntriesLinkedToCashMove failed:', message);
    throw new CashMoveHardDeleteError(
      'فشل حذف قيود دفتر الموظفين المرتبطة بالحركة. تم التراجع عن العملية.',
    );
  }
}

export async function deleteCashMoveHard(
  tx: sql.Transaction,
  cashMoveId: number,
): Promise<void> {
  try {
    const result = await new sql.Request(tx)
      .input('cashMoveId', sql.Int, cashMoveId)
      .query(`
        DELETE FROM dbo.TblCashMove
        WHERE ID = @cashMoveId
      `);

    if (Number(result.rowsAffected[0] ?? 0) === 0) {
      throw new CashMoveHardDeleteError('حركة الخزنة غير موجودة أو تم حذفها');
    }
  } catch (err) {
    if (err instanceof CashMoveHardDeleteError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cashMoveHardDelete] deleteCashMoveHard failed:', message);
    throw new CashMoveHardDeleteError(
      'فشل حذف حركة الخزنة. تم التراجع عن العملية.',
    );
  }
}

export async function deleteCashMoveWithLinkedLedgerEntries(
  tx: sql.Transaction,
  cashMoveId: number,
): Promise<DeleteCashMoveWithLedgerResult> {
  const cashMove = await getCashMoveForDelete(tx, cashMoveId);

  if (!cashMove) {
    return { deleted: false, reason: 'not_found' };
  }

  const ledgerDeletedCount = await deleteLedgerEntriesLinkedToCashMove(tx, cashMoveId);
  await deleteCashMoveHard(tx, cashMoveId);

  return {
    deleted: true,
    ledgerDeletedCount,
  };
}
