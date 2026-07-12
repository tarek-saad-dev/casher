import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  EMP_LEDGER_REASON_PAYOUT,
  PAYOUT_EXPENSE_CATEGORY_NAME,
} from '@/lib/services/employeeLedgerPayoutService';
import {
  buildMonthlySalaryRefType,
  EMP_LEDGER_REASON_MONTHLY_SALARY,
} from '@/lib/services/employeeLedgerMonthlySalaryService';
import {
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
  EMP_LEDGER_REF_TYPE_DAILY_PAYROLL,
  EMP_LEDGER_REASON_ADVANCE,
  EMP_LEDGER_REASON_HOURLY_WAGE,
} from '@/lib/services/employeeLedgerDualWrite';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { validateLedgerMonth } from '@/lib/services/employeeLedgerService';
import { suggestEmployeesByCategoryName } from '@/lib/services/employeeLedgerReconciliationCleanupService';
import type {
  AdvanceAmountMismatchRow,
  AdvanceDiagnosticRow,
  EmployeeLedgerReconciliationResponse,
  LegacyMirrorGroupRow,
  MissingAdvanceDebitRow,
  MissingPayrollCreditRow,
  MissingPayoutDebitRow,
  MissingMonthlySalaryCreditRow,
  OrphanMonthlySalaryCreditRow,
  OrphanLedgerCreditRow,
  ReconciliationSummary,
  UnresolvedCashAdvanceRow,
} from '@/lib/types/employee-ledger-reconciliation';

const MONEY_EPSILON = 0.01;

interface AdvanceCashMoveDetailRow {
  cashMoveId: number;
  expInId: number;
  invDate: string;
  amount: number;
  categoryName: string | null;
  notes: string | null;
  cashEmpId: number | null;
  mapEmpId: number | null;
  empName: string | null;
  activeMapCount: number;
  ledgerEntryId: number | null;
  ledgerAmount: number | null;
}

interface OrphanAdvanceLedgerRow {
  ledgerEntryId: number;
  empId: number;
  empName: string;
  entryDate: string;
  amount: number;
  refId: number | null;
  cashMoveId: number | null;
}

function buildMonthEntryFilter(alias: string): string {
  return `(
    ${alias}.PayrollMonth = @month
    OR (
      ${alias}.PayrollMonth IS NULL
      AND ${alias}.EntryDate >= @monthStart
      AND ${alias}.EntryDate <= @monthEnd
    )
  )`;
}

function bindMonthAndEmp(
  req: sql.Request,
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
) {
  req.input('month', sql.NVarChar(7), month);
  req.input('monthStart', sql.Date, startDate);
  req.input('monthEnd', sql.Date, endDate);
  if (empId != null && empId > 0) {
    req.input('empId', sql.Int, empId);
  }
  return req;
}

function empFilter(column: string, empId?: number | null): string {
  if (empId != null && empId > 0) {
    return `AND ${column} = @empId`;
  }
  return '';
}

