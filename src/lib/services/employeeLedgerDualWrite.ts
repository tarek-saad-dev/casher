import 'server-only';

import { getPool, sql } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';

export const EMP_LEDGER_REF_TYPE_DAILY_PAYROLL = 'TblEmpDailyPayroll';
export const EMP_LEDGER_REF_TYPE_CASH_MOVE = 'TblCashMove';
export const EMP_LEDGER_REASON_HOURLY_WAGE = 'hourly_wage';
export const EMP_LEDGER_REASON_ADVANCE = 'advance';
export const EMP_LEDGER_REASON_EMPLOYEE_FUNDING = 'employee_funding';

export interface PayrollRowForLedger {
  payrollId: number;
  empId: number;
  branchId: number;
  workDate: string;
  attendanceId: number | null;
  dailyWage: number;
}

export interface HourlyWageLedgerSyncResult {
  inserted: number;
  updated: number;
  voided: number;
  skipped: number;
}

export interface AdvanceEmployeeMapping {
  empId: number;
  empName: string | null;
}

export type AdvanceEmployeeResolution =
  | { kind: 'not_advance' }
  | ({ kind: 'resolved' } & AdvanceEmployeeMapping)
  | { kind: 'unresolved' };

export type AdvanceLedgerUpsertOutcome = 'inserted' | 'updated';

export type RevenueEmployeeMapping = AdvanceEmployeeMapping;

export type RevenueEmployeeResolution =
  | { kind: 'not_revenue' }
  | ({ kind: 'resolved' } & RevenueEmployeeMapping)
  | { kind: 'unresolved' };

export function isMissingLedgerTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('tblempledgerentry') && (
    lower.includes('invalid object name') ||
    lower.includes('does not exist')
  );
}

export function payrollMonthFromWorkDate(workDate: string): string {
  return workDate.slice(0, 7);
}

export function buildHourlyWageLedgerNote(workDate: string): string {
  return `استحقاق يومية/ساعات بتاريخ ${workDate}`;
}

export function buildAdvanceLedgerNote(): string {
  return 'سلفة موظف من الخزنة';
}

export async function resolveAdvanceEmployeeFromExpINID(
  pool: { request: () => sql.Request },
  expINID: number,
  transaction?: sql.Transaction,
): Promise<AdvanceEmployeeResolution> {
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const result = await req
    .input('ExpINID', sql.Int, expINID)
    .query(`
      SELECT TOP 1 m.EmpID AS mapEmpId, e.EmpID AS resolvedEmpId, e.EmpName AS empName
      FROM dbo.TblExpCatEmpMap m
      INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID AND c.ExpINType = N'مصروفات'
      LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
      WHERE m.ExpINID = @ExpINID
        AND m.TxnKind = N'advance'
        AND m.IsActive = 1
      ORDER BY m.ID DESC
    `);

  if (result.recordset.length === 0) {
    return { kind: 'not_advance' };
  }

  const row = result.recordset[0];
  if (row.resolvedEmpId == null) {
    return { kind: 'unresolved' };
  }

  return {
    kind: 'resolved',
    empId: Number(row.resolvedEmpId),
    empName: row.empName != null ? String(row.empName) : null,
  };
}

export async function resolveRevenueEmployeeFromExpINID(
  pool: { request: () => sql.Request },
  expINID: number,
  transaction?: sql.Transaction,
): Promise<RevenueEmployeeResolution> {
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const result = await req
    .input('ExpINID', sql.Int, expINID)
    .query(`
      SELECT TOP 1 m.EmpID AS mapEmpId, e.EmpID AS resolvedEmpId, e.EmpName AS empName
      FROM dbo.TblExpCatEmpMap m
      INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID AND c.ExpINType = N'ايرادات'
      LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
      WHERE m.ExpINID = @ExpINID
        AND m.TxnKind = N'revenue'
        AND m.IsActive = 1
      ORDER BY m.ID DESC
    `);

  if (result.recordset.length === 0) {
    return { kind: 'not_revenue' };
  }

  const row = result.recordset[0];
  if (row.resolvedEmpId == null) {
    return { kind: 'unresolved' };
  }

  return {
    kind: 'resolved',
    empId: Number(row.resolvedEmpId),
    empName: row.empName != null ? String(row.empName) : null,
  };
}

function ledgerRequest(
  pool: { request: () => sql.Request },
  transaction?: sql.Transaction,
): sql.Request {
  return transaction ? new sql.Request(transaction) : pool.request();
}

