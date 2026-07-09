import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { validateLedgerMonth } from '@/lib/services/employeeLedgerService';
import { cashMoveHasLegacyPayrollColumns } from '@/lib/services/employeeLedgerReconciliationService';
import type {
  CashWageExpenseRow,
  DailyPayrollAuditSection,
  DailyPayrollEmployeeBreakdown,
  DailyPayrollStatusBreakdown,
  EmployeeLedgerWageSourceAuditResponse,
  IncomeMirrorRow,
  LedgerSalaryCreditSection,
  WageSourceSuggestion,
} from '@/lib/types/employee-ledger-wage-source-audit';

const WAGE_CATEGORY_KEYWORDS = [
  'يومية', 'يوميات', 'راتب', 'مرتب', 'اجرة', 'أجر', 'wage', 'salary',
] as const;

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

function empFilterCashMove(
  cmAlias: string,
  mapAlias: string,
  empId?: number | null,
): string {
  if (empId != null && empId > 0) {
    return `AND (${cmAlias}.EmpID = @empId OR ${mapAlias}.EmpID = @empId)`;
  }
  return '';
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

function buildWageCategoryMatchSql(catAlias: string): string {
  const likeClauses = WAGE_CATEGORY_KEYWORDS.map(
    (keyword, idx) => `${catAlias}.CatName LIKE @wageKeyword${idx}`,
  );
  return likeClauses.join('\n          OR ');
}

function bindWageCategoryKeywords(req: sql.Request): sql.Request {
  WAGE_CATEGORY_KEYWORDS.forEach((keyword, idx) => {
    req.input(`wageKeyword${idx}`, sql.NVarChar(100), `%${keyword}%`);
  });
  return req;
}

function formatDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function resolveWageSourceSuggestion(data: {
  dailyPayrollGeneratedTotal: number;
  cashWageExpenseTotal: number;
}): WageSourceSuggestion {
  if (data.dailyPayrollGeneratedTotal > 0) {
    return 'TblEmpDailyPayroll';
  }
  if (data.cashWageExpenseTotal > 0) {
    return 'LegacyCashMove';
  }
  return 'NoneFound';
}

export async function getEmployeeLedgerWageSourceAudit(
  month: string,
  empId?: number | null,
): Promise<EmployeeLedgerWageSourceAuditResponse> {
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

  const dailyPayroll = await fetchDailyPayrollAudit(db, month, startDate, endDate, empId);
  const cashWageExpenses = await fetchCashWageExpenseRows(
    db, month, startDate, endDate, empId, legacyColumnsAvailable,
  );
  const incomeMirrors = await fetchIncomeMirrorRows(
    db, month, startDate, endDate, empId, legacyColumnsAvailable, cashWageExpenses,
  );
  const ledgerSalaryCredits = await fetchLedgerSalaryCredits(db, month, startDate, endDate, empId);

  const dailyPayrollGeneratedTotal = dailyPayroll.generatedStatusTotal;
  const cashWageExpenseTotal = roundMoney(
    cashWageExpenses.reduce((sum, row) => sum + row.amount, 0),
  );
  const possibleIncomeMirrorTotal = roundMoney(
    incomeMirrors.reduce((sum, row) => sum + row.amount, 0),
  );
  const ledgerSalaryCreditTotal = ledgerSalaryCredits.totalAmount;

  return {
    month,
    empId: empId ?? null,
    readOnly: true,
    dailyPayrollGeneratedTotal,
    cashWageExpenseTotal,
    possibleIncomeMirrorTotal,
    ledgerSalaryCreditTotal,
    suggestedSource: resolveWageSourceSuggestion({
      dailyPayrollGeneratedTotal,
      cashWageExpenseTotal,
    }),
    dailyPayroll,
    cashWageExpenses,
    incomeMirrors,
    ledgerSalaryCredits,
  };
}

async function fetchDailyPayrollAudit(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<DailyPayrollAuditSection> {
  const empClause = empFilter('p.EmpID', empId);

  const byStatusResult = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT
        p.Status AS payrollStatus,
        COUNT(*) AS totalRows,
        ISNULL(SUM(p.DailyWage), 0) AS dailyWageTotal
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.WorkDate >= @monthStart
        AND p.WorkDate <= @monthEnd
        ${empClause}
      GROUP BY p.Status
      ORDER BY p.Status
    `);

  const byEmployeeResult = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT
        p.EmpID AS empId,
        e.EmpName AS empName,
        COUNT(*) AS totalRows,
        ISNULL(SUM(p.DailyWage), 0) AS dailyWageTotal
      FROM dbo.TblEmpDailyPayroll p
      INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      WHERE p.WorkDate >= @monthStart
        AND p.WorkDate <= @monthEnd
        ${empClause}
      GROUP BY p.EmpID, e.EmpName
      ORDER BY dailyWageTotal DESC, e.EmpName
    `);

  const generatedResult = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT
        COUNT(*) AS totalRows,
        ISNULL(SUM(p.DailyWage), 0) AS dailyWageTotal
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.WorkDate >= @monthStart
        AND p.WorkDate <= @monthEnd
        AND p.Status IN (N'Generated', N'Earned', N'PostedToCashMove')
        ${empClause}
    `);

  const byStatus: DailyPayrollStatusBreakdown[] = byStatusResult.recordset.map(
    (row: Record<string, unknown>) => ({
      status: String(row.payrollStatus),
      rowCount: Number(row.totalRows ?? 0),
      dailyWageTotal: roundMoney(Number(row.dailyWageTotal ?? 0)),
    }),
  );

  const byEmployee: DailyPayrollEmployeeBreakdown[] = byEmployeeResult.recordset.map(
    (row: Record<string, unknown>) => ({
      empId: Number(row.empId),
      empName: String(row.empName),
      rowCount: Number(row.totalRows ?? 0),
      dailyWageTotal: roundMoney(Number(row.dailyWageTotal ?? 0)),
    }),
  );

  const totalRowCount = byStatus.reduce((sum, row) => sum + row.rowCount, 0);
  const dailyWageTotal = roundMoney(byStatus.reduce((sum, row) => sum + row.dailyWageTotal, 0));
  const generatedStatusTotal = roundMoney(Number(generatedResult.recordset[0]?.dailyWageTotal ?? 0));

  return {
    totalRowCount,
    dailyWageTotal,
    generatedStatusTotal,
    byStatus,
    byEmployee,
  };
}

async function fetchCashWageExpenseRows(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId: number | null | undefined,
  legacyColumnsAvailable: boolean,
): Promise<CashWageExpenseRow[]> {
  const empClause = empFilterCashMove('cm', 'm', empId);
  const legacyFlagClause = legacyColumnsAvailable
    ? 'OR ISNULL(cm.IsPayrollDeduction, 0) = 1'
    : '';

  const result = await bindWageCategoryKeywords(
    bindMonthAndEmp(db.request(), month, startDate, endDate, empId),
  ).query(`
    SELECT
      cm.ID AS cashMoveId,
      cm.invDate AS invDate,
      cm.GrandTolal AS amount,
      cat.CatName AS categoryName,
      COALESCE(cm.EmpID, m.EmpID) AS empId,
      e.EmpName AS empName,
      cm.Notes AS notes,
      pm.PaymentMethod AS paymentMethod,
      CASE WHEN ISNULL(cm.IsPayrollDeduction, 0) = 1 THEN 1 ELSE 0 END AS isPayrollDeduction,
      CASE
        WHEN ISNULL(cm.IsPayrollDeduction, 0) = 1 THEN N'legacy_payroll_deduction_flag'
        WHEN EXISTS (
          SELECT 1
          FROM dbo.TblExpCatEmpMap map
          WHERE map.ExpINID = cm.ExpINID
            AND map.IsActive = 1
            AND map.TxnKind = N'deduction'
        ) THEN N'exp_cat_emp_map_deduction'
        ELSE N'category_keyword'
      END AS matchReason
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    LEFT JOIN dbo.TblPaymentMethods pm ON pm.PaymentID = cm.PaymentMethodID
    LEFT JOIN dbo.TblExpCatEmpMap m
      ON m.ExpINID = cm.ExpINID
     AND m.IsActive = 1
     AND m.TxnKind = N'deduction'
    LEFT JOIN dbo.TblEmp e ON e.EmpID = COALESCE(cm.EmpID, m.EmpID)
    WHERE cm.invType = N'مصروفات'
      AND cm.inOut = N'out'
      AND cm.invDate >= @monthStart
      AND cm.invDate <= @monthEnd
      AND (
        ${buildWageCategoryMatchSql('cat')}
        ${legacyFlagClause}
        OR EXISTS (
          SELECT 1
          FROM dbo.TblExpCatEmpMap map
          WHERE map.ExpINID = cm.ExpINID
            AND map.IsActive = 1
            AND map.TxnKind = N'deduction'
        )
      )
      ${empClause}
    ORDER BY cm.invDate DESC, cm.ID DESC
  `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    cashMoveId: Number(row.cashMoveId),
    invDate: formatDate(row.invDate),
    amount: roundMoney(Number(row.amount ?? 0)),
    categoryName: row.categoryName != null ? String(row.categoryName) : null,
    empId: row.empId != null ? Number(row.empId) : null,
    empName: row.empName != null ? String(row.empName) : null,
    notes: row.notes != null ? String(row.notes) : null,
    paymentMethod: row.paymentMethod != null ? String(row.paymentMethod) : null,
    isPayrollDeduction: Number(row.isPayrollDeduction ?? 0) === 1,
    matchReason: String(row.matchReason),
  }));
}

async function fetchIncomeMirrorRows(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId: number | null | undefined,
  legacyColumnsAvailable: boolean,
  cashWageExpenses: CashWageExpenseRow[],
): Promise<IncomeMirrorRow[]> {
  const empClause = empFilterCashMove('cm', 'm', empId);
  const legacyIncomeClause = legacyColumnsAvailable
    ? 'ISNULL(cm.IsEmployeePayrollIncome, 0) = 1 OR'
    : '';

  const result = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT
        cm.ID AS cashMoveId,
        cm.invDate AS invDate,
        cm.GrandTolal AS amount,
        cat.CatName AS categoryName,
        COALESCE(cm.EmpID, m.EmpID) AS empId,
        e.EmpName AS empName,
        cm.Notes AS notes,
        pm.PaymentMethod AS paymentMethod,
        CASE WHEN ISNULL(cm.IsEmployeePayrollIncome, 0) = 1 THEN 1 ELSE 0 END AS isEmployeePayrollIncome,
        m.TxnKind AS mappedTxnKind,
        CASE
          WHEN ISNULL(cm.IsEmployeePayrollIncome, 0) = 1 THEN N'legacy_payroll_income_flag'
          WHEN m.TxnKind = N'revenue' THEN N'exp_cat_emp_map_revenue'
          WHEN cat.CatName LIKE N'%ايراد%' OR cat.CatName LIKE N'%إيراد%' THEN N'category_income_keyword'
          ELSE N'category_mapped_employee'
        END AS matchReason
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      LEFT JOIN dbo.TblPaymentMethods pm ON pm.PaymentID = cm.PaymentMethodID
      LEFT JOIN dbo.TblExpCatEmpMap m
        ON m.ExpINID = cm.ExpINID
       AND m.IsActive = 1
      LEFT JOIN dbo.TblEmp e ON e.EmpID = COALESCE(cm.EmpID, m.EmpID)
      WHERE cm.invType = N'ايرادات'
        AND cm.inOut = N'in'
        AND cm.invDate >= @monthStart
        AND cm.invDate <= @monthEnd
        AND (
          ${legacyIncomeClause}
          (m.TxnKind = N'revenue' AND m.EmpID IS NOT NULL)
          OR (
            (cat.CatName LIKE N'%ايراد%' OR cat.CatName LIKE N'%إيراد%')
            AND m.EmpID IS NOT NULL
          )
        )
        ${empClause}
      ORDER BY cm.invDate DESC, cm.ID DESC
    `);

  const expenseIndex = new Map<string, number>();
  for (const expense of cashWageExpenses) {
    if (expense.empId == null) continue;
    const key = `${expense.empId}|${expense.invDate}|${expense.amount.toFixed(2)}`;
    expenseIndex.set(key, expense.cashMoveId);
  }

  return result.recordset.map((row: Record<string, unknown>) => {
    const empIdValue = row.empId != null ? Number(row.empId) : null;
    const invDate = formatDate(row.invDate);
    const amount = roundMoney(Number(row.amount ?? 0));
    const matchKey = empIdValue != null
      ? `${empIdValue}|${invDate}|${amount.toFixed(2)}`
      : null;
    const matchedExpenseCashMoveId = matchKey != null
      ? expenseIndex.get(matchKey) ?? null
      : null;

    return {
      cashMoveId: Number(row.cashMoveId),
      invDate,
      amount,
      categoryName: row.categoryName != null ? String(row.categoryName) : null,
      empId: empIdValue,
      empName: row.empName != null ? String(row.empName) : null,
      notes: row.notes != null ? String(row.notes) : null,
      paymentMethod: row.paymentMethod != null ? String(row.paymentMethod) : null,
      isEmployeePayrollIncome: Number(row.isEmployeePayrollIncome ?? 0) === 1,
      mappedTxnKind: row.mappedTxnKind != null ? String(row.mappedTxnKind) : null,
      matchedExpenseCashMoveId,
      matchReason: String(row.matchReason),
    };
  });
}

