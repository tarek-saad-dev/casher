import 'server-only';

import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import {
  getEmployeeActualInvoiceRevenueByEmployee,
  getEmployeeJobById,
  getEmployeeNamesById,
  getEmployeeServicesRevenue,
  getEmployeeServicesRevenueByEmployee,
  isBarberOrServiceWorker,
} from '@/lib/services/employeeServicesReportService';
import {
  getMonthlyEmployeeAdvances,
  getMonthlyExpensesByCategory,
} from '@/lib/services/monthlyExpensesReportService';
import {
  applyEmployeePartnerOverride,
  getEmployeePartnerOverrideFromMap,
  getOverrideEmployeeIdsFromMap,
} from '@/lib/reports/partnersEmployeeOverrides';
import { loadPartnersEmployeeOverrides } from '@/lib/reports/partnersEmployeeOverridesStore';
import { filterOperatingExpenseCategories } from '@/lib/reports/partnersExpenseCategories';

export async function buildPartnersMonthlyReport(
  year: number,
  month: number
): Promise<PartnersMonthlyReportResponse> {
  const period = getMonthDateRange(year, month);

  const [
    totalRevenue,
    revenueByEmployee,
    actualRevenueByEmployee,
    employeeJobs,
    employeeNames,
    expensesData,
    advanceRows,
    partnerOverrides,
  ] = await Promise.all([
    getEmployeeServicesRevenue(year, month),
    getEmployeeServicesRevenueByEmployee(year, month),
    getEmployeeActualInvoiceRevenueByEmployee(year, month),
    getEmployeeJobById(),
    getEmployeeNamesById(),
    getMonthlyExpensesByCategory(year, month),
    getMonthlyEmployeeAdvances(year, month),
    loadPartnersEmployeeOverrides(),
  ]);

  const { totalExpenses, categories } = expensesData;
  const rawTotalEmployeeAdvances = roundMoney(
    advanceRows.reduce((sum, row) => sum + row.totalAdvance, 0)
  );

  const rawExpenseCategories = categories.map((cat) => ({
    categoryId: cat.ExpINID ?? null,
    categoryName: cat.CatName,
    transactionCount: cat.Count,
    totalAmount: roundMoney(cat.Amount),
  }));

  const {
    operatingCategories,
    operatingExpenses,
    excludedEmployeeSettlementExpenses,
  } = filterOperatingExpenseCategories(rawExpenseCategories, totalExpenses);

  const expensesByCategory = operatingCategories;

  const revenueDetails = revenueByEmployee.map((row) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    serviceRevenue: row.serviceRevenue,
    totalRevenue: row.totalRevenue,
    transactionCount: row.transactionCount,
    invoiceCount: row.invoiceCount,
    percentage: totalRevenue > 0 ? roundMoney((row.totalRevenue / totalRevenue) * 100) : 0,
  }));

  const employeeAdvances = advanceRows.map((row) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    transactionCount: row.transactionCount,
    totalAdvance: row.totalAdvance,
    percentage: rawTotalEmployeeAdvances > 0
      ? roundMoney((row.totalAdvance / rawTotalEmployeeAdvances) * 100)
      : 0,
  }));

  const actualRevenueById = new Map(
    actualRevenueByEmployee.map((row) => [row.employeeId, row])
  );
  const advancesById = new Map(advanceRows.map((row) => [row.employeeId, row]));
  const employeeIds = new Set<number>([
    ...actualRevenueByEmployee.map((row) => row.employeeId),
    ...advanceRows.map((row) => row.employeeId),
    ...getOverrideEmployeeIdsFromMap(partnerOverrides, year, month),
  ]);

  const employeeSummary = [...employeeIds]
    .map((employeeId) => {
      const actual = actualRevenueById.get(employeeId);
      const advance = advancesById.get(employeeId);
      const job = employeeJobs.get(employeeId) ?? '';
      const calculatedActualRevenue = actual?.actualInvoiceRevenue ?? 0;
      const calculatedPaid = roundMoney(advance?.totalAdvance ?? 0);
      const isServiceWorker =
        isBarberOrServiceWorker(job) || calculatedActualRevenue > 0;

      const baseShopRevenue = isServiceWorker
        ? roundMoney(calculatedActualRevenue)
        : null;

      const overridden = applyEmployeePartnerOverride({
        override: getEmployeePartnerOverrideFromMap(
          partnerOverrides,
          employeeId,
          year,
          month
        ),
        actualRevenue: baseShopRevenue,
        paidSalaryOrAdvance: calculatedPaid,
        isServiceWorker,
      });

      return {
        employeeId,
        employeeName:
          actual?.employeeName ??
          advance?.employeeName ??
          employeeNames.get(employeeId) ??
          'غير محدد',
        isServiceWorker,
        shopRevenue: overridden.shopRevenue,
        paidSalaryAndAdvances: overridden.paidSalaryAndAdvances,
        hasSpecialAccounting: overridden.hasSpecialAccounting,
      };
    })
    .sort((a, b) => {
      const revenueDiff = (b.shopRevenue ?? -1) - (a.shopRevenue ?? -1);
      if (revenueDiff !== 0) return revenueDiff;
      return a.employeeName.localeCompare(b.employeeName, 'ar');
    });

  const employeeSummaryTotals = {
    totalShopRevenue: roundMoney(
      employeeSummary.reduce((sum, row) => sum + (row.shopRevenue ?? 0), 0)
    ),
    totalPaidSalaryAndAdvances: roundMoney(
      employeeSummary.reduce((sum, row) => sum + row.paidSalaryAndAdvances, 0)
    ),
  };

  const totalEmployeeAdvances = employeeSummaryTotals.totalPaidSalaryAndAdvances;
  const operatingNet = roundMoney(
    totalRevenue - totalEmployeeAdvances - operatingExpenses
  );
  const operatingNetExplanation =
    'بعد خصم الرواتب والسلف من قسم الموظفين ومصروفات التشغيل الأخرى بعد استبعاد سلف وتارجت الموظفين';

  return {
    period,
    summary: {
      totalRevenue,
      totalExpenses,
      operatingExpenses,
      excludedEmployeeSettlementExpenses,
      totalEmployeeAdvances,
      advancesIncludedInExpenses: false,
      operatingNet,
      operatingNetExplanation,
    },
    revenueDetails,
    expensesByCategory,
    employeeAdvances,
    employeeSummary,
    employeeSummaryTotals,
    metadata: {
      generatedAt: new Date().toISOString(),
    },
  };
}