export async function upsertAdvanceLedgerEntry(
  pool: { request: () => sql.Request },
  params: {
    empId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    createdByUserId?: number | null;
  },
  transaction?: sql.Transaction,
): Promise<AdvanceLedgerUpsertOutcome> {
  if (params.amount <= 0) {
    throw new EmployeeLedgerDualWriteError('مبلغ السلفة يجب أن يكون أكبر من صفر لتسجيل دفتر الموظف');
  }

  const payrollMonth = payrollMonthFromWorkDate(params.entryDate);
  const notes = buildAdvanceLedgerNote();

  const updateResult = await ledgerRequest(pool, transaction)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE)
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
        UpdatedAt       = SYSDATETIME()
      WHERE RefType = @RefType
        AND RefID = @RefID
        AND EntryReason = @EntryReason
        AND IsVoided = 0
    `);

  if (updateResult.rowsAffected[0] > 0) {
    return 'updated';
  }

  // Branch ownership must match the cash move that paid the advance.
  const branchRow = await ledgerRequest(pool, transaction)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .query(`
      SELECT BranchID FROM dbo.TblCashMove WHERE ID = @CashMoveID
    `);
  const branchId = Number(branchRow.recordset[0]?.BranchID);
  if (!Number.isFinite(branchId) || branchId <= 0) {
    throw new EmployeeLedgerDualWriteError(
      'تعذر تحديد فرع حركة الخزنة لتسجيل سلفة دفتر الموظف',
    );
  }

  await ledgerRequest(pool, transaction)
    .input('EmpID', sql.Int, params.empId)
    .input('BranchID', sql.Int, branchId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      VALUES (
        @BranchID, @EmpID, @EntryDate, N'debit', @EntryReason, @Amount,
        @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
        @Notes, 0, @CreatedByUserID, SYSDATETIME()
      )
    `);

  return 'inserted';
}

/**
 * When dual-write is enabled: if ExpINID is an advance category, upsert ledger debit.
 * Returns null when category is not advance-mapped (normal operating expense).
 */
export async function maybeSyncAdvanceLedgerForExpenseCashMove(
  pool: { request: () => sql.Request },
  transaction: sql.Transaction,
  params: {
    cashMoveId: number;
    expINID: number;
    entryDate: string;
    amount: number;
    createdByUserId?: number | null;
  },
): Promise<{ ledgerDualWrite: boolean; outcome?: AdvanceLedgerUpsertOutcome }> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    return { ledgerDualWrite: false };
  }

  const resolution = await resolveAdvanceEmployeeFromExpINID(pool, params.expINID, transaction);
  if (resolution.kind === 'not_advance') {
    return { ledgerDualWrite: false };
  }
  if (resolution.kind === 'unresolved') {
    throw new EmployeeLedgerDualWriteError('تعذر ربط تصنيف السلفة بموظف لتسجيل دفتر الموظف');
  }

  try {
    const outcome = await upsertAdvanceLedgerEntry(pool, {
      empId: resolution.empId,
      cashMoveId: params.cashMoveId,
      entryDate: params.entryDate,
      amount: params.amount,
      createdByUserId: params.createdByUserId,
    }, transaction);
    return { ledgerDualWrite: true, outcome };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerDualWriteError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }
    if (err instanceof EmployeeLedgerDualWriteError) {
      throw err;
    }
    throw new EmployeeLedgerDualWriteError(
      `فشل تسجيل السلفة في دفتر الموظف: ${message}`,
    );
  }
}

export async function syncAdvanceLedgerForDeductionCashMove(
  pool: { request: () => sql.Request },
  transaction: sql.Transaction,
  params: {
    empId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    createdByUserId?: number | null;
  },
): Promise<{ ledgerDualWrite: boolean; outcome?: AdvanceLedgerUpsertOutcome }> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    return { ledgerDualWrite: false };
  }

  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerDualWriteError('تعذر ربط السلفة بموظف لتسجيل دفتر الموظف');
  }

  try {
    const outcome = await upsertAdvanceLedgerEntry(pool, params, transaction);
    return { ledgerDualWrite: true, outcome };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerDualWriteError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }
    if (err instanceof EmployeeLedgerDualWriteError) {
      throw err;
    }
    throw new EmployeeLedgerDualWriteError(
      `فشل تسجيل السلفة في دفتر الموظف: ${message}`,
    );
  }
}

export function formatLedgerEntryDate(value: unknown): string {
  return formatDateValue(value);
}