async function fetchLedgerSalaryCredits(
  db: { request: () => sql.Request },
  month: string,
  startDate: string,
  endDate: string,
  empId?: number | null,
): Promise<LedgerSalaryCreditSection> {
  const empClause = empFilter('l.EmpID', empId);

  const byEmployeeResult = await bindMonthAndEmp(db.request(), month, startDate, endDate, empId)
    .query(`
      SELECT
        l.EmpID AS empId,
        e.EmpName AS empName,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'hourly_wage' THEN l.Amount ELSE 0 END), 0) AS hourlyWageTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'monthly_salary' THEN l.Amount ELSE 0 END), 0) AS monthlySalaryTotal,
        ISNULL(SUM(l.Amount), 0) AS totalAmount,
        COUNT(*) AS totalRows
      FROM dbo.TblEmpLedgerEntry l
      INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.IsVoided = 0
        AND l.EntryDirection = N'credit'
        AND l.EntryReason IN (N'hourly_wage', N'monthly_salary')
        AND ${buildMonthEntryFilter('l')}
        ${empClause}
      GROUP BY l.EmpID, e.EmpName
      ORDER BY totalAmount DESC, e.EmpName
    `);

  const byEmployee = byEmployeeResult.recordset.map((row: Record<string, unknown>) => ({
    empId: Number(row.empId),
    empName: String(row.empName),
    hourlyWageTotal: roundMoney(Number(row.hourlyWageTotal ?? 0)),
    monthlySalaryTotal: roundMoney(Number(row.monthlySalaryTotal ?? 0)),
    totalAmount: roundMoney(Number(row.totalAmount ?? 0)),
    entryCount: Number(row.totalRows ?? 0),
  }));

  return {
    totalAmount: roundMoney(byEmployee.reduce((sum, row) => sum + row.totalAmount, 0)),
    entryCount: byEmployee.reduce((sum, row) => sum + row.entryCount, 0),
    byEmployee,
  };
}
