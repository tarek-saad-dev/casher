import 'server-only';

import { getPool, sql } from '@/lib/db';
import { isUniqueConstraintError, type DailyTargetRow } from './employee-daily-target.repository';
import {
  EMP_LEDGER_DIRECTION_CREDIT,
  EMP_LEDGER_REASON_TARGET,
  EMP_LEDGER_REF_TYPE_DAILY_TARGET,
  buildDailyTargetLedgerNote,
  payrollMonthFromWorkDate,
  roundLedgerAmount,
} from './employee-daily-target-ledger.constants';

export { isUniqueConstraintError };

export interface TargetLedgerEntryRow {
  id: number;
  empId: number;
  entryDate: string;
  entryDirection: string;
  entryReason: string;
  amount: number;
  payrollMonth: string | null;
  refType: string | null;
  refId: number | null;
  cashMoveId: number | null;
  notes: string | null;
  isVoided: boolean;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string | null;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function mapLedger(row: Record<string, unknown>): TargetLedgerEntryRow {
  return {
    id: Number(row.ID),
    empId: Number(row.EmpID),
    entryDate: toDateStr(row.EntryDate),
    entryDirection: String(row.EntryDirection),
    entryReason: String(row.EntryReason),
    amount: Number(row.Amount),
    payrollMonth: row.PayrollMonth == null ? null : String(row.PayrollMonth),
    refType: row.RefType == null ? null : String(row.RefType),
    refId: row.RefID == null ? null : Number(row.RefID),
    cashMoveId: row.CashMoveID == null ? null : Number(row.CashMoveID),
    notes: row.Notes == null ? null : String(row.Notes),
    isVoided: Boolean(row.IsVoided),
    createdByUserId: row.CreatedByUserID == null ? null : Number(row.CreatedByUserID),
    createdAt: String(row.CreatedAt ?? ''),
    updatedAt: row.UpdatedAt == null ? null : String(row.UpdatedAt),
  };
}

function mapDaily(row: Record<string, unknown>): DailyTargetRow {
  return {
    id: Number(row.ID),
    empId: Number(row.EmpID),
    workDate: toDateStr(row.WorkDate),
    targetPlanId: Number(row.TargetPlanID),
    netSalesAfterDiscount: Number(row.NetSalesAfterDiscount),
    targetAmount: Number(row.TargetAmount),
    calculationBreakdownJson:
      row.CalculationBreakdownJson == null ? null : String(row.CalculationBreakdownJson),
    calculationVersion: String(row.CalculationVersion ?? 'v1'),
    status: String(row.Status) as DailyTargetRow['status'],
    generatedByUserId: row.GeneratedByUserID == null ? null : Number(row.GeneratedByUserID),
    generatedAt: String(row.GeneratedAt ?? ''),
    updatedAt: row.UpdatedAt == null ? null : String(row.UpdatedAt),
  };
}

export async function lockTargetLedgerEntriesForRef(
  transaction: sql.Transaction,
  dailyTargetId: number,
): Promise<TargetLedgerEntryRow[]> {
  const result = await new sql.Request(transaction)
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_TARGET)
    .input('refId', sql.Int, dailyTargetId)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_TARGET)
    .query(`
      SELECT
        ID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, Notes,
        IsVoided, CreatedByUserID, CreatedAt, UpdatedAt
      FROM dbo.TblEmpLedgerEntry WITH (UPDLOCK, HOLDLOCK)
      WHERE RefType = @refType
        AND RefID = @refId
        AND EntryReason = @entryReason
      ORDER BY ID
    `);
  return (result.recordset as Record<string, unknown>[]).map(mapLedger);
}