export async function cashMoveHasLegacyPayrollColumns(
  pool: { request: () => sql.Request },
): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblCashMove'
      AND COLUMN_NAME IN ('IsEmployeePayrollIncome', 'IsPayrollDeduction')
  `);
  return Number(result.recordset[0]?.cnt ?? 0) >= 2;
}

export function buildReconciliationIssueCount(data: {
  missingPayrollCredits: unknown[];
  orphanLedgerCredits: unknown[];
  missingMonthlySalaryCredits: unknown[];
  orphanMonthlySalaryCredits: unknown[];
  missingAdvanceDebits: unknown[];
  unresolvedCashAdvances: unknown[];
  advanceAmountMismatches: unknown[];
  advanceDiagnosticRows: unknown[];
  missingPayoutDebits: unknown[];
  payrollLedgerCreditDiff: number;
  advanceLedgerDiff: number;
  payoutLedgerDiff: number;
}): number {
  const detailRowCount = (
    data.missingPayrollCredits.length
    + data.orphanLedgerCredits.length
    + data.missingMonthlySalaryCredits.length
    + data.orphanMonthlySalaryCredits.length
    + data.missingAdvanceDebits.length
    + data.unresolvedCashAdvances.length
    + data.advanceAmountMismatches.length
    + data.advanceDiagnosticRows.length
    + data.missingPayoutDebits.length
  );

  const unexplainedMoneyDiffs = (
    (Math.abs(data.payrollLedgerCreditDiff) >= MONEY_EPSILON && data.missingPayrollCredits.length === 0 ? 1 : 0)
    + (Math.abs(data.advanceLedgerDiff) >= MONEY_EPSILON
      && data.missingAdvanceDebits.length === 0
      && data.unresolvedCashAdvances.length === 0
      && data.advanceAmountMismatches.length === 0
      && data.advanceDiagnosticRows.length === 0
      ? 1 : 0)
    + (Math.abs(data.payoutLedgerDiff) >= MONEY_EPSILON && data.missingPayoutDebits.length === 0 ? 1 : 0)
  );

  return detailRowCount + unexplainedMoneyDiffs;
}

async function enrichUnresolvedCashAdvances(
  db: { request: () => sql.Request },
  rows: UnresolvedCashAdvanceRow[],
): Promise<UnresolvedCashAdvanceRow[]> {
  const suggestionCache = new Map<string, UnresolvedCashAdvanceRow['suggestedEmployeeMatches']>();
  const enriched: UnresolvedCashAdvanceRow[] = [];

  for (const row of rows) {
    const cacheKey = row.categoryName ?? '';
    if (!suggestionCache.has(cacheKey)) {
      suggestionCache.set(
        cacheKey,
        await suggestEmployeesByCategoryName(db, row.categoryName),
      );
    }
    enriched.push({
      ...row,
      suggestedEmployeeMatches: suggestionCache.get(cacheKey) ?? [],
    });
  }

  return enriched;
}

export function analyzeAdvanceReconciliation(
  cashRows: AdvanceCashMoveDetailRow[],
  orphanAdvanceLedgerRows: OrphanAdvanceLedgerRow[],
  ledgerAdvanceDebitsTotal: number,
): {
  resolvedCashAdvanceTotal: number;
  unresolvedCashAdvanceTotal: number;
  advanceCashMoveTotal: number;
  advanceLedgerDiff: number;
  unresolvedCashAdvanceCount: number;
  missingAdvanceDebits: MissingAdvanceDebitRow[];
  unresolvedCashAdvances: UnresolvedCashAdvanceRow[];
  advanceAmountMismatches: AdvanceAmountMismatchRow[];
  advanceDiagnosticRows: AdvanceDiagnosticRow[];
} {
  let resolvedCashAdvanceTotal = 0;
  let unresolvedCashAdvanceTotal = 0;
  const missingAdvanceDebits: MissingAdvanceDebitRow[] = [];
  const unresolvedCashAdvances: UnresolvedCashAdvanceRow[] = [];
  const advanceAmountMismatches: AdvanceAmountMismatchRow[] = [];

  for (const row of cashRows) {
    const resolvedEmpId = row.mapEmpId;
    const isResolved = resolvedEmpId != null && resolvedEmpId > 0;

    if (isResolved) {
      resolvedCashAdvanceTotal += row.amount;
    } else {
      unresolvedCashAdvanceTotal += row.amount;
      unresolvedCashAdvances.push({
        cashMoveId: row.cashMoveId,
        expInId: row.expInId,
        invDate: row.invDate,
        amount: row.amount,
        categoryName: row.categoryName,
        notes: row.notes,
        cashEmpId: row.cashEmpId,
        mapEmpId: row.mapEmpId,
        hasLedgerEntry: row.ledgerEntryId != null,
        ledgerEntryId: row.ledgerEntryId,
        suggestedEmployeeMatches: [],
        issueReason: row.activeMapCount > 0 ? 'missing_employee_mapping' : 'no_emp_id',
      });
      continue;
    }

    if (row.activeMapCount > 1) {
      unresolvedCashAdvances.push({
        cashMoveId: row.cashMoveId,
        expInId: row.expInId,
        invDate: row.invDate,
        amount: row.amount,
        categoryName: row.categoryName,
        notes: row.notes,
        cashEmpId: row.cashEmpId,
        mapEmpId: row.mapEmpId,
        hasLedgerEntry: row.ledgerEntryId != null,
        ledgerEntryId: row.ledgerEntryId,
        suggestedEmployeeMatches: [],
        issueReason: 'missing_employee_mapping',
      });
    }

    if (row.ledgerEntryId == null) {
      missingAdvanceDebits.push({
        cashMoveId: row.cashMoveId,
        invDate: row.invDate,
        amount: row.amount,
        empId: resolvedEmpId,
        empName: row.empName,
        categoryName: row.categoryName,
        notes: row.notes,
        ledgerAmount: null,
        issueReason: 'ledger_entry_missing',
      });
      continue;
    }

    if (Math.abs(row.amount - Number(row.ledgerAmount ?? 0)) >= MONEY_EPSILON) {
      advanceAmountMismatches.push({
        cashMoveId: row.cashMoveId,
        invDate: row.invDate,
        cashAmount: row.amount,
        ledgerAmount: roundMoney(Number(row.ledgerAmount ?? 0)),
        empId: resolvedEmpId!,
        empName: row.empName ?? '—',
        categoryName: row.categoryName,
        notes: row.notes,
        issueReason: 'amount_mismatch',
      });
    }
  }

  const advanceCashMoveTotal = roundMoney(resolvedCashAdvanceTotal + unresolvedCashAdvanceTotal);
  const advanceLedgerDiff = roundMoney(advanceCashMoveTotal - ledgerAdvanceDebitsTotal);

  const advanceDiagnosticRows: AdvanceDiagnosticRow[] = [];

  for (const row of orphanAdvanceLedgerRows) {
    advanceDiagnosticRows.push({
      label: `قيد دفتر يتيم #${row.ledgerEntryId}`,
      amount: row.amount,
      issueReason: 'orphan_ledger_debit',
      notes: row.cashMoveId != null
        ? `Ref CashMove #${row.cashMoveId} — ${row.empName}`
        : row.refId != null
          ? `Ref CashMove #${row.refId} — ${row.empName}`
          : `بدون RefID — ${row.empName}`,
      ledgerEntryId: row.ledgerEntryId,
    });
  }

  const explainedAdvanceDiff = roundMoney(
    missingAdvanceDebits.reduce((sum, row) => sum + row.amount, 0)
    + unresolvedCashAdvances.reduce((sum, row) => sum + row.amount, 0)
    + advanceAmountMismatches.reduce((sum, row) => sum + Math.abs(row.cashAmount - row.ledgerAmount), 0)
    + orphanAdvanceLedgerRows.reduce((sum, row) => sum + row.amount, 0),
  );

  if (Math.abs(advanceLedgerDiff) >= MONEY_EPSILON) {
    const residual = roundMoney(Math.abs(advanceLedgerDiff) - explainedAdvanceDiff);
    if (residual >= MONEY_EPSILON || (
      missingAdvanceDebits.length === 0
      && unresolvedCashAdvances.length === 0
      && advanceAmountMismatches.length === 0
      && orphanAdvanceLedgerRows.length === 0
    )) {
      advanceDiagnosticRows.push({
        label: 'فرق سلف غير مفسَّر بين الخزنة والدفتر',
        amount: advanceLedgerDiff,
        issueReason: 'unexplained_difference',
        notes: explainedAdvanceDiff > 0
          ? `المبلغ المفسَّر من الصفوف التفصيلية: ${explainedAdvanceDiff.toFixed(2)}`
          : 'لا توجد صفوف تفصيلية تفسّر هذا الفرق — راجع الربط أو التكرار في التصنيفات',
      });
    }
  }

  return {
    resolvedCashAdvanceTotal: roundMoney(resolvedCashAdvanceTotal),
    unresolvedCashAdvanceTotal: roundMoney(unresolvedCashAdvanceTotal),
    advanceCashMoveTotal,
    advanceLedgerDiff,
    unresolvedCashAdvanceCount: unresolvedCashAdvances.length,
    missingAdvanceDebits,
    unresolvedCashAdvances,
    advanceAmountMismatches,
    advanceDiagnosticRows,
  };
}