export async function fetchGeneratedPayrollRowsForLedger(
  pool: { request: () => sql.Request },
  workDate: string,
  transaction?: sql.Transaction,
  branchId?: number,
): Promise<PayrollRowForLedger[]> {
  const req = transaction ? new sql.Request(transaction) : pool.request();
  req.input('WorkDate', sql.Date, workDate);
  if (branchId != null) req.input('BranchID', sql.Int, branchId);
  const result = await req.query(`
      SELECT
        p.ID          AS payrollId,
        p.EmpID       AS empId,
        p.BranchID    AS branchId,
        p.WorkDate    AS workDate,
        p.AttendanceID AS attendanceId,
        p.DailyWage   AS dailyWage
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.WorkDate = @WorkDate
        AND p.Status = N'Generated'
        ${branchId != null ? 'AND p.BranchID = @BranchID' : ''}
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    payrollId: Number(row.payrollId),
    empId: Number(row.empId),
    branchId: Number(row.branchId),
    workDate: formatDateValue(row.workDate),
    attendanceId: row.attendanceId != null ? Number(row.attendanceId) : null,
    dailyWage: Number(row.dailyWage ?? 0),
  }));
}

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export async function upsertHourlyWageLedgerEntry(
  pool: { request: () => sql.Request },
  row: PayrollRowForLedger,
  transaction?: sql.Transaction,
): Promise<'inserted' | 'updated' | 'voided' | 'skipped'> {
  const payrollMonth = payrollMonthFromWorkDate(row.workDate);
  const notes = buildHourlyWageLedgerNote(row.workDate);

  if (row.dailyWage <= 0) {
    const voidResult = await ledgerRequest(pool, transaction)
      .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL)
      .input('RefID', sql.Int, row.payrollId)
      .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_HOURLY_WAGE)
      .query(`
        UPDATE dbo.TblEmpLedgerEntry
        SET
          IsVoided   = 1,
          VoidReason = N'أجر يومي صفر بعد إعادة التوليد',
          UpdatedAt  = SYSDATETIME()
        WHERE RefType = @RefType
          AND RefID = @RefID
          AND EntryReason = @EntryReason
          AND IsVoided = 0
      `);
    return voidResult.rowsAffected[0] > 0 ? 'voided' : 'skipped';
  }

  const updateResult = await ledgerRequest(pool, transaction)
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.workDate)
    .input('Amount', sql.Decimal(12, 2), row.dailyWage)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('AttendanceID', sql.Int, row.attendanceId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL)
    .input('RefID', sql.Int, row.payrollId)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_HOURLY_WAGE)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET
        EmpID        = @EmpID,
        EntryDate    = @EntryDate,
        Amount       = @Amount,
        PayrollMonth = @PayrollMonth,
        AttendanceID = @AttendanceID,
        Notes        = @Notes,
        UpdatedAt    = SYSDATETIME()
      WHERE RefType = @RefType
        AND RefID = @RefID
        AND EntryReason = @EntryReason
        AND IsVoided = 0
    `);

  if (updateResult.rowsAffected[0] > 0) {
    return 'updated';
  }

  await ledgerRequest(pool, transaction)
    .input('EmpID', sql.Int, row.empId)
    .input('BranchID', sql.Int, row.branchId)
    .input('EntryDate', sql.Date, row.workDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_HOURLY_WAGE)
    .input('Amount', sql.Decimal(12, 2), row.dailyWage)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('AttendanceID', sql.Int, row.attendanceId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL)
    .input('RefID', sql.Int, row.payrollId)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedAt
      )
      VALUES (
        @BranchID, @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
        @PayrollMonth, @RefType, @RefID, NULL, @AttendanceID,
        @Notes, 0, SYSDATETIME()
      )
    `);

  return 'inserted';
}

export async function syncHourlyWageLedgerForWorkDate(
  pool: { request: () => sql.Request },
  workDate: string,
  transaction?: sql.Transaction,
  branchId?: number,
): Promise<HourlyWageLedgerSyncResult> {
  const rows = await fetchGeneratedPayrollRowsForLedger(
    pool,
    workDate,
    transaction,
    branchId,
  );
  const result: HourlyWageLedgerSyncResult = {
    inserted: 0,
    updated: 0,
    voided: 0,
    skipped: 0,
  };

  for (const row of rows) {
    const outcome = await upsertHourlyWageLedgerEntry(pool, row, transaction);
    result[outcome]++;
  }

  return result;
}

export class EmployeeLedgerDualWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerDualWriteError';
  }
}

/**
 * Runs payroll generate + optional ledger dual-write in one transaction when enabled.
 */
export async function runDailyPayrollGenerateWithOptionalLedger(
  workDate: string,
  options: { notesPrefix?: string; branchId: number },
): Promise<{
  result: import('@/lib/payroll/dailyPayrollGenerateCore').DailyPayrollGenerateResult;
  ledgerDualWrite: boolean;
  ledgerSync?: HourlyWageLedgerSyncResult;
}> {
  const db = await getPool();
  const dualWrite = isEmployeeLedgerDualWriteEnabled();
  const branchId = Number(options.branchId);
  if (!Number.isFinite(branchId) || branchId <= 0) {
    throw new EmployeeLedgerDualWriteError('branchId مطلوب لتوليد اليومية');
  }

  if (!dualWrite) {
    const result = await executeDailyPayrollGenerateOnly(db, workDate, options);
    return { result, ledgerDualWrite: false };
  }

  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    const result = await executeDailyPayrollGenerateOnly(db, workDate, {
      ...options,
      transaction,
    });
    const ledgerSync = await syncHourlyWageLedgerForWorkDate(
      db,
      workDate,
      transaction,
      branchId,
    );
    await transaction.commit();
    return { result, ledgerDualWrite: true, ledgerSync };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }
    if (err instanceof EmployeeLedgerDualWriteError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerDualWriteError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }
    throw err;
  }
}

async function executeDailyPayrollGenerateOnly(
  db: { request: () => sql.Request },
  workDate: string,
  options: { notesPrefix?: string; transaction?: sql.Transaction; branchId: number },
) {
  const { executeDailyPayrollGenerate } = await import('@/lib/payroll/dailyPayrollGenerateCore');
  try {
    return await executeDailyPayrollGenerate(db, workDate, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerDualWriteError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }
    throw err;
  }
}
