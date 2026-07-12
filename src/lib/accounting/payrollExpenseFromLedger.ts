import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import type { PayrollExpenseFromLedgerResult } from '@/lib/types/financial-report-classification';

const PAYROLL_EXPENSE_REASONS = [
  'hourly_wage',
  'monthly_salary',
  'commission',
  'bonus',
  'target',
] as const;

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

export interface PayrollExpenseFromLedgerParams {
  year: number;
  month: number;
  empId?: number | null;
}

export interface PayrollExpenseFromLedgerDateRangeParams {
  startDate: string;
  endDate: string;
  empId?: number | null;
}

async function queryPayrollExpense(
  db: Awaited<ReturnType<typeof getPool>>,
  whereClause: string,
  inputs: Record<string, unknown>,
): Promise<PayrollExpenseFromLedgerResult> {
  const request = db.request();
  for (const [key, value] of Object.entries(inputs)) {
    if (key === 'empId') {
      request.input(key, sql.Int, value);
    } else if (key === 'month' || key === 'rangeStartMonth' || key === 'rangeEndMonth') {
      request.input(key, sql.NVarChar(7), value);
    } else {
      request.input(key, sql.Date, value);
    }
  }

  const empClause =
    inputs.empId != null && Number(inputs.empId) > 0 ? 'AND l.EmpID = @empId' : '';

  const byEmployeeResult = await request.query(`
      SELECT
        l.EmpID AS empId,
        e.EmpName AS empName,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'hourly_wage' THEN l.Amount ELSE 0 END), 0) AS hourlyWageTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'monthly_salary' THEN l.Amount ELSE 0 END), 0) AS monthlySalaryTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'commission' THEN l.Amount ELSE 0 END), 0) AS commissionTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'bonus' THEN l.Amount ELSE 0 END), 0) AS bonusTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'target' THEN l.Amount ELSE 0 END), 0) AS targetTotal,
        ISNULL(SUM(l.Amount), 0) AS totalAmount,
        COUNT(*) AS entryCount
      FROM dbo.TblEmpLedgerEntry l
      INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.IsVoided = 0
        AND l.EntryDirection = N'credit'
        AND l.EntryReason IN (N'hourly_wage', N'monthly_salary', N'commission', N'bonus', N'target')
        AND ${whereClause}
        ${empClause}
      GROUP BY l.EmpID, e.EmpName
      ORDER BY totalAmount DESC, e.EmpName
    `);

  const byReasonResult = await db.request();
  for (const [key, value] of Object.entries(inputs)) {
    if (key === 'empId') {
      byReasonResult.input(key, sql.Int, value);
    } else if (key === 'month' || key === 'rangeStartMonth' || key === 'rangeEndMonth') {
      byReasonResult.input(key, sql.NVarChar(7), value);
    } else {
      byReasonResult.input(key, sql.Date, value);
    }
  }

  const byReasonQueryResult = await byReasonResult.query(`
      SELECT
        l.EntryReason AS entryReason,
        ISNULL(SUM(l.Amount), 0) AS totalAmount,
        COUNT(*) AS entryCount
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.IsVoided = 0
        AND l.EntryDirection = N'credit'
        AND l.EntryReason IN (N'hourly_wage', N'monthly_salary', N'commission', N'bonus', N'target')
        AND ${whereClause}
        ${empClause}
      GROUP BY l.EntryReason
      ORDER BY totalAmount DESC
    `);

  const byEmployee = byEmployeeResult.recordset.map((row: Record<string, unknown>) => ({
    empId: Number(row.empId),
    empName: String(row.empName),
    totalAmount: roundMoney(Number(row.totalAmount ?? 0)),
    hourlyWageTotal: roundMoney(Number(row.hourlyWageTotal ?? 0)),
    monthlySalaryTotal: roundMoney(Number(row.monthlySalaryTotal ?? 0)),
    commissionTotal: roundMoney(Number(row.commissionTotal ?? 0)),
    bonusTotal: roundMoney(Number(row.bonusTotal ?? 0)),
    targetTotal: roundMoney(Number(row.targetTotal ?? 0)),
    entryCount: Number(row.entryCount ?? 0),
  }));

  const byReason = byReasonQueryResult.recordset.map((row: Record<string, unknown>) => ({
    entryReason: String(row.entryReason),
    totalAmount: roundMoney(Number(row.totalAmount ?? 0)),
    entryCount: Number(row.entryCount ?? 0),
  }));

  const dailyHourlyTotal = roundMoney(
    byReason
      .filter((r) => r.entryReason === 'hourly_wage')
      .reduce((sum, r) => sum + r.totalAmount, 0),
  );
  const monthlySalaryTotal = roundMoney(
    byReason
      .filter((r) => r.entryReason === 'monthly_salary')
      .reduce((sum, r) => sum + r.totalAmount, 0),
  );
  const commissionBonusTotal = roundMoney(
    byReason
      .filter((r) => r.entryReason === 'commission' || r.entryReason === 'bonus')
      .reduce((sum, r) => sum + r.totalAmount, 0),
  );
  const targetTotal = roundMoney(
    byReason
      .filter((r) => r.entryReason === 'target')
      .reduce((sum, r) => sum + r.totalAmount, 0),
  );

  return {
    totalPayrollExpense: roundMoney(byEmployee.reduce((sum, row) => sum + row.totalAmount, 0)),
    dailyHourlyTotal,
    monthlySalaryTotal,
    commissionBonusTotal,
    targetTotal,
    byEmployee,
    byReason,
  };
}

export async function getPayrollExpenseFromLedgerForDateRange(
  params: PayrollExpenseFromLedgerDateRangeParams,
): Promise<PayrollExpenseFromLedgerResult> {
  const db = await getPool();
  const whereClause = `(
    (l.PayrollMonth IS NOT NULL AND l.PayrollMonth >= @rangeStartMonth AND l.PayrollMonth <= @rangeEndMonth)
    OR (l.EntryDate >= @startDate AND l.EntryDate <= @endDate)
  )`;

  return queryPayrollExpense(db, whereClause, {
    startDate: params.startDate,
    endDate: params.endDate,
    rangeStartMonth: params.startDate.slice(0, 7),
    rangeEndMonth: params.endDate.slice(0, 7),
    empId: params.empId ?? null,
  });
}

export async function getPayrollExpenseFromLedger(
  params: PayrollExpenseFromLedgerParams,
): Promise<PayrollExpenseFromLedgerResult> {
  const { year, month, empId } = params;
  const { startDate, endDate } = getMonthDateRange(year, month);
  const payrollMonth = `${year}-${String(month).padStart(2, '0')}`;

  const db = await getPool();
  const whereClause = buildMonthEntryFilter('l');

  return queryPayrollExpense(db, whereClause, {
    month: payrollMonth,
    monthStart: startDate,
    monthEnd: endDate,
    empId: empId ?? null,
  });
}

export { PAYROLL_EXPENSE_REASONS };
