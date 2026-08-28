import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { computeEmployeeWithdrawalBuckets } from '@/lib/hr/employee-withdrawal-buckets';
import type {
  EmpLedgerBranchFinancialOverall,
  EmpLedgerBranchFinancialRow,
  EmpLedgerBranchFinancialSummary,
  EmpLedgerEmployeeBranchBreakdown,
  EmpLedgerEmployeeSummaryRow,
  EmpLedgerEntryRow,
  EmpLedgerListResponse,
  EmpLedgerSummaryResponse,
  EmpLedgerTableBranchCode,
} from '@/lib/types/employee-ledger';
import { EMP_LEDGER_TABLE_BRANCH_CODES } from '@/lib/types/employee-ledger';
import {
  CAMP_CAESAR_BRANCH_CODE,
  GLEEM_BRANCH_CODE,
} from '@/lib/branch/smokeBranchPolicy';

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
    branchId: row.BranchID != null ? Number(row.BranchID) : null,
    branchCode: (row.BranchCode as string | null) ?? null,
    branchName: (row.BranchName as string | null) ?? null,
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

export interface EmployeeLedgerTableBranchMeta {
  branchId: number;
  branchCode: EmpLedgerTableBranchCode | string;
  branchName: string;
}

/** GLEEM + CAMP_CAESAR — always shown as paired rows in the employee ledger UI. */
export async function getEmployeeLedgerTableBranches(): Promise<EmployeeLedgerTableBranchMeta[]> {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT BranchID, BranchCode, BranchName
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'${GLEEM_BRANCH_CODE}', N'${CAMP_CAESAR_BRANCH_CODE}')
    ORDER BY CASE BranchCode WHEN N'${GLEEM_BRANCH_CODE}' THEN 0 ELSE 1 END
  `);
  return (result.recordset as Array<Record<string, unknown>>).map((row) => ({
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode ?? ''),
    branchName: String(row.BranchName ?? ''),
  }));
}

/** Union accessible branches with ledger table branches so Camp Caesar entries are never hidden. */
export function mergeEmployeeLedgerBranchScope(
  accessibleBranchIds: number[],
  tableBranchIds: number[],
): number[] {
  const merged = new Set<number>();
  for (const id of [...accessibleBranchIds, ...tableBranchIds]) {
    if (Number.isFinite(id) && id > 0) merged.add(id);
  }
  return [...merged].sort((a, b) => a - b);
}

export async function getEmployeeLedgerEntries(params: {
  empId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  month?: string | null;
  branchId?: number | null;
  /** When set (and branchId not set), restrict to these BranchIDs. */
  branchIds?: number[] | null;
}): Promise<EmpLedgerListResponse> {
  const db = await getPool();

  const where: string[] = [ACTIVE_ENTRY_FILTER];

  if (params.branchId != null && params.branchId > 0) {
    where.push('l.BranchID = @branchId');
  } else if (params.branchIds && params.branchIds.length > 0) {
    const ids = params.branchIds.filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length > 0) {
      where.push(`l.BranchID IN (${ids.join(',')})`);
    }
  }

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
    if (params.branchId != null && params.branchId > 0) {
      req.input('branchId', sql.Int, params.branchId);
    }
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
      l.UpdatedAt,
      l.BranchID,
      b.BranchCode,
      b.BranchName
    FROM dbo.TblEmpLedgerEntry l
    INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
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
      branchId: params.branchId ?? null,
    },
  };
}

function emptyBranchOverall(): EmpLedgerBranchFinancialOverall {
  return {
    accrued: 0,
    paid: 0,
    advances: 0,
    deductions: 0,
    transfers: 0,
    balance: 0,
    salaryCredits: 0,
    targetCredits: 0,
    fundingCredits: 0,
    advanceDebits: 0,
    payoutDebits: 0,
    deductionDebits: 0,
  };
}

function mapBranchFinancialRow(row: Record<string, unknown>): EmpLedgerBranchFinancialRow {
  const salaryCredits = roundMoney(Number(row.SalaryCredits ?? 0));
  const targetCredits = roundMoney(Number(row.TargetCredits ?? 0));
  const fundingCredits = roundMoney(Number(row.FundingCredits ?? 0));
  const advanceDebits = roundMoney(Number(row.AdvanceDebits ?? 0));
  const payoutDebits = roundMoney(Number(row.PayoutDebits ?? 0));
  const deductionDebits = roundMoney(Number(row.DeductionDebits ?? 0));
  const accrued = roundMoney(salaryCredits + targetCredits);
  const balance = roundMoney(
    salaryCredits + targetCredits + fundingCredits - advanceDebits - payoutDebits - deductionDebits,
  );
  return {
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode ?? ''),
    branchName: String(row.BranchName ?? ''),
    accrued,
    paid: payoutDebits,
    advances: advanceDebits,
    deductions: deductionDebits,
    transfers: fundingCredits,
    balance,
    salaryCredits,
    targetCredits,
    fundingCredits,
    advanceDebits,
    payoutDebits,
    deductionDebits,
  };
}

const LEDGER_BUCKET_SELECT = `
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
`;

/**
 * Branch financial summary for a payroll month — aggregates by entry BranchID
 * (never by employee home/current assignment).
 */
export async function getEmployeeLedgerBranchFinancialSummary(args: {
  month: string;
  /** Restrict to these branch IDs (accessible set). Empty = no rows. */
  branchIds: number[];
  /** When set, only that branch is returned (must be in branchIds). */
  filterBranchId?: number | null;
}): Promise<EmpLedgerBranchFinancialSummary> {
  const monthError = validateLedgerMonth(args.month);
  if (monthError) throw new Error(monthError);

  const ids = args.branchIds.filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) {
    return { branches: [], overall: emptyBranchOverall() };
  }

  const filterId =
    args.filterBranchId != null && args.filterBranchId > 0 ? args.filterBranchId : null;
  if (filterId != null && !ids.includes(filterId)) {
    return { branches: [], overall: emptyBranchOverall() };
  }

  const [yearStr, monthStr] = args.month.split('-');
  const { startDate, endDate } = getMonthDateRange(
    parseInt(yearStr, 10),
    parseInt(monthStr, 10),
  );

  const scopeIds = filterId != null ? [filterId] : ids;
  const db = await getPool();
  const req = db
    .request()
    .input('month', sql.NVarChar(7), args.month)
    .input('monthStart', sql.Date, startDate)
    .input('monthEnd', sql.Date, endDate);

  // Bind branch ids as a table-valued list via CSV + IN (safe: ints only)
  const idList = scopeIds.join(',');
  const result = await req.query(`
    SELECT
      b.BranchID,
      b.BranchCode,
      b.BranchName,
      ${LEDGER_BUCKET_SELECT}
    FROM dbo.TblBranch b
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.BranchID = b.BranchID
     AND l.IsVoided = 0
     AND ${buildMonthEntryFilter('l')}
    WHERE b.BranchID IN (${idList})
    GROUP BY b.BranchID, b.BranchCode, b.BranchName
    ORDER BY b.BranchName
  `);

  const branches = result.recordset.map((row: Record<string, unknown>) =>
    mapBranchFinancialRow(row),
  );

  const overall = branches.reduce(
    (acc, row) => ({
      accrued: acc.accrued + row.accrued,
      paid: acc.paid + row.paid,
      advances: acc.advances + row.advances,
      deductions: acc.deductions + row.deductions,
      transfers: acc.transfers + row.transfers,
      balance: acc.balance + row.balance,
      salaryCredits: acc.salaryCredits + row.salaryCredits,
      targetCredits: acc.targetCredits + row.targetCredits,
      fundingCredits: acc.fundingCredits + row.fundingCredits,
      advanceDebits: acc.advanceDebits + row.advanceDebits,
      payoutDebits: acc.payoutDebits + row.payoutDebits,
      deductionDebits: acc.deductionDebits + row.deductionDebits,
    }),
    emptyBranchOverall(),
  );

  return {
    branches,
    overall: {
      accrued: roundMoney(overall.accrued),
      paid: roundMoney(overall.paid),
      advances: roundMoney(overall.advances),
      deductions: roundMoney(overall.deductions),
      transfers: roundMoney(overall.transfers),
      balance: roundMoney(overall.balance),
      salaryCredits: roundMoney(overall.salaryCredits),
      targetCredits: roundMoney(overall.targetCredits),
      fundingCredits: roundMoney(overall.fundingCredits),
      advanceDebits: roundMoney(overall.advanceDebits),
      payoutDebits: roundMoney(overall.payoutDebits),
      deductionDebits: roundMoney(overall.deductionDebits),
    },
  };
}

function emptyBranchBreakdown(
  meta: { branchId: number; branchCode: string; branchName: string },
): EmpLedgerEmployeeBranchBreakdown {
  return {
    branchId: meta.branchId,
    branchCode: meta.branchCode,
    branchName: meta.branchName,
    salary: 0,
    target: 0,
    funding: 0,
    payout: 0,
    revenueWithdrawal: 0,
    advance: 0,
    deductions: 0,
    balance: 0,
    salaryCredits: 0,
    targetCredits: 0,
    fundingCredits: 0,
    advanceDebits: 0,
    payoutDebits: 0,
    deductionDebits: 0,
  };
}

function mapEmployeeBranchBreakdown(row: Record<string, unknown>): EmpLedgerEmployeeBranchBreakdown {
  const salaryCredits = roundMoney(Number(row.SalaryCredits ?? 0));
  const targetCredits = roundMoney(Number(row.TargetCredits ?? 0));
  const fundingCredits = roundMoney(Number(row.FundingCredits ?? 0));
  const advanceDebits = roundMoney(Number(row.AdvanceDebits ?? 0));
  const payoutDebits = roundMoney(Number(row.PayoutDebits ?? 0));
  const deductionDebits = roundMoney(Number(row.DeductionDebits ?? 0));

  const { payoutWithinDues, revenueWithdrawal, advanceExcess } =
    computeEmployeeWithdrawalBuckets({
      advanceDebits,
      payoutDebits,
      salaryAndTarget: salaryCredits + targetCredits,
      revenue: fundingCredits,
    });

  const salary = salaryCredits;
  const target = targetCredits;
  const funding = fundingCredits;
  const payout = payoutWithinDues;
  const advance = advanceExcess;
  const deductions = deductionDebits;
  // Same ledger identity: salary+target+funding − (payout+revenueWithdrawal+advance) − deductions
  // because payout+revenueWithdrawal+advance === advanceDebits+payoutDebits.
  const balance = roundMoney(
    salary + target + funding - payout - revenueWithdrawal - advance - deductions,
  );

  return {
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode ?? ''),
    branchName: String(row.BranchName ?? ''),
    salary,
    target,
    funding,
    payout,
    revenueWithdrawal,
    advance,
    deductions,
    balance,
    salaryCredits,
    targetCredits,
    fundingCredits,
    advanceDebits,
    payoutDebits,
    deductionDebits,
  };
}

function sumBranchBreakdowns(
  parts: EmpLedgerEmployeeBranchBreakdown[],
): Pick<
  EmpLedgerEmployeeSummaryRow,
  | 'salaryCredits'
  | 'targetCredits'
  | 'fundingCredits'
  | 'advanceDebits'
  | 'payoutDebits'
  | 'deductionDebits'
  | 'balance'
  | 'revenue'
  | 'payoutWithinDues'
  | 'revenueWithdrawal'
  | 'advanceExcess'
> {
  const salaryCredits = roundMoney(parts.reduce((s, p) => s + p.salaryCredits, 0));
  const targetCredits = roundMoney(parts.reduce((s, p) => s + p.targetCredits, 0));
  const fundingCredits = roundMoney(parts.reduce((s, p) => s + p.fundingCredits, 0));
  const advanceDebits = roundMoney(parts.reduce((s, p) => s + p.advanceDebits, 0));
  const payoutDebits = roundMoney(parts.reduce((s, p) => s + p.payoutDebits, 0));
  const deductionDebits = roundMoney(parts.reduce((s, p) => s + p.deductionDebits, 0));
  const payoutWithinDues = roundMoney(parts.reduce((s, p) => s + p.payout, 0));
  const revenueWithdrawal = roundMoney(parts.reduce((s, p) => s + p.revenueWithdrawal, 0));
  const advanceExcess = roundMoney(parts.reduce((s, p) => s + p.advance, 0));
  const balance = roundMoney(parts.reduce((s, p) => s + p.balance, 0));
  return {
    salaryCredits,
    targetCredits,
    fundingCredits,
    advanceDebits,
    payoutDebits,
    deductionDebits,
    balance,
    revenue: fundingCredits,
    payoutWithinDues,
    revenueWithdrawal,
    advanceExcess,
  };
}

export async function getEmployeeLedgerSummary(
  month: string,
  branchId?: number | null,
  options?: {
    /** When viewing all branches: limit to accessible branch IDs and attach per-emp branchBalances. */
    accessibleBranchIds?: number[];
  },
): Promise<EmpLedgerSummaryResponse> {
  const monthError = validateLedgerMonth(month);
  if (monthError) {
    throw new Error(monthError);
  }

  const [yearStr, monthStr] = month.split('-');
  const { startDate, endDate } = getMonthDateRange(
    parseInt(yearStr, 10),
    parseInt(monthStr, 10),
  );

  const accessible = (options?.accessibleBranchIds ?? []).filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  const singleBranch = branchId != null && branchId > 0 ? branchId : null;

  const db = await getPool();

  // Resolve GLEEM + CAMP_CAESAR ids (table always shows both).
  const tableBranchMeta = await getEmployeeLedgerTableBranches();
  const tableBranchIds = tableBranchMeta.map((b) => b.branchId);
  const metaByCode = new Map(tableBranchMeta.map((b) => [b.branchCode, b]));
  const ledgerBranchScope = mergeEmployeeLedgerBranchScope(accessible, tableBranchIds);

  // One query: employee × table-branch buckets (entry BranchID). No N+1.
  const scopeIds =
    tableBranchIds.length > 0
      ? tableBranchIds
      : accessible.length > 0
        ? accessible
        : [];

  const request = db
    .request()
    .input('month', sql.NVarChar(7), month)
    .input('monthStart', sql.Date, startDate)
    .input('monthEnd', sql.Date, endDate);

  const empBranchResult =
    scopeIds.length > 0
      ? await request.query(`
          SELECT
            e.EmpID,
            e.EmpName,
            b.BranchID,
            b.BranchCode,
            b.BranchName,
            ${LEDGER_BUCKET_SELECT}
          FROM dbo.TblEmp e
          CROSS JOIN dbo.TblBranch b
          LEFT JOIN dbo.TblEmpLedgerEntry l
            ON l.EmpID = e.EmpID
           AND l.BranchID = b.BranchID
           AND l.IsVoided = 0
           AND ${buildMonthEntryFilter('l')}
          WHERE ISNULL(e.isActive, 1) = 1
            AND b.BranchID IN (${scopeIds.join(',')})
          GROUP BY e.EmpID, e.EmpName, b.BranchID, b.BranchCode, b.BranchName
          ORDER BY e.EmpName, CASE b.BranchCode WHEN N'${GLEEM_BRANCH_CODE}' THEN 0 ELSE 1 END
        `)
      : { recordset: [] as Array<Record<string, unknown>> };

  type EmpAcc = {
    empId: number;
    empName: string;
    byCode: Map<string, EmpLedgerEmployeeBranchBreakdown>;
  };
  const empMap = new Map<number, EmpAcc>();

  for (const row of empBranchResult.recordset as Array<Record<string, unknown>>) {
    const empId = Number(row.EmpID);
    let acc = empMap.get(empId);
    if (!acc) {
      acc = { empId, empName: String(row.EmpName ?? ''), byCode: new Map() };
      empMap.set(empId, acc);
    }
    const breakdown = mapEmployeeBranchBreakdown(row);
    acc.byCode.set(breakdown.branchCode, breakdown);
  }

  // Ensure active employees with no ledger rows still appear (CROSS JOIN should already).
  // Fill missing GLEEM/CAMP slots with zeros.
  const employees: EmpLedgerEmployeeSummaryRow[] = [...empMap.values()].map((acc) => {
    const branches = {} as Record<EmpLedgerTableBranchCode, EmpLedgerEmployeeBranchBreakdown>;
    for (const code of EMP_LEDGER_TABLE_BRANCH_CODES) {
      const existing = acc.byCode.get(code);
      const meta = metaByCode.get(code);
      branches[code] =
        existing ??
        emptyBranchBreakdown(
          meta ?? { branchId: 0, branchCode: code, branchName: code },
        );
    }

    const allParts = EMP_LEDGER_TABLE_BRANCH_CODES.map((c) => branches[c]);
    const overallBalance = roundMoney(allParts.reduce((s, p) => s + p.balance, 0));

    // Flat aggregates respect branch filter (summary cards / payout scope).
    const flatParts =
      singleBranch != null
        ? allParts.filter((p) => p.branchId === singleBranch)
        : allParts;
    const flat = sumBranchBreakdowns(flatParts.length > 0 ? flatParts : allParts);

    const branchBalances = allParts
      .filter((p) => p.balance !== 0)
      .map((p) => ({
        branchId: p.branchId,
        branchCode: p.branchCode,
        branchName: p.branchName,
        balance: p.balance,
      }));

    return {
      empId: acc.empId,
      empName: acc.empName,
      ...flat,
      overallBalance,
      branches,
      ...(branchBalances.length > 0 ? { branchBalances } : {}),
    };
  });

  // Stable name order
  employees.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));

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

  const branchScopeIds =
    singleBranch != null
      ? [singleBranch]
      : ledgerBranchScope.length > 0
        ? ledgerBranchScope
        : tableBranchIds;

  const branchFinancial =
    branchScopeIds.length > 0
      ? await getEmployeeLedgerBranchFinancialSummary({
          month,
          branchIds: branchScopeIds,
          filterBranchId: singleBranch,
        })
      : undefined;

  return {
    month,
    branchId: singleBranch,
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
    ...(branchFinancial ? { branchFinancial } : {}),
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
  branchId?: number | null,
): Promise<EmployeeLedgerOutstandingTotals> {
  const db = await getPool();
  const req = db.request();

  let dateFilter = '';
  if (range) {
    req.input('startDate', sql.Date, range.startDate);
    req.input('endDate', sql.Date, range.endDate);
    dateFilter = 'AND l.EntryDate >= @startDate AND l.EntryDate <= @endDate';
  }

  let branchFilter = '';
  if (branchId != null && branchId > 0) {
    req.input('branchId', sql.Int, branchId);
    branchFilter = 'AND l.BranchID = @branchId';
  }

  const result = await req.query(`
    SELECT
      ISNULL(SUM(CASE WHEN l.EntryDirection = N'credit' THEN l.Amount ELSE -l.Amount END), 0) AS Balance
    FROM dbo.TblEmpLedgerEntry l
    WHERE l.IsVoided = 0 ${dateFilter} ${branchFilter}
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