export async function getEmployeeLedgerReconciliation(
  month: string,
  empId?: number | null,
): Promise<EmployeeLedgerReconciliationResponse> {
  const monthError = validateLedgerMonth(month);
  if (monthError) {
    throw new Error(monthError);
  }

  const [yearStr, monthStr] = month.split('-');
  const { startDate, endDate } = getMonthDateRange(
    parseInt(yearStr, 10),
    parseInt(monthStr, 10),
  );

  const db = await getPool();
  const legacyColumnsAvailable = await cashMoveHasLegacyPayrollColumns(db);
  const empClausePayroll = empFilter('p.EmpID', empId);
  const empClauseLedger = empFilter('l.EmpID', empId);
  const empClauseCash = empFilter('cm.EmpID', empId);

  const payrollTotals = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT ISNULL(SUM(p.DailyWage), 0) AS TotalAmount
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.WorkDate >= @monthStart
        AND p.WorkDate <= @monthEnd
        AND p.Status IN (N'Generated', N'Earned', N'PostedToCashMove')
        ${empClausePayroll}
    `);

  const ledgerSalaryTotals = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT ISNULL(SUM(l.Amount), 0) AS TotalAmount
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.IsVoided = 0
        AND l.EntryDirection = N'credit'
        AND l.EntryReason IN (N'hourly_wage', N'monthly_salary')
        AND ${buildMonthEntryFilter('l')}
        ${empClauseLedger}
    `);

  const advanceCashRows = await fetchAdvanceCashMoveDetails(
    db, month, startDate, endDate, empId,
  );
  const ledgerAdvanceDebitsTotal = roundMoney(Number(
    (await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
      .query(`
        SELECT ISNULL(SUM(l.Amount), 0) AS TotalAmount
        FROM dbo.TblEmpLedgerEntry l
        WHERE l.IsVoided = 0
          AND l.EntryDirection = N'debit'
          AND l.EntryReason = N'${EMP_LEDGER_REASON_ADVANCE}'
          AND ${buildMonthEntryFilter('l')}
          ${empClauseLedger}
      `)).recordset[0]?.TotalAmount ?? 0,
  ));
  const orphanAdvanceLedgerRows = await fetchOrphanAdvanceLedgerDebits(
    db, month, startDate, endDate, empId, advanceCashRows.map((row) => row.cashMoveId),
  );
  const advanceAnalysis = analyzeAdvanceReconciliation(
    advanceCashRows,
    orphanAdvanceLedgerRows,
    ledgerAdvanceDebitsTotal,
  );
  const unresolvedCashAdvances = await enrichUnresolvedCashAdvances(
    db,
    advanceAnalysis.unresolvedCashAdvances,
  );
  const advanceDiagnosticRows = advanceAnalysis.advanceDiagnosticRows;

  const payoutCashTotals = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('payoutCatName', sql.NVarChar(200), PAYOUT_EXPENSE_CATEGORY_NAME)
    .query(`
      SELECT ISNULL(SUM(cm.GrandTolal), 0) AS TotalAmount
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat cat
        ON cat.ExpINID = cm.ExpINID
       AND cat.CatName = @payoutCatName
       AND cat.ExpINType = N'مصروفات'
      WHERE cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND cm.invDate >= @monthStart
        AND cm.invDate <= @monthEnd
        ${empClauseCash}
    `);

  const ledgerPayoutTotals = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT ISNULL(SUM(l.Amount), 0) AS TotalAmount
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.IsVoided = 0
        AND l.EntryDirection = N'debit'
        AND l.EntryReason = N'${EMP_LEDGER_REASON_PAYOUT}'
        AND ${buildMonthEntryFilter('l')}
        ${empClauseLedger}
    `);

  let legacyIncomeTotal = 0;
  let legacyExpenseTotal = 0;
  if (legacyColumnsAvailable) {
    const legacyTotals = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
      .query(`
        SELECT
          ISNULL(SUM(CASE WHEN ISNULL(cm.IsEmployeePayrollIncome, 0) = 1 THEN cm.GrandTolal ELSE 0 END), 0) AS IncomeTotal,
          ISNULL(SUM(CASE WHEN ISNULL(cm.IsPayrollDeduction, 0) = 1 THEN cm.GrandTolal ELSE 0 END), 0) AS ExpenseTotal
        FROM dbo.TblCashMove cm
        WHERE cm.invDate >= @monthStart
          AND cm.invDate <= @monthEnd
          AND (
            ISNULL(cm.IsEmployeePayrollIncome, 0) = 1
            OR ISNULL(cm.IsPayrollDeduction, 0) = 1
          )
          ${empClauseCash}
      `);
    legacyIncomeTotal = roundMoney(Number(legacyTotals.recordset[0]?.IncomeTotal ?? 0));
    legacyExpenseTotal = roundMoney(Number(legacyTotals.recordset[0]?.ExpenseTotal ?? 0));
  }

  const payrollGeneratedTotal = roundMoney(Number(payrollTotals.recordset[0]?.TotalAmount ?? 0));
  const ledgerSalaryCreditsTotal = roundMoney(Number(ledgerSalaryTotals.recordset[0]?.TotalAmount ?? 0));
  const payoutCashMoveTotal = roundMoney(Number(payoutCashTotals.recordset[0]?.TotalAmount ?? 0));
  const ledgerPayoutDebitsTotal = roundMoney(Number(ledgerPayoutTotals.recordset[0]?.TotalAmount ?? 0));

  const missingPayrollCredits = await fetchMissingPayrollCredits(
    db, month, startDate, endDate, empId,
  );
  const orphanLedgerCredits = await fetchOrphanLedgerCredits(
    db, month, startDate, endDate, empId,
  );
  const missingPayoutDebits = await fetchMissingPayoutDebits(
    db, month, startDate, endDate, empId,
  );
  const legacyMirrorRows = legacyColumnsAvailable
    ? await fetchLegacyMirrorRows(db, month, startDate, endDate, empId)
    : [];
  const missingMonthlySalaryCredits = await fetchMissingMonthlySalaryCredits(
    db, month, empId,
  );
  const orphanMonthlySalaryCredits = await fetchOrphanMonthlySalaryCredits(
    db, month, startDate, endDate, empId,
  );

  const payrollLedgerCreditDiff = roundMoney(payrollGeneratedTotal - ledgerSalaryCreditsTotal);
  const payoutLedgerDiff = roundMoney(payoutCashMoveTotal - ledgerPayoutDebitsTotal);

  const summary: ReconciliationSummary = {
    month,
    empId: empId ?? null,
    payrollGeneratedTotal,
    ledgerSalaryCreditsTotal,
    payrollLedgerCreditDiff,
    resolvedCashAdvanceTotal: advanceAnalysis.resolvedCashAdvanceTotal,
    unresolvedCashAdvanceTotal: advanceAnalysis.unresolvedCashAdvanceTotal,
    advanceCashMoveTotal: advanceAnalysis.advanceCashMoveTotal,
    ledgerAdvanceDebitsTotal,
    advanceLedgerDiff: advanceAnalysis.advanceLedgerDiff,
    unresolvedCashAdvanceCount: advanceAnalysis.unresolvedCashAdvanceCount,
    payoutCashMoveTotal,
    ledgerPayoutDebitsTotal,
    payoutLedgerDiff,
    legacyPayrollIncomeMirrorTotal: legacyIncomeTotal,
    legacyPayrollExpenseMirrorTotal: legacyExpenseTotal,
    legacyColumnsAvailable,
    issueCount: buildReconciliationIssueCount({
      missingPayrollCredits,
      orphanLedgerCredits,
      missingMonthlySalaryCredits,
      orphanMonthlySalaryCredits,
      missingAdvanceDebits: advanceAnalysis.missingAdvanceDebits,
      unresolvedCashAdvances,
      advanceAmountMismatches: advanceAnalysis.advanceAmountMismatches,
      advanceDiagnosticRows,
      missingPayoutDebits,
      payrollLedgerCreditDiff,
      advanceLedgerDiff: advanceAnalysis.advanceLedgerDiff,
      payoutLedgerDiff,
    }),
  };

  return {
    summary,
    missingPayrollCredits,
    orphanLedgerCredits,
    missingAdvanceDebits: advanceAnalysis.missingAdvanceDebits,
    unresolvedCashAdvances,
    advanceAmountMismatches: advanceAnalysis.advanceAmountMismatches,
    advanceDiagnosticRows,
    missingPayoutDebits,
    legacyMirrorRows,
    missingMonthlySalaryCredits,
    orphanMonthlySalaryCredits,
  };
}

async function fetchMissingMonthlySalaryCredits(
  db: { request: () => sql.Request },
  month: string,
  empId?: number | null,
): Promise<MissingMonthlySalaryCreditRow[]> {
  const [yearStr, monthStr] = month.split('-');
  const { startDate, endDate } = getMonthDateRange(parseInt(yearStr, 10), parseInt(monthStr, 10));
  const refType = buildMonthlySalaryRefType(month);
  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('refType', sql.NVarChar(80), refType)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_MONTHLY_SALARY)
    .query(`
      SELECT
        e.EmpID AS empId,
        e.EmpName AS empName,
        CAST(e.BaseSalary AS DECIMAL(12,2)) AS baseSalary
      FROM dbo.TblEmp e
      LEFT JOIN dbo.TblEmpLedgerEntry l
        ON l.RefType = @refType
       AND l.RefID = e.EmpID
       AND l.EntryReason = @entryReason
       AND l.IsVoided = 0
      WHERE ISNULL(e.isActive, 1) = 1
        AND ISNULL(e.IsPayrollEnabled, 1) = 1
        AND ISNULL(e.BaseSalary, 0) > 0
        AND (
          e.PayrollMethod = N'monthly'
          OR (e.PayrollMethod IS NULL AND e.SalaryType = N'monthly')
        )
        AND ISNULL(e.EmploymentType, N'full_time') <> N'freelance'
        AND l.ID IS NULL
        ${empFilter('e.EmpID', empId)}
      ORDER BY e.EmpName
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    empId: Number(row.empId),
    empName: String(row.empName),
    baseSalary: roundMoney(Number(row.baseSalary ?? 0)),
  }));
}

