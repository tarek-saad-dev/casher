import 'server-only';

import { sql } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import {
  EMP_LEDGER_REASON_EMPLOYEE_FUNDING,
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
  EmployeeLedgerDualWriteError,
  isMissingLedgerTableError,
  payrollMonthFromWorkDate,
  resolveRevenueEmployeeFromExpINID,
} from '@/lib/services/employeeLedgerDualWrite';

/** Shared manual funding category written by executeEmployeeFunding — never wipe via map sync. */
const MANUAL_EMPLOYEE_FUNDING_CATEGORY_NAME = 'تمويل من موظف';

export type EmployeeFundingSyncOutcome =
  | 'inserted'
  | 'updated'
  | 'deleted'
  | 'skipped_not_income'
  | 'skipped_payroll_mirror'
  | 'skipped_not_mapped'
  | 'skipped_manual_funding_category'
  | 'skipped_flag_off';

export type EmployeeFundingSyncResult = {
  outcome: EmployeeFundingSyncOutcome;
  ledgerDualWrite: boolean;
  empId?: number;
  amount?: number;
  entryDate?: string;
  categoryName?: string | null;
};

type CashMoveForFundingSync = {
  ID: number;
  invType: string;
  inOut: string;
  ExpINID: number | null;
  GrandTolal: number;
  invDate: string | Date;
  IsEmployeePayrollIncome: boolean | number;
  CategoryName: string | null;
};

function ledgerRequest(transaction: sql.Transaction): sql.Request {
  return new sql.Request(transaction);
}

function formatEntryDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function buildFundingNotes(categoryName: string | null | undefined, cashMoveId: number): string {
  const cat = categoryName?.trim() || 'بدون فئة';
  return `تمويل من موظف للمحل — فئة: ${cat} — CashMove#${cashMoveId}`;
}

async function loadCashMoveForFundingSync(
  transaction: sql.Transaction,
  cashMoveId: number,
): Promise<CashMoveForFundingSync | null> {
  const result = await ledgerRequest(transaction)
    .input('CashMoveID', sql.Int, cashMoveId)
    .query(`
      SELECT TOP 1
        cm.ID,
        cm.invType,
        cm.inOut,
        cm.ExpINID,
        cm.GrandTolal,
        cm.invDate,
        ISNULL(cm.IsEmployeePayrollIncome, 0) AS IsEmployeePayrollIncome,
        cat.CatName AS CategoryName
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      WHERE cm.ID = @CashMoveID
    `);

  return (result.recordset[0] as CashMoveForFundingSync | undefined) ?? null;
}

async function deleteFundingLedgerForCashMove(
  transaction: sql.Transaction,
  cashMoveId: number,
): Promise<boolean> {
  const result = await ledgerRequest(transaction)
    .input('CashMoveID', sql.Int, cashMoveId)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_EMPLOYEE_FUNDING)
    .query(`
      DELETE FROM dbo.TblEmpLedgerEntry
      WHERE CashMoveID = @CashMoveID
        AND EntryReason = @EntryReason
    `);
  return Number(result.rowsAffected[0] ?? 0) > 0;
}

