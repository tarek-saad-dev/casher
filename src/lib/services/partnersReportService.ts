import 'server-only';

import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import {
  getEmployeeServicesRevenue,
  getEmployeeServicesRevenueByEmployee,
} from '@/lib/services/employeeServicesReportService';
import {
  areAdvancesIncludedInExpenses,
  calculateOperatingNet,
  getMonthlyEmployeeAdvances,
  getMonthlyExpensesByCategory,
  getOperatingNetExplanation,
} from '@/lib/services/monthlyExpensesReportService';

export async function buildPartnersMonthlyReport(
  year: number,
  month: number
): Promise<PartnersMonthlyReportResponse> {
  const period = getMonthDateRange(year, month);

  const [totalRevenue, revenueByEmployee, expensesData, advanceRows] = await Promise.all([
    getEmployeeServicesRevenue(year, month),
    getEmployeeServicesRevenueByEmployee(year, month),
    getMonthlyExpensesByCategory(year, month),
    getMonthlyEmployeeAdvances(year, month),
  ]);

  const { totalExpenses, categories } = expensesData;
  const totalEmployeeAdvances = roundMoney(
    advanceRows.reduce((sum, row) => sum + row.totalAdvance, 0)
  );
  const advancesIncludedInExpenses = areAdvancesIncludedInExpenses();
  const operatingNet = calculateOperatingNet(
    totalRevenue,
    totalExpenses,
    totalEmployeeAdvances,
    advancesIncludedInExpenses
  );

  const revenueDetails = revenueByEmployee.map((row) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    serviceRevenue: row.serviceRevenue,
    totalRevenue: row.totalRevenue,
    transactionCount: row.transactionCount,
    invoiceCount: row.invoiceCount,
    percentage: totalRevenue > 0 ? roundMoney((row.totalRevenue / totalRevenue) * 100) : 0,
  }));

  const expensesByCategory = categories.map((cat) => ({
    categoryId: cat.ExpINID ?? null,
    categoryName: cat.CatName,
    transactionCount: cat.Count,
    totalAmount: roundMoney(cat.Amount),
    percentage: roundMoney(cat.Percentage),
  }));

  const employeeAdvances = advanceRows.map((row) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    transactionCount: row.transactionCount,
    totalAdvance: row.totalAdvance,
    percentage: totalEmployeeAdvances > 0
      ? roundMoney((row.totalAdvance / totalEmployeeAdvances) * 100)
      : 0,
  }));

  return {
    period,
    summary: {
      totalRevenue,
      totalExpenses,
      totalEmployeeAdvances,
      advancesIncludedInExpenses,
      operatingNet,
      operatingNetExplanation: getOperatingNetExplanation(advancesIncludedInExpenses),
    },
    revenueDetails,
    expensesByCategory,
    employeeAdvances,
    metadata: {
      generatedAt: new Date().toISOString(),
    },
  };
}