async function fetchOrphanMonthlySalaryCredits(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<OrphanMonthlySalaryCreditRow[]> {
  const refType = buildMonthlySalaryRefType(month);
  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('refType', sql.NVarChar(80), refType)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_MONTHLY_SALARY)
    .query(`
      SELECT
        l.ID AS ledgerEntryId,
        l.EmpID AS empId,
        e.EmpName AS empName,
        l.EntryDate AS entryDate,
        l.Amount AS amount,
        l.RefType AS refType
      FROM dbo.TblEmpLedgerEntry l
      INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.IsVoided = 0
        AND l.RefType = @refType
        AND l.EntryReason = @entryReason
        AND l.EntryDirection = N'credit'
        AND ${buildMonthEntryFilter('l')}
        AND (
          ISNULL(e.isActive, 1) = 0
          OR ISNULL(e.IsPayrollEnabled, 1) = 0
          OR NOT (
            e.PayrollMethod = N'monthly'
            OR (e.PayrollMethod IS NULL AND e.SalaryType = N'monthly')
          )
          OR ISNULL(e.EmploymentType, N'full_time') = N'freelance'
        )
        ${empFilter('l.EmpID', empId)}
      ORDER BY l.EntryDate DESC, l.ID DESC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    ledgerEntryId: Number(row.ledgerEntryId),
    empId: Number(row.empId),
    empName: String(row.empName),
    entryDate: formatDate(row.entryDate),
    amount: roundMoney(Number(row.amount ?? 0)),
    refType: String(row.refType),
  }));
}

async function fetchMissingPayrollCredits(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<MissingPayrollCreditRow[]> {
  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_HOURLY_WAGE)
    .query(`
      SELECT
        p.ID AS payrollId,
        p.EmpID AS empId,
        e.EmpName AS empName,
        p.WorkDate AS workDate,
        p.DailyWage AS dailyWage
      FROM dbo.TblEmpDailyPayroll p
      INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      LEFT JOIN dbo.TblEmpLedgerEntry l
        ON l.RefType = @refType
       AND l.RefID = p.ID
       AND l.EntryReason = @entryReason
       AND l.IsVoided = 0
      WHERE p.WorkDate >= @monthStart
        AND p.WorkDate <= @monthEnd
        AND p.Status IN (N'Generated', N'Earned', N'PostedToCashMove')
        AND l.ID IS NULL
        ${empFilter('p.EmpID', empId)}
      ORDER BY p.WorkDate DESC, p.ID DESC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    payrollId: Number(row.payrollId),
    empId: Number(row.empId),
    empName: String(row.empName),
    workDate: formatDate(row.workDate),
    dailyWage: roundMoney(Number(row.dailyWage ?? 0)),
  }));
}

