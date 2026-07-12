import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { isFinancialReportClassificationEnabled, buildDisabledClassificationPayload } from '@/lib/accounting/financialReportFlags';
import {
  aggregateClassifiedCashMoves,
  computeCleanNetProfit,
  createEmptyClassifiedTotals,
  type CashMoveForReportInput,
} from '@/lib/accounting/financialReportClassification';
import { getPayrollExpenseFromLedger, getPayrollExpenseFromLedgerForDateRange } from '@/lib/accounting/payrollExpenseFromLedger';
import type {
  ClassifiedTotals,
  ClassificationBreakdownItem,
  FinancialReportClassificationPayload,
} from '@/lib/types/financial-report-classification';

export interface DateRangeClassificationParams {
  startDate: string;
  endDate: string;
  /** Invoice-based sales revenue override for profit semantics */
  salesRevenueOverride?: number | null;
  invTypeFilter?: 'all' | 'income' | 'expense';
}

export interface MonthClassificationParams {
  year: number;
  month: number;
  salesRevenueOverride?: number | null;
  invTypeFilter?: 'all' | 'income' | 'expense';
}

interface DbCashMoveRow {
  invType: string;
  inOut: string;
  amount: number;
  categoryName: string | null;
  isPayrollDeduction: boolean;
  isEmployeePayrollIncome: boolean;
  txnKind: string | null;
  empIdFromMap: number | null;
  empId: number | null;
}

const CASH_MOVE_CLASSIFICATION_QUERY = `
  SELECT
    cm.invType,
    cm.inOut,
    cm.GrandTolal AS amount,
    ISNULL(cat.CatName, N'') AS categoryName,
    ISNULL(cm.IsPayrollDeduction, 0) AS isPayrollDeduction,
    ISNULL(cm.IsEmployeePayrollIncome, 0) AS isEmployeePayrollIncome,
    cm.EmpID AS empId,
    map.TxnKind AS txnKind,
    map.EmpID AS empIdFromMap
  FROM dbo.TblCashMove cm
  LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
  OUTER APPLY (
    SELECT TOP 1 m.TxnKind, m.EmpID
    FROM dbo.TblExpCatEmpMap m
    WHERE m.ExpINID = cm.ExpINID AND m.IsActive = 1
    ORDER BY m.ID DESC
  ) map
  WHERE cm.invDate >= @startDate AND cm.invDate <= @endDate
`;

function mapDbRow(row: DbCashMoveRow): CashMoveForReportInput {
  return {
    invType: row.invType,
    inOut: row.inOut,
    amount: Number(row.amount) || 0,
    categoryName: row.categoryName,
    isPayrollDeduction: Boolean(row.isPayrollDeduction),
    isEmployeePayrollIncome: Boolean(row.isEmployeePayrollIncome),
    txnKind: row.txnKind,
    empIdFromMap: row.empIdFromMap,
    empId: row.empId,
  };
}

function filterRowsByInvType(
  rows: CashMoveForReportInput[],
  filter: 'all' | 'income' | 'expense',
): CashMoveForReportInput[] {
  if (filter === 'all') return rows;
  if (filter === 'income') {
    return rows.filter(
      (r) => r.inOut === 'in' && (r.invType === 'ايرادات' || r.invType === 'مبيعات' || r.invType === 'مبيعات بالكارت'),
    );
  }
  return rows.filter((r) => r.inOut === 'out' && r.invType === 'مصروفات');
}

export async function fetchCashMovesForClassification(
  startDate: string,
  endDate: string,
): Promise<CashMoveForReportInput[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(CASH_MOVE_CLASSIFICATION_QUERY);

  return result.recordset.map((row: DbCashMoveRow) => mapDbRow(row));
}

export async function buildClassifiedReportForDateRange(
  params: DateRangeClassificationParams,
): Promise<{
  classifiedTotals: ClassifiedTotals;
  classificationBreakdown: ClassificationBreakdownItem[];
  payrollExpenseFromLedger: number;
}> {
  const allRows = await fetchCashMovesForClassification(params.startDate, params.endDate);
  const filteredRows = filterRowsByInvType(allRows, params.invTypeFilter ?? 'all');
  const { classifiedTotals, classificationBreakdown } = aggregateClassifiedCashMoves(filteredRows);

  const payroll = params.startDate.slice(0, 7) === params.endDate.slice(0, 7)
    ? await getPayrollExpenseFromLedger({
        year: parseInt(params.startDate.slice(0, 4), 10),
        month: parseInt(params.startDate.slice(5, 7), 10),
      })
    : await getPayrollExpenseFromLedgerForDateRange({
        startDate: params.startDate,
        endDate: params.endDate,
      });

  classifiedTotals.payrollExpenseFromLedger = payroll.totalPayrollExpense;

  if (params.salesRevenueOverride != null && params.salesRevenueOverride >= 0) {
    classifiedTotals.salesRevenue = roundMoney(params.salesRevenueOverride);
  }

  classifiedTotals.cleanNetProfit = computeCleanNetProfit(classifiedTotals);

  return {
    classifiedTotals,
    classificationBreakdown,
    payrollExpenseFromLedger: payroll.totalPayrollExpense,
  };
}

