import 'server-only';

import { getPool, sql } from '@/lib/db';
import { roundMoney } from '@/lib/reportMonthUtils';
import type { CategoryBreakdown } from '@/lib/types';

// Phase 1E: branch-scoped — every query below filters cm.BranchID = @branchId.
const EXPENSE_BASE_WHERE = `
  invType = N'مصروفات'
  AND inOut = N'out'
  AND YEAR(invDate) = @year
  AND MONTH(invDate) = @month
  AND BranchID = @branchId
`;

export interface EmployeeAdvanceRow {
  employeeId: number;
  employeeName: string;
  totalAdvance: number;
  transactionCount: number;
}

/**
 * Total monthly expenses — matches /api/reports/expenses/monthly summary (حسب الفئة tab total).
 */
export async function getMonthlyExpensesTotal(
  year: number,
  month: number,
  branchId: number,
): Promise<number> {
  const db = await getPool();

  const result = await db.request()
    .input('year', sql.Int, year)
    .input('month', sql.Int, month)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT ISNULL(SUM(GrandTolal), 0) AS TotalExpenses
      FROM [dbo].[TblCashMove]
      WHERE ${EXPENSE_BASE_WHERE}
    `);

  return roundMoney(result.recordset[0]?.TotalExpenses ?? 0);
}

/**
 * Category breakdown — matches /api/reports/expenses/monthly categoryBreakdown.
 */
export async function getMonthlyExpensesByCategory(
  year: number,
  month: number,
  branchId: number,
): Promise<{ totalExpenses: number; categories: CategoryBreakdown[] }> {
  const db = await getPool();
  const totalExpenses = await getMonthlyExpensesTotal(year, month, branchId);

  const categoryResult = await db.request()
    .input('year', sql.Int, year)
    .input('month', sql.Int, month)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        cm.ExpINID,
        ISNULL(cat.CatName, N'غير مصنف') AS CatName,
        SUM(cm.GrandTolal) AS Amount,
        COUNT(*) AS Count,
        AVG(cm.GrandTolal) AS AvgTransaction
      FROM [dbo].[TblCashMove] cm
      LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
      WHERE cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND YEAR(cm.invDate) = @year
        AND MONTH(cm.invDate) = @month
        AND cm.BranchID = @branchId
      GROUP BY cm.ExpINID, cat.CatName
      ORDER BY SUM(cm.GrandTolal) DESC
    `);

  const categories: CategoryBreakdown[] = categoryResult.recordset.map((row: {
    ExpINID: number;
    CatName: string;
    Amount: number;
    Count: number;
    AvgTransaction: number;
  }) => ({
    ExpINID: row.ExpINID,
    CatName: row.CatName,
    Amount: row.Amount,
    Count: row.Count,
    AvgTransaction: row.AvgTransaction,
    Percentage: totalExpenses > 0 ? (row.Amount / totalExpenses) * 100 : 0,
  }));

  return { totalExpenses, categories };
}

/**
 * Employee advances — matches /api/reports/expenses/employee-advances tab.
 */
export async function getMonthlyEmployeeAdvances(
  year: number,
  month: number,
  branchId: number,
): Promise<EmployeeAdvanceRow[]> {
  const db = await getPool();

  const advancesResult = await db.request()
    .input('year', sql.Int, year)
    .input('month', sql.Int, month)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        em.EmpID AS employeeId,
        e.EmpName AS employeeName,
        SUM(cm.GrandTolal) AS totalAdvance,
        COUNT(cm.ID) AS transactionCount
      FROM [dbo].[TblExpCatEmpMap] em
      INNER JOIN [dbo].[TblCashMove] cm ON em.ExpINID = cm.ExpINID
      INNER JOIN [dbo].[TblEmp] e ON em.EmpID = e.EmpID
      WHERE em.IsActive = 1
        AND em.TxnKind = N'advance'
        AND cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND YEAR(cm.invDate) = @year
        AND MONTH(cm.invDate) = @month
        AND cm.BranchID = @branchId
      GROUP BY em.EmpID, e.EmpName
      ORDER BY SUM(cm.GrandTolal) DESC
    `);

  return advancesResult.recordset.map((row: {
    employeeId: number;
    employeeName: string;
    totalAdvance: number;
    transactionCount: number;
  }) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    totalAdvance: roundMoney(row.totalAdvance ?? 0),
    transactionCount: row.transactionCount ?? 0,
  }));
}

/**
 * Employee advances are expense outflows in TblCashMove already included in totalExpenses.
 * The advances tab is a subset view via TblExpCatEmpMap — not a separate expense pool.
 */
export function areAdvancesIncludedInExpenses(): boolean {
  return true;
}

export function calculateOperatingNet(
  totalRevenue: number,
  totalExpenses: number,
  totalEmployeeAdvances: number,
  advancesIncludedInExpenses: boolean
): number {
  if (advancesIncludedInExpenses) {
    return roundMoney(totalRevenue - totalExpenses);
  }
  return roundMoney(totalRevenue - totalExpenses - totalEmployeeAdvances);
}

export function getOperatingNetExplanation(advancesIncludedInExpenses: boolean): string {
  if (advancesIncludedInExpenses) {
    return 'صافي التشغيل = إجمالي الإيرادات − إجمالي المصروفات (السلف مدرجة ضمن المصروفات)';
  }
  return 'صافي التشغيل = إجمالي الإيرادات − إجمالي المصروفات − سلف الموظفين';
}