async function fetchOrphanLedgerCredits(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<OrphanLedgerCreditRow[]> {
  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_HOURLY_WAGE)
    .query(`
      SELECT
        l.ID AS ledgerEntryId,
        l.EmpID AS empId,
        e.EmpName AS empName,
        l.EntryDate AS entryDate,
        l.Amount AS amount,
        l.RefID AS refId
      FROM dbo.TblEmpLedgerEntry l
      INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      LEFT JOIN dbo.TblEmpDailyPayroll p ON p.ID = l.RefID
      WHERE l.IsVoided = 0
        AND l.RefType = @refType
        AND l.EntryReason = @entryReason
        AND l.EntryDirection = N'credit'
        AND ${buildMonthEntryFilter('l')}
        AND p.ID IS NULL
        ${empFilter('l.EmpID', empId)}
      ORDER BY l.EntryDate DESC, l.ID DESC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    ledgerEntryId: Number(row.ledgerEntryId),
    empId: Number(row.empId),
    empName: String(row.empName),
    entryDate: formatDate(row.entryDate),
    amount: roundMoney(Number(row.amount ?? 0)),
    refId: Number(row.refId),
  }));
}

async function fetchAdvanceCashMoveDetails(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<AdvanceCashMoveDetailRow[]> {
  const empClause = empFilter('resolved.mapEmpId', empId);

  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE)
    .query(`
      SELECT
        cm.ID AS cashMoveId,
        cm.ExpINID AS expInId,
        cm.invDate AS invDate,
        cm.GrandTolal AS amount,
        cat.CatName AS categoryName,
        cm.Notes AS notes,
        cm.EmpID AS cashEmpId,
        resolved.mapEmpId AS mapEmpId,
        resolved.empName AS empName,
        ISNULL(resolved.activeMapCount, 0) AS activeMapCount,
        ledger.ledgerEntryId AS ledgerEntryId,
        ledger.ledgerAmount AS ledgerAmount
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      INNER JOIN (
        SELECT DISTINCT ExpINID
        FROM dbo.TblExpCatEmpMap
        WHERE TxnKind = N'advance'
      ) advCat ON advCat.ExpINID = cm.ExpINID
      OUTER APPLY (
        SELECT TOP 1
          m.EmpID AS mapEmpId,
          e.EmpName AS empName,
          (
            SELECT COUNT(*)
            FROM dbo.TblExpCatEmpMap m2
            WHERE m2.ExpINID = cm.ExpINID
              AND m2.TxnKind = N'advance'
              AND m2.IsActive = 1
          ) AS activeMapCount
        FROM dbo.TblExpCatEmpMap m
        LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
        WHERE m.ExpINID = cm.ExpINID
          AND m.TxnKind = N'advance'
          AND m.IsActive = 1
        ORDER BY m.ID DESC
      ) resolved
      OUTER APPLY (
        SELECT TOP 1
          l.ID AS ledgerEntryId,
          l.Amount AS ledgerAmount
        FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType = @refType
          AND l.RefID = cm.ID
          AND l.EntryReason = @entryReason
          AND l.IsVoided = 0
        ORDER BY l.ID DESC
      ) ledger
      WHERE cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND cm.invDate >= @monthStart
        AND cm.invDate <= @monthEnd
        ${empClause}
      ORDER BY cm.invDate DESC, cm.ID DESC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    cashMoveId: Number(row.cashMoveId),
    expInId: Number(row.expInId),
    invDate: formatDate(row.invDate),
    amount: roundMoney(Number(row.amount ?? 0)),
    categoryName: row.categoryName != null ? String(row.categoryName) : null,
    notes: row.notes != null ? String(row.notes) : null,
    cashEmpId: row.cashEmpId != null ? Number(row.cashEmpId) : null,
    mapEmpId: row.mapEmpId != null ? Number(row.mapEmpId) : null,
    empName: row.empName != null ? String(row.empName) : null,
    activeMapCount: Number(row.activeMapCount ?? 0),
    ledgerEntryId: row.ledgerEntryId != null ? Number(row.ledgerEntryId) : null,
    ledgerAmount: row.ledgerAmount != null ? roundMoney(Number(row.ledgerAmount)) : null,
  }));
}

