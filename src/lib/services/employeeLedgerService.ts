import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { computeEmployeeWithdrawalBuckets } from '@/lib/hr/employee-withdrawal-buckets';
import type {
  EmpLedgerEmployeeSummaryRow,
  EmpLedgerEntryRow,
  EmpLedgerListResponse,
  EmpLedgerSummaryResponse,
} from '@/lib/types/employee-ledger';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ACTIVE_ENTRY_FILTER = 'l.IsVoided = 0';

function mapEntryRow(row: Record<string, unknown>): EmpLedgerEntryRow {
  return {
    id: row.ID as number,
    empId: row.EmpID as number,
    empName: row.EmpName as string,
    entryDate: formatDateValue(row.EntryDate),
    entryDirection: row.EntryDirection as EmpLedgerEntryRow['entryDirection'],
    entryReason: row.EntryReason as EmpLedgerEntryRow['entryReason'],
    amount: roundMoney(Number(row.Amount ?? 0)),
    payrollMonth: (row.PayrollMonth as string | null) ?? null,
    refType: (row.RefType as string | null) ?? null,
    refId: row.RefID != null ? Number(row.RefID) : null,
    cashMoveId: row.CashMoveID != null ? Number(row.CashMoveID) : null,
    attendanceId: row.AttendanceID != null ? Number(row.AttendanceID) : null,
    notes: (row.Notes as string | null) ?? null,
    isVoided: Boolean(row.IsVoided),
    voidReason: (row.VoidReason as string | null) ?? null,
    createdByUserId: row.CreatedByUserID != null ? Number(row.CreatedByUserID) : null,
    createdAt: formatDateTimeValue(row.CreatedAt),
    updatedAt: row.UpdatedAt ? formatDateTimeValue(row.UpdatedAt) : null,
  };
}

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function formatDateTimeValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
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

export function validateLedgerMonth(month: string): string | null {
  if (!MONTH_RE.test(month)) {
    return 'month يجب أن يكون بصيغة YYYY-MM';
  }
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  if (monthNum < 1 || monthNum > 12) {
    return 'month غير صالح';
  }
  if (year < 2020 || year > 2100) {
    return 'month غير صالح';
  }
  return null;
}