export async function insertTargetLedgerEntry(
  transaction: sql.Transaction,
  params: {
    empId: number;
    workDate: string;
    amount: number;
    dailyTargetId: number;
    actorUserId: number | null;
  },
): Promise<number> {
  const amount = roundLedgerAmount(params.amount);
  const result = await new sql.Request(transaction)
    .input('empId', sql.Int, params.empId)
    .input('entryDate', sql.Date, params.workDate)
    .input('direction', sql.NVarChar(10), EMP_LEDGER_DIRECTION_CREDIT)
    .input('reason', sql.NVarChar(40), EMP_LEDGER_REASON_TARGET)
    .input('amount', sql.Decimal(12, 2), amount)
    .input('payrollMonth', sql.NVarChar(7), payrollMonthFromWorkDate(params.workDate))
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_TARGET)
    .input('refId', sql.Int, params.dailyTargetId)
    .input('notes', sql.NVarChar(500), buildDailyTargetLedgerNote(params.workDate))
    .input('createdBy', sql.Int, params.actorUserId)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      OUTPUT INSERTED.ID
      VALUES (
        @empId, @entryDate, @direction, @reason, @amount,
        @payrollMonth, @refType, @refId, NULL, NULL,
        @notes, 0, @createdBy, SYSDATETIME()
      )
    `);
  return Number((result.recordset[0] as { ID: number }).ID);
}

export async function updateTargetLedgerEntry(
  transaction: sql.Transaction,
  params: {
    ledgerEntryId: number;
    empId: number;
    workDate: string;
    amount: number;
  },
): Promise<void> {
  const amount = roundLedgerAmount(params.amount);
  await new sql.Request(transaction)
    .input('id', sql.Int, params.ledgerEntryId)
    .input('empId', sql.Int, params.empId)
    .input('entryDate', sql.Date, params.workDate)
    .input('amount', sql.Decimal(12, 2), amount)
    .input('payrollMonth', sql.NVarChar(7), payrollMonthFromWorkDate(params.workDate))
    .input('notes', sql.NVarChar(500), buildDailyTargetLedgerNote(params.workDate))
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET EmpID = @empId,
          EntryDate = @entryDate,
          Amount = @amount,
          PayrollMonth = @payrollMonth,
          Notes = @notes,
          UpdatedAt = SYSDATETIME()
      WHERE ID = @id
    `);
}

export async function deleteTargetLedgerEntry(
  transaction: sql.Transaction,
  ledgerEntryId: number,
): Promise<void> {
  await new sql.Request(transaction)
    .input('id', sql.Int, ledgerEntryId)
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_TARGET)
    .input('reason', sql.NVarChar(40), EMP_LEDGER_REASON_TARGET)
    .query(`
      DELETE FROM dbo.TblEmpLedgerEntry
      WHERE ID = @id
        AND RefType = @refType
        AND EntryReason = @reason
    `);
}

export async function getDailyTargetById(dailyTargetId: number): Promise<DailyTargetRow | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('id', sql.Int, dailyTargetId)
    .query(`
      SELECT
        ID, EmpID, WorkDate, TargetPlanID,
        NetSalesAfterDiscount, TargetAmount,
        CalculationBreakdownJson, CalculationVersion, Status,
        GeneratedByUserID, GeneratedAt, UpdatedAt
      FROM dbo.TblEmpDailyTarget
      WHERE ID = @id
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapDaily(row) : null;
}

export async function listDailyTargetsForLedgerScope(params: {
  workDate?: string;
  year?: number;
  month?: number;
  empIds?: number[] | null;
}): Promise<DailyTargetRow[]> {
  const db = await getPool();
  const request = db.request();
  const filters: string[] = [];

  if (params.workDate) {
    request.input('workDate', sql.Date, params.workDate);
    filters.push('WorkDate = @workDate');
  } else if (params.year != null && params.month != null) {
    const ym = `${params.year}-${String(params.month).padStart(2, '0')}`;
    request.input('monthPrefix', sql.NVarChar(7), ym);
    filters.push(`CONVERT(char(7), WorkDate, 126) = @monthPrefix`);
  } else {
    throw new Error('listDailyTargetsForLedgerScope requires workDate or year+month');
  }

  if (params.empIds != null && params.empIds.length > 0) {
    const placeholders = params.empIds.map((_, i) => {
      const name = `emp${i}`;
      request.input(name, sql.Int, params.empIds![i]);
      return `@${name}`;
    });
    filters.push(`EmpID IN (${placeholders.join(',')})`);
  }

  const result = await request.query(`
    SELECT
      ID, EmpID, WorkDate, TargetPlanID,
      NetSalesAfterDiscount, TargetAmount,
      CalculationBreakdownJson, CalculationVersion, Status,
      GeneratedByUserID, GeneratedAt, UpdatedAt
    FROM dbo.TblEmpDailyTarget
    WHERE ${filters.join(' AND ')}
    ORDER BY EmpID, WorkDate, ID
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapDaily);
}