async function fetchOrphanAdvanceLedgerDebits(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId: number | null | undefined,
  cashMoveIds: number[],
): Promise<OrphanAdvanceLedgerRow[]> {
  const cashMoveIdList = cashMoveIds.length > 0 ? cashMoveIds.join(',') : '0';
  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE)
    .query(`
      SELECT
        l.ID AS ledgerEntryId,
        l.EmpID AS empId,
        e.EmpName AS empName,
        l.EntryDate AS entryDate,
        l.Amount AS amount,
        l.RefID AS refId,
        l.CashMoveID AS cashMoveId
      FROM dbo.TblEmpLedgerEntry l
      INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.IsVoided = 0
        AND l.EntryDirection = N'debit'
        AND l.EntryReason = @entryReason
        AND ${buildMonthEntryFilter('l')}
        AND (
          l.RefID IS NULL
          OR l.RefID NOT IN (${cashMoveIdList})
        )
        ${empFilter('l.EmpID', empId)}
      ORDER BY l.EntryDate DESC, l.ID DESC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    ledgerEntryId: Number(row.ledgerEntryId),
    empId: Number(row.empId),
    empName: String(row.empName),
    entryDate: formatDate(row.entryDate),
    amount: roundMoney(Number(row.amount ?? 0)),
    refId: row.refId != null ? Number(row.refId) : null,
    cashMoveId: row.cashMoveId != null ? Number(row.cashMoveId) : null,
  }));
}

async function fetchMissingPayoutDebits(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<MissingPayoutDebitRow[]> {
  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_PAYOUT)
    .input('payoutCatName', sql.NVarChar(200), PAYOUT_EXPENSE_CATEGORY_NAME)
    .query(`
      SELECT
        cm.ID AS cashMoveId,
        cm.invDate AS invDate,
        cm.GrandTolal AS amount,
        cm.EmpID AS empId,
        e.EmpName AS empName
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat cat
        ON cat.ExpINID = cm.ExpINID
       AND cat.CatName = @payoutCatName
       AND cat.ExpINType = N'مصروفات'
      LEFT JOIN dbo.TblEmp e ON e.EmpID = cm.EmpID
      LEFT JOIN dbo.TblEmpLedgerEntry l
        ON l.RefType = @refType
       AND l.RefID = cm.ID
       AND l.EntryReason = @entryReason
       AND l.IsVoided = 0
      WHERE cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND cm.invDate >= @monthStart
        AND cm.invDate <= @monthEnd
        AND l.ID IS NULL
        ${empFilter('cm.EmpID', empId)}
      ORDER BY cm.invDate DESC, cm.ID DESC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    cashMoveId: Number(row.cashMoveId),
    invDate: formatDate(row.invDate),
    amount: roundMoney(Number(row.amount ?? 0)),
    empId: row.empId != null ? Number(row.empId) : null,
    empName: row.empName != null ? String(row.empName) : null,
  }));
}