export async function getEmployeeLedgerEntries(params: {
  empId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  month?: string | null;
}): Promise<EmpLedgerListResponse> {
  const db = await getPool();

  const where: string[] = [ACTIVE_ENTRY_FILTER];

  if (params.empId != null && params.empId > 0) {
    where.push('l.EmpID = @empId');
  }

  if (params.month) {
    const monthError = validateLedgerMonth(params.month);
    if (monthError) {
      throw new Error(monthError);
    }
    where.push(buildMonthEntryFilter('l'));
  } else {
    if (params.dateFrom) {
      if (!DATE_RE.test(params.dateFrom)) {
        throw new Error('dateFrom يجب أن يكون بصيغة YYYY-MM-DD');
      }
      where.push('l.EntryDate >= @dateFrom');
    }
    if (params.dateTo) {
      if (!DATE_RE.test(params.dateTo)) {
        throw new Error('dateTo يجب أن يكون بصيغة YYYY-MM-DD');
      }
      where.push('l.EntryDate <= @dateTo');
    }
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const bindFilters = (req: sql.Request) => {
    if (params.empId != null && params.empId > 0) {
      req.input('empId', sql.Int, params.empId);
    }
    if (params.month) {
      const [yearStr, monthStr] = params.month.split('-');
      const { startDate, endDate } = getMonthDateRange(
        parseInt(yearStr, 10),
        parseInt(monthStr, 10),
      );
      req.input('month', sql.NVarChar(7), params.month);
      req.input('monthStart', sql.Date, startDate);
      req.input('monthEnd', sql.Date, endDate);
    } else {
      if (params.dateFrom) {
        req.input('dateFrom', sql.Date, params.dateFrom);
      }
      if (params.dateTo) {
        req.input('dateTo', sql.Date, params.dateTo);
      }
    }
    return req;
  };

  const entriesResult = await bindFilters(db.request()).query(`
    SELECT
      l.ID,
      l.EmpID,
      e.EmpName,
      l.EntryDate,
      l.EntryDirection,
      l.EntryReason,
      l.Amount,
      l.PayrollMonth,
      l.RefType,
      l.RefID,
      l.CashMoveID,
      l.AttendanceID,
      l.Notes,
      l.IsVoided,
      l.VoidReason,
      l.CreatedByUserID,
      l.CreatedAt,
      l.UpdatedAt
    FROM dbo.TblEmpLedgerEntry l
    INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
    ${whereClause}
    ORDER BY l.EntryDate DESC, l.ID DESC
  `);

  const totalsResult = await bindFilters(db.request()).query(`
    SELECT
      ISNULL(SUM(CASE WHEN l.EntryDirection = N'credit' THEN l.Amount ELSE 0 END), 0) AS TotalCredits,
      ISNULL(SUM(CASE WHEN l.EntryDirection = N'debit'  THEN l.Amount ELSE 0 END), 0) AS TotalDebits
    FROM dbo.TblEmpLedgerEntry l
    ${whereClause}
  `);

  const entries = entriesResult.recordset.map((row: Record<string, unknown>) => mapEntryRow(row));
  const totals = totalsResult.recordset[0] ?? { TotalCredits: 0, TotalDebits: 0 };
  const totalCredits = roundMoney(Number(totals.TotalCredits ?? 0));
  const totalDebits = roundMoney(Number(totals.TotalDebits ?? 0));

  return {
    entries,
    totalCredits,
    totalDebits,
    balance: roundMoney(totalCredits - totalDebits),
    filters: {
      empId: params.empId ?? null,
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
      month: params.month ?? null,
    },
  };
}

export async function getEmployeeLedgerSummary(month: string): Promise<EmpLedgerSummaryResponse> {
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
  const result = await db.request()
    .input('month', sql.NVarChar(7), month)
    .input('monthStart', sql.Date, startDate)
    .input('monthEnd', sql.Date, endDate)
    .query(`
      SELECT
        e.EmpID,
        e.EmpName,
        ISNULL(SUM(CASE
          WHEN l.ID IS NOT NULL
           AND l.EntryDirection = N'credit'
           AND l.EntryReason IN (N'hourly_wage', N'monthly_salary')
          THEN l.Amount ELSE 0 END), 0) AS SalaryCredits,
        ISNULL(SUM(CASE
          WHEN l.ID IS NOT NULL
           AND l.EntryDirection = N'credit'
           AND l.EntryReason IN (N'target', N'commission', N'bonus')
          THEN l.Amount ELSE 0 END), 0) AS TargetCredits,
        ISNULL(SUM(CASE
          WHEN l.ID IS NOT NULL
           AND l.EntryDirection = N'credit'
           AND l.EntryReason IN (N'employee_funding', N'tip')
          THEN l.Amount ELSE 0 END), 0) AS FundingCredits,
        ISNULL(SUM(CASE
          WHEN l.ID IS NOT NULL
           AND l.EntryDirection = N'debit'
           AND l.EntryReason = N'advance'
          THEN l.Amount ELSE 0 END), 0) AS AdvanceDebits,
        ISNULL(SUM(CASE
          WHEN l.ID IS NOT NULL
           AND l.EntryDirection = N'debit'
           AND l.EntryReason = N'payout'
          THEN l.Amount ELSE 0 END), 0) AS PayoutDebits,
        ISNULL(SUM(CASE
          WHEN l.ID IS NOT NULL
           AND l.EntryDirection = N'debit'
           AND l.EntryReason IN (N'deduction', N'settlement', N'adjustment')
          THEN l.Amount ELSE 0 END), 0) AS DeductionDebits
      FROM dbo.TblEmp e
      LEFT JOIN dbo.TblEmpLedgerEntry l
        ON l.EmpID = e.EmpID
       AND l.IsVoided = 0
       AND ${buildMonthEntryFilter('l')}
      WHERE ISNULL(e.isActive, 1) = 1
      GROUP BY e.EmpID, e.EmpName
      ORDER BY e.EmpName
    `);

  const employees: EmpLedgerEmployeeSummaryRow[] = result.recordset.map((row: Record<string, unknown>) => {
    const empId = row.EmpID as number;
    const salaryCredits = roundMoney(Number(row.SalaryCredits ?? 0));
    const targetCredits = roundMoney(Number(row.TargetCredits ?? 0));
    const fundingCredits = roundMoney(Number(row.FundingCredits ?? 0));
    const advanceDebits = roundMoney(Number(row.AdvanceDebits ?? 0));
    const payoutDebits = roundMoney(Number(row.PayoutDebits ?? 0));
    const deductionDebits = roundMoney(Number(row.DeductionDebits ?? 0));

    // إيراد/تمويل الموظف للمحل يُغطّي مسحوباته أولاً قبل الراتب والتارجت.
    const { payoutWithinDues, revenueWithdrawal, advanceExcess } =
      computeEmployeeWithdrawalBuckets({
        advanceDebits,
        payoutDebits,
        salaryAndTarget: salaryCredits + targetCredits,
        revenue: fundingCredits,
      });

    return {
      empId,
      empName: row.EmpName as string,
      salaryCredits,
      targetCredits,
      fundingCredits,
      advanceDebits,
      payoutDebits,
      deductionDebits,
      balance: roundMoney(
        salaryCredits + targetCredits + fundingCredits - advanceDebits - payoutDebits - deductionDebits,
      ),
      revenue: fundingCredits,
      payoutWithinDues,
      revenueWithdrawal,
      advanceExcess,
    };
  });

  const totals = employees.reduce(
    (acc, row) => ({
      salaryCredits: acc.salaryCredits + row.salaryCredits,
      targetCredits: acc.targetCredits + row.targetCredits,
      fundingCredits: acc.fundingCredits + row.fundingCredits,
      advanceDebits: acc.advanceDebits + row.advanceDebits,
      payoutDebits: acc.payoutDebits + row.payoutDebits,
      deductionDebits: acc.deductionDebits + row.deductionDebits,
      balance: acc.balance + row.balance,
      revenue: acc.revenue + row.revenue,
      payoutWithinDues: acc.payoutWithinDues + row.payoutWithinDues,
      revenueWithdrawal: acc.revenueWithdrawal + row.revenueWithdrawal,
      advanceExcess: acc.advanceExcess + row.advanceExcess,
    }),
    {
      salaryCredits: 0,
      targetCredits: 0,
      fundingCredits: 0,
      advanceDebits: 0,
      payoutDebits: 0,
      deductionDebits: 0,
      balance: 0,
      revenue: 0,
      payoutWithinDues: 0,
      revenueWithdrawal: 0,
      advanceExcess: 0,
    },
  );

  return {
    month,
    employees,
    totals: {
      salaryCredits: roundMoney(totals.salaryCredits),
      targetCredits: roundMoney(totals.targetCredits),
      fundingCredits: roundMoney(totals.fundingCredits),
      advanceDebits: roundMoney(totals.advanceDebits),
      payoutDebits: roundMoney(totals.payoutDebits),
      deductionDebits: roundMoney(totals.deductionDebits),
      balance: roundMoney(totals.balance),
      revenue: roundMoney(totals.revenue),
      payoutWithinDues: roundMoney(totals.payoutWithinDues),
      revenueWithdrawal: roundMoney(totals.revenueWithdrawal),
      advanceExcess: roundMoney(totals.advanceExcess),
    },
  };
}

export async function getEmployeeAllTimeBalance(
  empId: number,
  transaction?: sql.Transaction,
): Promise<number> {
  const db = await getPool();
  const req = transaction ? new sql.Request(transaction) : db.request();
  const result = await req
    .input('empId', sql.Int, empId)
    .query(`
      SELECT ISNULL(Balance, 0) AS Balance
      FROM dbo.vw_EmpLedgerGlobalBalance
      WHERE EmpID = @empId
    `);

  return roundMoney(Number(result.recordset[0]?.Balance ?? 0));
}

/** Phase 1L: branch account balance — only source for payout limits. */
export async function getEmployeeBranchBalance(
  empId: number,
  branchId: number,
  transaction?: sql.Transaction,
): Promise<number> {
  const db = await getPool();
  const req = transaction ? new sql.Request(transaction) : db.request();
  const result = await req
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        ISNULL(SUM(CASE WHEN l.EntryDirection = N'credit' THEN l.Amount ELSE 0 END), 0)
        - ISNULL(SUM(CASE WHEN l.EntryDirection = N'debit'  THEN l.Amount ELSE 0 END), 0) AS Balance
      FROM dbo.TblEmpLedgerEntry l WITH (UPDLOCK, HOLDLOCK)
      WHERE l.EmpID = @empId
        AND l.BranchID = @branchId
        AND l.IsVoided = 0
    `);

  return roundMoney(Number(result.recordset[0]?.Balance ?? 0));
}

export interface EmployeeLedgerOutstandingTotals {
  /** إجمالي ما يستحقه الموظفون على المحل (مجموع الأرصدة الموجبة) — المبلغ المحتجز. */
  totalOwedToEmployees: number;
  /** إجمالي ما على الموظفين للمحل (مجموع الأرصدة السالبة / السلف) — مبلغ مستحق للمحل. */
  totalOwedByEmployees: number;
  /** الصافي = المستحق للموظفين − المستحق على الموظفين. */
  netBalance: number;
}

/**
 * Aggregate employee ledger balances across all employees.
 * Positive per-employee balances are money the shop still owes (held);
 * negative balances are outstanding advances owed back by employees.
 *
 * When `range` is provided, only entries whose EntryDate falls within the range
 * are considered (net entitlements accrued during that period). Otherwise the
 * all-time outstanding balances are used.
 */
export async function getEmployeeLedgerOutstandingTotals(
  range?: { startDate: string; endDate: string },
): Promise<EmployeeLedgerOutstandingTotals> {
  const db = await getPool();
  const req = db.request();

  let dateFilter = '';
  if (range) {
    req.input('startDate', sql.Date, range.startDate);
    req.input('endDate', sql.Date, range.endDate);
    dateFilter = 'AND l.EntryDate >= @startDate AND l.EntryDate <= @endDate';
  }

  const result = await req.query(`
    SELECT
      ISNULL(SUM(CASE WHEN l.EntryDirection = N'credit' THEN l.Amount ELSE -l.Amount END), 0) AS Balance
    FROM dbo.TblEmpLedgerEntry l
    WHERE l.IsVoided = 0 ${dateFilter}
    GROUP BY l.EmpID
  `);

  let totalOwedToEmployees = 0;
  let totalOwedByEmployees = 0;
  for (const row of result.recordset as Array<{ Balance: number }>) {
    const balance = roundMoney(Number(row.Balance ?? 0));
    if (balance > 0) {
      totalOwedToEmployees += balance;
    } else if (balance < 0) {
      totalOwedByEmployees += -balance;
    }
  }

  return {
    totalOwedToEmployees: roundMoney(totalOwedToEmployees),
    totalOwedByEmployees: roundMoney(totalOwedByEmployees),
    netBalance: roundMoney(totalOwedToEmployees - totalOwedByEmployees),
  };
}
