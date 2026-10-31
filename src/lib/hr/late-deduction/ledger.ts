import 'server-only';

import { sql } from '@/lib/db';
import { payrollMonthFromWorkDate } from '@/lib/services/employeeLedgerDualWrite';
import { LATE_DEDUCTION_ENTRY_REASON, LATE_DEDUCTION_REF_TYPE } from './constants';
import { buildLateDeductionLedgerNote } from './messages';

type DbLike = { request: () => sql.Request };

export { buildLateDeductionLedgerNote };

/** SQL Server unique / duplicate-key errors (race on concurrent insert). */
export function isLateDeductionLedgerUniqueError(err: unknown): boolean {
  const number = Number((err as { number?: unknown } | null)?.number);
  if (number === 2627 || number === 2601) return true;
  const message = String(
    (err as { message?: unknown } | null)?.message ?? err ?? '',
  );
  return /unique|duplicate key|2627|2601/i.test(message);
}

async function findActiveLateDeductionLedger(
  db: DbLike,
  attendanceId: number,
): Promise<{ ledgerEntryId: number; amount: number } | null> {
  const existing = await db
    .request()
    .input('refType', sql.NVarChar(80), LATE_DEDUCTION_REF_TYPE)
    .input('refId', sql.Int, attendanceId)
    .input('reason', sql.NVarChar(40), LATE_DEDUCTION_ENTRY_REASON)
    .query(`
      SELECT TOP 1 LedgerEntryID, Amount
      FROM dbo.TblEmpLedgerEntry
      WHERE RefType = @refType
        AND RefID = @refId
        AND EntryReason = @reason
        AND IsVoided = 0
    `);
  const row = existing.recordset[0] as
    | { LedgerEntryID: number; Amount: number }
    | undefined;
  if (!row) return null;
  return {
    ledgerEntryId: Number(row.LedgerEntryID),
    amount: Number(row.Amount),
  };
}

/**
 * Insert or reuse a single active ledger debit for this attendance late deduction.
 * Idempotent via UX_TblEmpLedgerEntry_ActiveRefReason (RefType+RefID+EntryReason).
 * Concurrent losers retry on unique violation and reuse the winner's row.
 * No CashMoveID — salary deduction must not move cash drawer.
 */
export async function upsertLateDeductionLedgerEntry(
  db: DbLike,
  params: {
    empId: number;
    branchId: number;
    workDate: string;
    attendanceId: number;
    amount: number;
    lateMinutes: number;
    kind: string;
    createdByUserId?: number | null;
  },
): Promise<{ ledgerEntryId: number; outcome: 'inserted' | 'updated' | 'unchanged' }> {
  const payrollMonth = payrollMonthFromWorkDate(params.workDate);
  const notes = buildLateDeductionLedgerNote({
    workDate: params.workDate,
    lateMinutes: params.lateMinutes,
    kind: params.kind,
  });

  const existing = await findActiveLateDeductionLedger(db, params.attendanceId);

  if (existing) {
    if (existing.amount === params.amount) {
      return { ledgerEntryId: existing.ledgerEntryId, outcome: 'unchanged' };
    }
    await db
      .request()
      .input('id', sql.Int, existing.ledgerEntryId)
      .input('amount', sql.Decimal(12, 2), params.amount)
      .input('notes', sql.NVarChar(500), notes)
      .input('attendanceId', sql.Int, params.attendanceId)
      .input('payrollMonth', sql.NVarChar(7), payrollMonth)
      .query(`
        UPDATE dbo.TblEmpLedgerEntry
        SET Amount = @amount,
            Notes = @notes,
            AttendanceID = @attendanceId,
            PayrollMonth = @payrollMonth,
            UpdatedAt = SYSDATETIME()
        WHERE LedgerEntryID = @id AND IsVoided = 0
      `);
    return { ledgerEntryId: existing.ledgerEntryId, outcome: 'updated' };
  }

  try {
    const inserted = await db
      .request()
      .input('empId', sql.Int, params.empId)
      .input('branchId', sql.Int, params.branchId)
      .input('entryDate', sql.Date, params.workDate)
      .input('amount', sql.Decimal(12, 2), params.amount)
      .input('payrollMonth', sql.NVarChar(7), payrollMonth)
      .input('refType', sql.NVarChar(80), LATE_DEDUCTION_REF_TYPE)
      .input('refId', sql.Int, params.attendanceId)
      .input('attendanceId', sql.Int, params.attendanceId)
      .input('notes', sql.NVarChar(500), notes)
      .input('createdBy', sql.Int, params.createdByUserId ?? null)
      .input('reason', sql.NVarChar(40), LATE_DEDUCTION_ENTRY_REASON)
      .query(`
        INSERT INTO dbo.TblEmpLedgerEntry (
          BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
          PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
          Notes, IsVoided, CreatedByUserID, CreatedAt
        )
        OUTPUT INSERTED.LedgerEntryID
        VALUES (
          @branchId, @empId, @entryDate, N'debit', @reason, @amount,
          @payrollMonth, @refType, @refId, NULL, @attendanceId,
          @notes, 0, @createdBy, SYSDATETIME()
        )
      `);

    return {
      ledgerEntryId: Number(inserted.recordset[0].LedgerEntryID),
      outcome: 'inserted',
    };
  } catch (err) {
    if (!isLateDeductionLedgerUniqueError(err)) throw err;
    // Concurrent insert won — reuse that row (update amount if needed).
    const raced = await findActiveLateDeductionLedger(db, params.attendanceId);
    if (!raced) throw err;
    if (raced.amount === params.amount) {
      return { ledgerEntryId: raced.ledgerEntryId, outcome: 'unchanged' };
    }
    await db
      .request()
      .input('id', sql.Int, raced.ledgerEntryId)
      .input('amount', sql.Decimal(12, 2), params.amount)
      .input('notes', sql.NVarChar(500), notes)
      .input('attendanceId', sql.Int, params.attendanceId)
      .input('payrollMonth', sql.NVarChar(7), payrollMonth)
      .query(`
        UPDATE dbo.TblEmpLedgerEntry
        SET Amount = @amount,
            Notes = @notes,
            AttendanceID = @attendanceId,
            PayrollMonth = @payrollMonth,
            UpdatedAt = SYSDATETIME()
        WHERE LedgerEntryID = @id AND IsVoided = 0
      `);
    return { ledgerEntryId: raced.ledgerEntryId, outcome: 'updated' };
  }
}

export async function voidLateDeductionLedgerEntry(
  db: DbLike,
  params: {
    attendanceId: number;
    voidReason: string;
  },
): Promise<number> {
  const result = await db
    .request()
    .input('refType', sql.NVarChar(80), LATE_DEDUCTION_REF_TYPE)
    .input('refId', sql.Int, params.attendanceId)
    .input('reason', sql.NVarChar(40), LATE_DEDUCTION_ENTRY_REASON)
    .input('voidReason', sql.NVarChar(500), params.voidReason)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1,
          VoidReason = @voidReason,
          UpdatedAt = SYSDATETIME()
      WHERE RefType = @refType
        AND RefID = @refId
        AND EntryReason = @reason
        AND IsVoided = 0
    `);
  return result.rowsAffected[0] ?? 0;
}