async function fetchLegacyMirrorRows(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<LegacyMirrorGroupRow[]> {
  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT
        cm.invDate AS invDate,
        cm.EmpID AS empId,
        e.EmpName AS empName,
        ISNULL(SUM(CASE WHEN ISNULL(cm.IsEmployeePayrollIncome, 0) = 1 THEN cm.GrandTolal ELSE 0 END), 0) AS incomeMirrorTotal,
        ISNULL(SUM(CASE WHEN ISNULL(cm.IsPayrollDeduction, 0) = 1 THEN cm.GrandTolal ELSE 0 END), 0) AS expenseMirrorTotal,
        COUNT(*) AS totalRows
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblEmp e ON e.EmpID = cm.EmpID
      WHERE cm.invDate >= @monthStart
        AND cm.invDate <= @monthEnd
        AND (
          ISNULL(cm.IsEmployeePayrollIncome, 0) = 1
          OR ISNULL(cm.IsPayrollDeduction, 0) = 1
        )
        ${empFilter('cm.EmpID', empId)}
      GROUP BY cm.invDate, cm.EmpID, e.EmpName
      ORDER BY cm.invDate DESC, e.EmpName
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    invDate: formatDate(row.invDate),
    empId: row.empId != null ? Number(row.empId) : null,
    empName: row.empName != null ? String(row.empName) : null,
    incomeMirrorTotal: roundMoney(Number(row.incomeMirrorTotal ?? 0)),
    expenseMirrorTotal: roundMoney(Number(row.expenseMirrorTotal ?? 0)),
    rowCount: Number(row.totalRows ?? 0),
  }));
}

function formatDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}
