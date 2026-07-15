import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { validateLedgerMonth } from '@/lib/services/employeeLedgerService';
import {
  EmployeeLedgerDualWriteError,
  isMissingLedgerTableError,
} from '@/lib/services/employeeLedgerDualWrite';
import { syncEmployeeFundingFromCashMove } from '@/lib/services/employeeLedgerFundingSyncService';

export type FundingBackfillPreviewRow = {
  cashMoveId: number;
  empId: number;
  empName: string | null;
  entryDate: string;
  amount: number;
  categoryName: string | null;
  expInId: number;
  action: 'insert' | 'update' | 'skip';
  reason: string;
};

export type FundingBackfillCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
};

export type FundingReconciliationEmployeeRow = {
  empId: number;
  empName: string;
  linkedRevenueTotal: number;
  ledgerFundingTotal: number;
  difference: number;
  missingCashMoveIds: number[];
  duplicateLedgerIds: number[];
};

export type FundingBackfillResult = {
  success: boolean;
  dryRun: boolean;
  month: string;
  flagEnabled: boolean;
  counts: FundingBackfillCounts;
  previewRows: FundingBackfillPreviewRow[];
  byEmployee: Array<{ empId: number; empName: string; total: number; count: number }>;
  reconciliation: FundingReconciliationEmployeeRow[];
  errors: string[];
};

function fmtDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

type CandidateRow = {
  cashMoveId: number;
  empId: number;
  empName: string | null;
  invDate: string | Date;
  amount: number;
  categoryName: string | null;
  expInId: number;
  hasActiveFunding: boolean;
  activeFundingAmount: number | null;
};

function monthBounds(month: string): { startDate: string; endDate: string } {
  const [yearStr, monthStr] = month.split('-');
  return getMonthDateRange(parseInt(yearStr, 10), parseInt(monthStr, 10));
}

async function loadCandidates(
  pool: Awaited<ReturnType<typeof getPool>>,
  month: string,
  empId: number | null,
): Promise<CandidateRow[]> {
  const { startDate, endDate } = monthBounds(month);
  const req = pool.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('empId', sql.Int, empId);

  const result = await req.query(`
    SELECT
      cm.ID AS cashMoveId,
      map.EmpID AS empId,
      e.EmpName AS empName,
      cm.invDate,
      cm.GrandTolal AS amount,
      cat.CatName AS categoryName,
      cm.ExpINID AS expInId,
      CASE WHEN funding.ID IS NOT NULL THEN 1 ELSE 0 END AS hasActiveFunding,
      funding.Amount AS activeFundingAmount
    FROM dbo.TblCashMove cm
    INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID AND cat.ExpINType = N'ايرادات'
    CROSS APPLY (
      SELECT TOP 1 m.EmpID
      FROM dbo.TblExpCatEmpMap m
      WHERE m.ExpINID = cm.ExpINID
        AND m.TxnKind = N'revenue'
        AND m.IsActive = 1
      ORDER BY m.ID DESC
    ) map
    LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    OUTER APPLY (
      SELECT TOP 1 l.ID, l.Amount
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.CashMoveID = cm.ID
        AND l.EntryReason = N'employee_funding'
        AND l.IsVoided = 0
      ORDER BY l.ID DESC
    ) funding
    WHERE cm.invType = N'ايرادات'
      AND cm.inOut = N'in'
      AND cm.invDate >= @startDate
      AND cm.invDate <= @endDate
      AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
      AND (@empId IS NULL OR map.EmpID = @empId)
    ORDER BY cm.invDate, cm.ID
  `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    cashMoveId: Number(row.cashMoveId),
    empId: Number(row.empId),
    empName: row.empName != null ? String(row.empName) : null,
    invDate: row.invDate as string | Date,
    amount: Math.abs(Number(row.amount ?? 0)),
    categoryName: row.categoryName != null ? String(row.categoryName) : null,
    expInId: Number(row.expInId),
    hasActiveFunding: Boolean(row.hasActiveFunding),
    activeFundingAmount:
      row.activeFundingAmount != null ? Number(row.activeFundingAmount) : null,
  }));
}