async function upsertFundingFromCashMove(
  transaction: sql.Transaction,
  params: {
    empId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    notes: string;
    createdByUserId?: number | null;
  },
): Promise<'inserted' | 'updated'> {
  const payrollMonth = payrollMonthFromWorkDate(params.entryDate);

  const updateResult = await ledgerRequest(transaction)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), params.notes)
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_EMPLOYEE_FUNDING)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET
        EmpID           = @EmpID,
        EntryDate       = @EntryDate,
        Amount          = @Amount,
        PayrollMonth    = @PayrollMonth,
        CashMoveID      = @CashMoveID,
        Notes           = @Notes,
        CreatedByUserID = COALESCE(@CreatedByUserID, CreatedByUserID),
        UpdatedAt       = SYSDATETIME(),
        IsVoided        = 0,
        VoidReason      = NULL
      WHERE RefType = @RefType
        AND RefID = @RefID
        AND EntryReason = @EntryReason
        AND IsVoided = 0
    `);

  if (Number(updateResult.rowsAffected[0] ?? 0) > 0) {
    return 'updated';
  }

  // Revive voided row for same ref if present
  const reviveResult = await ledgerRequest(transaction)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), params.notes)
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_EMPLOYEE_FUNDING)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET
        EmpID           = @EmpID,
        EntryDate       = @EntryDate,
        Amount          = @Amount,
        PayrollMonth    = @PayrollMonth,
        CashMoveID      = @CashMoveID,
        Notes           = @Notes,
        CreatedByUserID = COALESCE(@CreatedByUserID, CreatedByUserID),
        UpdatedAt       = SYSDATETIME(),
        IsVoided        = 0,
        VoidReason      = NULL
      WHERE RefType = @RefType
        AND RefID = @RefID
        AND EntryReason = @EntryReason
        AND IsVoided = 1
    `);

  if (Number(reviveResult.rowsAffected[0] ?? 0) > 0) {
    return 'updated';
  }

  await ledgerRequest(transaction)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_EMPLOYEE_FUNDING)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), params.notes)
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      VALUES (
        @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
        @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
        @Notes, 0, @CreatedByUserID, SYSDATETIME()
      )
    `);

  return 'inserted';
}

async function attachEmpId(
  transaction: sql.Transaction,
  cashMoveId: number,
  empId: number,
): Promise<void> {
  await ledgerRequest(transaction)
    .input('CashMoveID', sql.Int, cashMoveId)
    .input('EmpID', sql.Int, empId)
    .query(`
      UPDATE dbo.TblCashMove
      SET EmpID = @EmpID
      WHERE ID = @CashMoveID
    `);
}

/**
 * Central idempotent sync: CashMove → employee_funding ledger via TblExpCatEmpMap only.
 * Must run inside the same SQL transaction as the CashMove write.
 */
export async function syncEmployeeFundingFromCashMove(
  transaction: sql.Transaction,
  cashMoveId: number,
  options?: {
    createdByUserId?: number | null;
    /** When true, ignore dual-write flag (used by admin backfill). */
    force?: boolean;
  },
): Promise<EmployeeFundingSyncResult> {
  if (!options?.force && !isEmployeeLedgerDualWriteEnabled()) {
    return { outcome: 'skipped_flag_off', ledgerDualWrite: false };
  }

  try {
    const cashMove = await loadCashMoveForFundingSync(transaction, cashMoveId);
    if (!cashMove) {
      throw new EmployeeLedgerDualWriteError(`حركة الخزنة #${cashMoveId} غير موجودة لمزامنة التمويل`);
    }

    const isIncomeIn =
      (cashMove.invType === 'ايرادات' || cashMove.invType === 'إيرادات')
      && cashMove.inOut === 'in';

    if (!isIncomeIn) {
      return { outcome: 'skipped_not_income', ledgerDualWrite: false };
    }

    if (Boolean(cashMove.IsEmployeePayrollIncome)) {
      const deleted = await deleteFundingLedgerForCashMove(transaction, cashMoveId);
      return {
        outcome: deleted ? 'deleted' : 'skipped_payroll_mirror',
        ledgerDualWrite: deleted,
        categoryName: cashMove.CategoryName,
      };
    }

    if (cashMove.ExpINID == null) {
      const deleted = await deleteFundingLedgerForCashMove(transaction, cashMoveId);
      return {
        outcome: deleted ? 'deleted' : 'skipped_not_mapped',
        ledgerDualWrite: deleted,
      };
    }

    // Shared manual funding category is written by executeEmployeeFunding — do not wipe it.
    if (cashMove.CategoryName === MANUAL_EMPLOYEE_FUNDING_CATEGORY_NAME) {
      return {
        outcome: 'skipped_manual_funding_category',
        ledgerDualWrite: false,
        categoryName: cashMove.CategoryName,
      };
    }

    const pool = { request: () => new sql.Request(transaction) };
    const resolution = await resolveRevenueEmployeeFromExpINID(pool, cashMove.ExpINID, transaction);

    if (resolution.kind === 'not_revenue') {
      const deleted = await deleteFundingLedgerForCashMove(transaction, cashMoveId);
      return {
        outcome: deleted ? 'deleted' : 'skipped_not_mapped',
        ledgerDualWrite: deleted,
        categoryName: cashMove.CategoryName,
      };
    }

    if (resolution.kind === 'unresolved') {
      throw new EmployeeLedgerDualWriteError(
        `تعذر ربط تصنيف الإيراد ExpINID=${cashMove.ExpINID} بموظف نشط لتسجيل التمويل`,
      );
    }

    const amount = Math.abs(Number(cashMove.GrandTolal ?? 0));
    if (amount <= 0) {
      throw new EmployeeLedgerDualWriteError('مبلغ الإيراد يجب أن يكون أكبر من صفر لتسجيل التمويل');
    }

    const entryDate = formatEntryDate(cashMove.invDate);
    const notes = buildFundingNotes(cashMove.CategoryName, cashMoveId);

    await attachEmpId(transaction, cashMoveId, resolution.empId);
    const upsertOutcome = await upsertFundingFromCashMove(transaction, {
      empId: resolution.empId,
      cashMoveId,
      entryDate,
      amount,
      notes,
      createdByUserId: options?.createdByUserId,
    });

    return {
      outcome: upsertOutcome,
      ledgerDualWrite: true,
      empId: resolution.empId,
      amount,
      entryDate,
      categoryName: cashMove.CategoryName,
    };
  } catch (err) {
    if (err instanceof EmployeeLedgerDualWriteError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerDualWriteError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }
    throw new EmployeeLedgerDualWriteError(`فشل مزامنة تمويل الموظف من حركة الخزنة: ${message}`);
  }
}