/** Active + voided rows for target refs in scope (for reconcile / duplicate detection). */
export async function listTargetLedgerEntriesForScope(params: {
  workDate?: string;
  year?: number;
  month?: number;
  empIds?: number[] | null;
  includeOrphansOutsideScope?: boolean;
}): Promise<TargetLedgerEntryRow[]> {
  const db = await getPool();
  const request = db
    .request()
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_TARGET)
    .input('reason', sql.NVarChar(40), EMP_LEDGER_REASON_TARGET);

  const filters: string[] = [
    'l.RefType = @refType',
    'l.EntryReason = @reason',
    'l.RefID IS NOT NULL',
  ];

  if (params.workDate) {
    request.input('workDate', sql.Date, params.workDate);
    filters.push('l.EntryDate = @workDate');
  } else if (params.year != null && params.month != null) {
    const ym = `${params.year}-${String(params.month).padStart(2, '0')}`;
    request.input('monthPrefix', sql.NVarChar(7), ym);
    filters.push(`(l.PayrollMonth = @monthPrefix OR CONVERT(char(7), l.EntryDate, 126) = @monthPrefix)`);
  }

  if (params.empIds != null && params.empIds.length > 0) {
    const placeholders = params.empIds.map((_, i) => {
      const name = `emp${i}`;
      request.input(name, sql.Int, params.empIds![i]);
      return `@${name}`;
    });
    filters.push(`l.EmpID IN (${placeholders.join(',')})`);
  }

  const result = await request.query(`
    SELECT
      l.ID, l.EmpID, l.EntryDate, l.EntryDirection, l.EntryReason, l.Amount,
      l.PayrollMonth, l.RefType, l.RefID, l.CashMoveID, l.Notes,
      l.IsVoided, l.CreatedByUserID, l.CreatedAt, l.UpdatedAt
    FROM dbo.TblEmpLedgerEntry l
    WHERE ${filters.join(' AND ')}
    ORDER BY l.RefID, l.ID
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapLedger);
}

export async function listOrphanTargetLedgerEntries(params: {
  workDate?: string;
  year?: number;
  month?: number;
  empIds?: number[] | null;
}): Promise<TargetLedgerEntryRow[]> {
  const db = await getPool();
  const request = db
    .request()
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_TARGET)
    .input('reason', sql.NVarChar(40), EMP_LEDGER_REASON_TARGET);

  const filters: string[] = [
    'l.RefType = @refType',
    'l.EntryReason = @reason',
    'l.RefID IS NOT NULL',
    't.ID IS NULL',
  ];

  if (params.workDate) {
    request.input('workDate', sql.Date, params.workDate);
    filters.push('l.EntryDate = @workDate');
  } else if (params.year != null && params.month != null) {
    const ym = `${params.year}-${String(params.month).padStart(2, '0')}`;
    request.input('monthPrefix', sql.NVarChar(7), ym);
    filters.push(`(l.PayrollMonth = @monthPrefix OR CONVERT(char(7), l.EntryDate, 126) = @monthPrefix)`);
  }

  if (params.empIds != null && params.empIds.length > 0) {
    const placeholders = params.empIds.map((_, i) => {
      const name = `emp${i}`;
      request.input(name, sql.Int, params.empIds![i]);
      return `@${name}`;
    });
    filters.push(`l.EmpID IN (${placeholders.join(',')})`);
  }

  const result = await request.query(`
    SELECT
      l.ID, l.EmpID, l.EntryDate, l.EntryDirection, l.EntryReason, l.Amount,
      l.PayrollMonth, l.RefType, l.RefID, l.CashMoveID, l.Notes,
      l.IsVoided, l.CreatedByUserID, l.CreatedAt, l.UpdatedAt
    FROM dbo.TblEmpLedgerEntry l
    LEFT JOIN dbo.TblEmpDailyTarget t ON t.ID = l.RefID
    WHERE ${filters.join(' AND ')}
    ORDER BY l.ID
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapLedger);
}

export async function getTargetPlanMeta(planId: number): Promise<{
  inputBasis: string;
  conversionDays: number;
} | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('planId', sql.Int, planId)
    .query(`
      SELECT InputBasis, ConversionDays
      FROM dbo.TblEmpTargetPlan
      WHERE ID = @planId
    `);
  const row = result.recordset[0] as { InputBasis: string; ConversionDays: number } | undefined;
  if (!row) return null;
  return { inputBasis: String(row.InputBasis), conversionDays: Number(row.ConversionDays) };
}

export async function listTiersSnapshotForPlan(planId: number): Promise<
  Array<{
    sortOrder: number;
    inputStartAmount: number;
    dailyStartAmount: number;
    ratePercent: number;
  }>
> {
  const db = await getPool();
  const result = await db
    .request()
    .input('planId', sql.Int, planId)
    .query(`
      SELECT SortOrder, InputStartAmount, DailyStartAmount, RatePercent
      FROM dbo.TblEmpTargetTier
      WHERE TargetPlanID = @planId
      ORDER BY SortOrder, ID
    `);
  return (result.recordset as Record<string, unknown>[]).map((r) => ({
    sortOrder: Number(r.SortOrder),
    inputStartAmount: Number(r.InputStartAmount),
    dailyStartAmount: Number(r.DailyStartAmount),
    ratePercent: Number(r.RatePercent),
  }));
}