export async function buildEmployeeFundingReconciliation(
  month: string,
  empId?: number | null,
): Promise<FundingReconciliationEmployeeRow[]> {
  const monthError = validateLedgerMonth(month);
  if (monthError) throw new EmployeeLedgerDualWriteError(monthError);

  const { startDate, endDate } = monthBounds(month);
  const db = await getPool();
  const req = db.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('empId', sql.Int, empId ?? null);

  const linked = await req.query(`
    SELECT
      map.EmpID AS empId,
      ISNULL(e.EmpName, N'Emp#' + CAST(map.EmpID AS nvarchar(20))) AS empName,
      CAST(SUM(cm.GrandTolal) AS decimal(12,2)) AS linkedTotal
    FROM dbo.TblCashMove cm
    CROSS APPLY (
      SELECT TOP 1 m.EmpID
      FROM dbo.TblExpCatEmpMap m
      WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
      ORDER BY m.ID DESC
    ) map
    LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
      AND cm.invDate >= @startDate AND cm.invDate <= @endDate
      AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
      AND (@empId IS NULL OR map.EmpID = @empId)
    GROUP BY map.EmpID, e.EmpName
  `);

  const funding = await db.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('empId', sql.Int, empId ?? null)
    .query(`
      SELECT
        l.EmpID AS empId,
        ISNULL(e.EmpName, N'Emp#' + CAST(l.EmpID AS nvarchar(20))) AS empName,
        CAST(SUM(l.Amount) AS decimal(12,2)) AS fundingTotal
      FROM dbo.TblEmpLedgerEntry l
      INNER JOIN dbo.TblCashMove cm ON cm.ID = l.CashMoveID
      CROSS APPLY (
        SELECT TOP 1 m.EmpID
        FROM dbo.TblExpCatEmpMap m
        WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
        ORDER BY m.ID DESC
      ) map
      LEFT JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.EntryReason = N'employee_funding'
        AND l.IsVoided = 0
        AND l.EntryDate >= @startDate AND l.EntryDate <= @endDate
        AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
        AND (@empId IS NULL OR l.EmpID = @empId)
      GROUP BY l.EmpID, e.EmpName
    `);

  const missing = await db.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('empId', sql.Int, empId ?? null)
    .query(`
      SELECT map.EmpID AS empId, cm.ID AS cashMoveId
      FROM dbo.TblCashMove cm
      CROSS APPLY (
        SELECT TOP 1 m.EmpID
        FROM dbo.TblExpCatEmpMap m
        WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
        ORDER BY m.ID DESC
      ) map
      WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
        AND cm.invDate >= @startDate AND cm.invDate <= @endDate
        AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
        AND (@empId IS NULL OR map.EmpID = @empId)
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.CashMoveID = cm.ID
            AND l.EntryReason = N'employee_funding'
            AND l.IsVoided = 0
        )
    `);

  const duplicates = await db.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('empId', sql.Int, empId ?? null)
    .query(`
      SELECT l.EmpID AS empId, l.ID AS ledgerId
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.EntryReason = N'employee_funding'
        AND l.IsVoided = 0
        AND l.EntryDate >= @startDate AND l.EntryDate <= @endDate
        AND (@empId IS NULL OR l.EmpID = @empId)
        AND l.CashMoveID IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM dbo.TblEmpLedgerEntry l2
          WHERE l2.CashMoveID = l.CashMoveID
            AND l2.EntryReason = N'employee_funding'
            AND l2.IsVoided = 0
            AND l2.ID <> l.ID
        )
    `);

  const byEmp = new Map<number, FundingReconciliationEmployeeRow>();

  for (const row of linked.recordset) {
    const id = Number(row.empId);
    byEmp.set(id, {
      empId: id,
      empName: String(row.empName),
      linkedRevenueTotal: roundMoney(Number(row.linkedTotal ?? 0)),
      ledgerFundingTotal: 0,
      difference: 0,
      missingCashMoveIds: [],
      duplicateLedgerIds: [],
    });
  }

  for (const row of funding.recordset) {
    const id = Number(row.empId);
    const existing = byEmp.get(id) ?? {
      empId: id,
      empName: String(row.empName),
      linkedRevenueTotal: 0,
      ledgerFundingTotal: 0,
      difference: 0,
      missingCashMoveIds: [],
      duplicateLedgerIds: [],
    };
    existing.ledgerFundingTotal = roundMoney(Number(row.fundingTotal ?? 0));
    byEmp.set(id, existing);
  }

  for (const row of missing.recordset) {
    const id = Number(row.empId);
    const existing = byEmp.get(id);
    if (existing) existing.missingCashMoveIds.push(Number(row.cashMoveId));
  }

  for (const row of duplicates.recordset) {
    const id = Number(row.empId);
    const existing = byEmp.get(id);
    if (existing) existing.duplicateLedgerIds.push(Number(row.ledgerId));
  }

  return [...byEmp.values()]
    .map((row) => ({
      ...row,
      difference: roundMoney(row.linkedRevenueTotal - row.ledgerFundingTotal),
      missingCashMoveIds: [...new Set(row.missingCashMoveIds)].sort((a, b) => a - b),
      duplicateLedgerIds: [...new Set(row.duplicateLedgerIds)].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));
}

/**
 * Preview (dryRun=true) or apply missing employee_funding rows for revenue-mapped incomes.
 * Never modifies TblCashMove. Skips IsEmployeePayrollIncome=1.
 */
export async function runEmployeeFundingBackfill(params: {
  month: string;
  empId?: number | null;
  dryRun?: boolean;
  createdByUserId?: number | null;
}): Promise<FundingBackfillResult> {
  const month = params.month.trim();
  const monthError = validateLedgerMonth(month);
  if (monthError) throw new EmployeeLedgerDualWriteError(monthError);

  const dryRun = params.dryRun !== false;
  const empId = params.empId != null && params.empId > 0 ? params.empId : null;
  const db = await getPool();
  const candidates = await loadCandidates(db, month, empId);

  const counts: FundingBackfillCounts = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
  const previewRows: FundingBackfillPreviewRow[] = [];
  const errors: string[] = [];

  const byEmployeeMap = new Map<number, { empId: number; empName: string; total: number; count: number }>();

  for (const row of candidates) {
    const needsInsert = !row.hasActiveFunding;
    const needsUpdate =
      row.hasActiveFunding
      && row.activeFundingAmount != null
      && Math.abs(row.activeFundingAmount - row.amount) > 0.001;

    if (!needsInsert && !needsUpdate) {
      counts.skipped += 1;
      previewRows.push({
        cashMoveId: row.cashMoveId,
        empId: row.empId,
        empName: row.empName,
        entryDate: fmtDate(row.invDate),
        amount: row.amount,
        categoryName: row.categoryName,
        expInId: row.expInId,
        action: 'skip',
        reason: 'قيد تمويل موجود ومطابق',
      });
      continue;
    }

    const action = needsInsert ? 'insert' : 'update';
    previewRows.push({
      cashMoveId: row.cashMoveId,
      empId: row.empId,
      empName: row.empName,
      entryDate: fmtDate(row.invDate),
      amount: row.amount,
      categoryName: row.categoryName,
      expInId: row.expInId,
      action,
      reason: needsInsert ? 'مفقود — يحتاج إنشاء' : 'مبلغ الدفتر مختلف — يحتاج تحديث',
    });

    const empBucket = byEmployeeMap.get(row.empId) ?? {
      empId: row.empId,
      empName: row.empName ?? `Emp#${row.empId}`,
      total: 0,
      count: 0,
    };
    empBucket.total = roundMoney(empBucket.total + row.amount);
    empBucket.count += 1;
    byEmployeeMap.set(row.empId, empBucket);

    if (dryRun) {
      if (action === 'insert') counts.inserted += 1;
      else counts.updated += 1;
      continue;
    }

    const tx = new sql.Transaction(db);
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const sync = await syncEmployeeFundingFromCashMove(tx, row.cashMoveId, {
        createdByUserId: params.createdByUserId,
        force: true,
      });
      await tx.commit();

      if (sync.outcome === 'inserted') counts.inserted += 1;
      else if (sync.outcome === 'updated') counts.updated += 1;
      else counts.skipped += 1;
    } catch (err) {
      try { await tx.rollback(); } catch { /* ignore */ }
      counts.errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (isMissingLedgerTableError(message)) {
        errors.push(`CashMove#${row.cashMoveId}: ${message}`);
        break;
      }
      errors.push(`CashMove#${row.cashMoveId}: ${message}`);
    }
  }

  const reconciliation = await buildEmployeeFundingReconciliation(month, empId);

  return {
    success: counts.errors === 0,
    dryRun,
    month,
    flagEnabled: true,
    counts,
    previewRows: previewRows.filter((r) => r.action !== 'skip').slice(0, 500),
    byEmployee: [...byEmployeeMap.values()].sort((a, b) => b.total - a.total),
    reconciliation,
    errors,
  };
}
