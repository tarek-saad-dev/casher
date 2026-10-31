import 'server-only';

import { sql } from '@/lib/db';
import { payrollMonthFromWorkDate } from '@/lib/services/employeeLedgerDualWrite';
import { LATE_DEDUCTION_ENTRY_REASON, LATE_DEDUCTION_REF_TYPE } from './constants';
import { buildLateDeductionLedgerNote } from './messages';

type DbLike = { request: () => sql.Request };

export { buildLateDeductionLedgerNote };

/**
 * Insert or reuse a single active ledger debit for this attendance late deduction.
 * Idempotent via UX_TblEmpLedgerEntry_ActiveRefReason (RefType+RefID+EntryReason).
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

  const existing = await db
    .request()
    .input('refType', sql.NVarChar(80), LATE_DEDUCTION_REF_TYPE)
    .input('refId', sql.Int, params.attendanceId)
    .input('reason', sql.NVarChar(40), LATE_DEDUCTION_ENTRY_REASON)
    .query(`
      SELECT TOP 1 LedgerEntryID, Amount
      FROM dbo.TblEmpLedgerEntry
      WHERE RefType = @refType
        AND RefID = @refId
        AND EntryReason = @reason
        AND IsVoided = 0
    `);

  if (existing.recordset[0]) {
    const id = Number(existing.recordset[0].LedgerEntryID);
    const prevAmount = Number(existing.recordset[0].Amount);
    if (prevAmount === params.amount) {
      return { ledgerEntryId: id, outcome: 'unchanged' };
    }
    await db
      .request()
      .input('id', sql.Int, id)
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
    return { ledgerEntryId: id, outcome: 'updated' };
  }

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