export async function buildClassifiedReportForMonth(
  params: MonthClassificationParams,
): Promise<{
  classifiedTotals: ClassifiedTotals;
  classificationBreakdown: ClassificationBreakdownItem[];
  payrollExpenseFromLedger: number;
}> {
  const { startDate, endDate } = getMonthDateRange(params.year, params.month);
  return buildClassifiedReportForDateRange({
    startDate,
    endDate,
    salesRevenueOverride: params.salesRevenueOverride,
    invTypeFilter: params.invTypeFilter,
  });
}


export async function maybeBuildClassificationPayload(
  params: MonthClassificationParams & {
    legacyTotals?: Record<string, number>;
  },
): Promise<FinancialReportClassificationPayload> {
  if (!isFinancialReportClassificationEnabled()) {
    return buildDisabledClassificationPayload();
  }

  const { classifiedTotals, classificationBreakdown } =
    await buildClassifiedReportForMonth(params);

  return {
    classificationEnabled: true,
    legacyTotals: params.legacyTotals,
    classifiedTotals,
    classificationBreakdown,
  };
}

export async function maybeBuildClassificationPayloadForDateRange(
  params: DateRangeClassificationParams & {
    legacyTotals?: Record<string, number>;
  },
): Promise<FinancialReportClassificationPayload> {
  if (!isFinancialReportClassificationEnabled()) {
    return buildDisabledClassificationPayload();
  }

  const { classifiedTotals, classificationBreakdown } =
    await buildClassifiedReportForDateRange(params);

  return {
    classificationEnabled: true,
    legacyTotals: params.legacyTotals,
    classifiedTotals,
    classificationBreakdown,
  };
}

export function mergeIncomeOnlyClassification(
  payload: FinancialReportClassificationPayload,
): FinancialReportClassificationPayload {
  if (!payload.classifiedTotals) return payload;

  const totals = { ...payload.classifiedTotals };
  totals.cashOutTotal = 0;
  totals.operatingExpense = 0;
  totals.employeeAdvances = 0;
  totals.employeePayouts = 0;
  totals.legacyPayrollExpense = 0;
  totals.internalTransfers = 0;
  totals.uncategorizedCashOut = 0;
  totals.cleanNetProfit = computeCleanNetProfit(totals);

  return {
    ...payload,
    classifiedTotals: totals,
    classificationBreakdown: payload.classificationBreakdown?.filter(
      (item) => !item.bucket.endsWith('Out')
        && !['operatingExpense', 'employeeAdvances', 'employeePayouts', 'legacyPayrollExpense', 'internalTransfers'].includes(item.bucket),
    ),
  };
}

export function mergeExpenseOnlyClassification(
  payload: FinancialReportClassificationPayload,
): FinancialReportClassificationPayload {
  if (!payload.classifiedTotals) return payload;

  const base = createEmptyClassifiedTotals();
  const src = payload.classifiedTotals;
  base.operatingExpense = src.operatingExpense;
  base.employeeAdvances = src.employeeAdvances;
  base.employeePayouts = src.employeePayouts;
  base.legacyPayrollExpense = src.legacyPayrollExpense;
  base.internalTransfers = src.internalTransfers;
  base.uncategorizedCashOut = src.uncategorizedCashOut;
  base.payrollExpenseFromLedger = src.payrollExpenseFromLedger;
  base.cashOutTotal = src.cashOutTotal;

  return {
    ...payload,
    classifiedTotals: base,
    classificationBreakdown: payload.classificationBreakdown?.filter(
      (item) =>
        ['operatingExpense', 'employeeAdvances', 'employeePayouts', 'legacyPayrollExpense', 'internalTransfers', 'payrollExpenseFromLedger', 'uncategorizedCashOut'].includes(item.bucket),
    ),
  };
}
