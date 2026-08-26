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
import { getEmployeeLedgerSummary } from '@/lib/services/employeeLedgerService';
import { computeEmployeeWithdrawalBuckets } from '@/lib/hr/employee-withdrawal-buckets';
import {
  applyEmployeePartnerOverride,
  getEmployeePartnerOverrideFromMap,
  getOverrideEmployeeIdsFromMap,
  type EmployeeMonthlyOverride,
  type PartnersOverridesMap,
} from '@/lib/reports/partnersEmployeeOverrides';
import { loadPartnersEmployeeOverridesForBranch } from '@/lib/reports/partnersEmployeeOverridesStore';
import { filterOperatingExpenseCategories } from '@/lib/reports/partnersExpenseCategories';
import { isFinancialReportClassificationEnabled } from '@/lib/accounting/financialReportFlags';
import { maybeBuildClassificationPayload } from '@/lib/accounting/financialReportClassificationService';
import { getBranchById } from '@/lib/branch/repository';
import { getEffectiveBranchPartnerShares, toPartnerPercentageList } from '@/lib/branch/partnerShares';

export type PartnersEmployeeControlLive = {
  shopRevenue: number | null;
  salaryAndTarget: number;
  advanceExcess: number;
  ledgerSalary: number;
  ledgerTarget: number;
};

export type PartnersEmployeeControlRow = {
  employeeId: number;
  employeeName: string;
  isServiceWorker: boolean;
  live: PartnersEmployeeControlLive;
  override: EmployeeMonthlyOverride | null;
};

export async function buildPartnersMonthlyReport(
  year: number,
  month: number,
  branchId: number,
): Promise<PartnersMonthlyReportResponse> {
  const period = getMonthDateRange(year, month);
  const ledgerMonth = `${year}-${String(month).padStart(2, '0')}`;

  const branch = await getBranchById(branchId);
  if (!branch) {
    throw new Error('الفرع غير موجود');
  }
  const [
    totalRevenue,
    revenueByEmployee,
    actualRevenueByEmployee,
    employeeJobs,
    employeeNames,
    expensesData,
    advanceRows,
    partnerOverrides,
    ledgerSummary,
    partnerShares,
  ] = await Promise.all([
    getEmployeeServicesRevenue(year, month, branchId),
    getEmployeeServicesRevenueByEmployee(year, month, branchId),
    getEmployeeActualInvoiceRevenueByEmployee(year, month, branchId),
    getEmployeeJobById(),
    getEmployeeNamesById(),
    getMonthlyExpensesByCategory(year, month, branchId),
    getMonthlyEmployeeAdvances(year, month, branchId),
    loadPartnersEmployeeOverridesForBranch(branch.branchId, branch.branchCode),
    getEmployeeLedgerSummary(ledgerMonth, branchId),
    getEffectiveBranchPartnerShares(branchId, period.endDate),
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

  const { employeeSummary } = mapPartnersEmployeeRows({
    year,
    month,
    actualRevenueByEmployee,
    advanceRows,
    employeeJobs,
    employeeNames,
    ledgerSummaryEmployees: ledgerSummary.employees,
    partnerOverrides,
  });

  const employeeSummaryTotals = {
    totalShopRevenue: roundMoney(
      employeeSummary.reduce((sum, row) => sum + (row.shopRevenue ?? 0), 0)
    ),
    totalPaidSalaryAndAdvances: roundMoney(
      employeeSummary.reduce((sum, row) => sum + row.paidSalaryAndAdvances, 0)
    ),
    totalSalaryAndTarget: roundMoney(
      employeeSummary.reduce((sum, row) => sum + row.salaryAndTarget, 0)
    ),
    totalAdvanceExcess: roundMoney(
      employeeSummary.reduce((sum, row) => sum + row.advanceExcess, 0)
    ),
  };

  const totalEmployeeAdvances = employeeSummaryTotals.totalPaidSalaryAndAdvances;
  const operatingNet = roundMoney(
    totalRevenue - totalEmployeeAdvances - operatingExpenses
  );
  const operatingNetExplanation =
    'بعد خصم الرواتب والسلف من قسم الموظفين ومصروفات التشغيل الأخرى بعد استبعاد سلف وتارجت الموظفين';

  const partners = toPartnerPercentageList(partnerShares);

  const baseReport = {
    period,
    partners,
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

  if (!isFinancialReportClassificationEnabled()) {
    return baseReport;
  }

  const classification = await maybeBuildClassificationPayload({
    year,
    month,
    branchId,
    salesRevenueOverride: totalRevenue,
    legacyTotals: {
      totalRevenue,
      totalExpenses,
      operatingExpenses,
      operatingNet,
    },
  });

  const cleanNetProfit = classification.classifiedTotals?.cleanNetProfit ?? operatingNet;

  return {
    ...baseReport,
    ...classification,
    classifiedPartnerSplit: {
      cleanNetProfit,
      legacyOperatingNet: operatingNet,
      explanation:
        'تم احتساب صافي الربح بعد استبعاد السلف وصرف المستحقات وحركات الموظفين غير الربحية، وإضافة تكلفة الرواتب من دفتر الموظفين.',
    },
  };
}

export async function buildPartnersEmployeeControlSheet(
  year: number,
  month: number,
  branchId: number,
): Promise<{
  branchId: number;
  branchCode: string;
  branchName: string;
  employees: PartnersEmployeeControlRow[];
}> {
  const ledgerMonth = `${year}-${String(month).padStart(2, '0')}`;
  const branch = await getBranchById(branchId);
  if (!branch) {
    throw new Error('الفرع غير موجود');
  }

  const [
    actualRevenueByEmployee,
    employeeJobs,
    employeeNames,
    advanceRows,
    partnerOverrides,
    ledgerSummary,
  ] = await Promise.all([
    getEmployeeActualInvoiceRevenueByEmployee(year, month, branchId),
    getEmployeeJobById(),
    getEmployeeNamesById(),
    getMonthlyEmployeeAdvances(year, month, branchId),
    loadPartnersEmployeeOverridesForBranch(branch.branchId, branch.branchCode),
    getEmployeeLedgerSummary(ledgerMonth, branchId),
  ]);

  const { controlRows } = mapPartnersEmployeeRows({
    year,
    month,
    actualRevenueByEmployee,
    advanceRows,
    employeeJobs,
    employeeNames,
    ledgerSummaryEmployees: ledgerSummary.employees,
    partnerOverrides,
  });

  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    employees: controlRows,
  };
}

function mapPartnersEmployeeRows(input: {
  year: number;
  month: number;
  actualRevenueByEmployee: Array<{
    employeeId: number;
    employeeName: string;
    actualInvoiceRevenue: number;
  }>;
  advanceRows: Array<{ employeeId: number; employeeName: string; totalAdvance: number }>;
  employeeJobs: Map<number, string>;
  employeeNames: Map<number, string>;
  ledgerSummaryEmployees: Array<{
    empId: number;
    empName: string;
    salaryCredits: number;
    targetCredits: number;
    advanceDebits: number;
    payoutDebits: number;
    fundingCredits: number;
  }>;
  partnerOverrides: PartnersOverridesMap;
}) {
  const {
    year,
    month,
    actualRevenueByEmployee,
    advanceRows,
    employeeJobs,
    employeeNames,
    ledgerSummaryEmployees,
    partnerOverrides,
  } = input;

  const actualRevenueById = new Map(
    actualRevenueByEmployee.map((row) => [row.employeeId, row])
  );
  const advancesById = new Map(advanceRows.map((row) => [row.employeeId, row]));
  const ledgerById = new Map(ledgerSummaryEmployees.map((row) => [row.empId, row]));
  const ledgerActiveEmployeeIds = ledgerSummaryEmployees
    .filter(
      (row) =>
        row.salaryCredits > 0 ||
        row.targetCredits > 0 ||
        row.advanceDebits > 0 ||
        row.payoutDebits > 0
    )
    .map((row) => row.empId);
  const employeeIds = new Set<number>([
    ...actualRevenueByEmployee.map((row) => row.employeeId),
    ...advanceRows.map((row) => row.employeeId),
    ...getOverrideEmployeeIdsFromMap(partnerOverrides, year, month),
    ...ledgerActiveEmployeeIds,
  ]);

  const rows = [...employeeIds].map((employeeId) => {
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

    const ledger = ledgerById.get(employeeId);
    const ledgerSalary = roundMoney(ledger?.salaryCredits ?? 0);
    const ledgerTarget = roundMoney(ledger?.targetCredits ?? 0);
    const liveSalaryAndTarget = roundMoney(ledgerSalary + ledgerTarget);
    const fundingCredits = roundMoney(ledger?.fundingCredits ?? 0);
    const { moneyTaken, advanceExcess: liveAdvanceExcess } = computeEmployeeWithdrawalBuckets({
      advanceDebits: ledger?.advanceDebits ?? 0,
      payoutDebits: ledger?.payoutDebits ?? 0,
      salaryAndTarget: liveSalaryAndTarget,
      revenue: fundingCredits,
    });

    const override = getEmployeePartnerOverrideFromMap(
      partnerOverrides,
      employeeId,
      year,
      month
    );
    const overridden = applyEmployeePartnerOverride({
      override,
      actualRevenue: baseShopRevenue,
      paidSalaryOrAdvance: calculatedPaid,
      salaryAndTarget: liveSalaryAndTarget,
      advanceExcess: liveAdvanceExcess,
      isServiceWorker,
    });

    const employeeName =
      actual?.employeeName ??
      advance?.employeeName ??
      ledger?.empName ??
      employeeNames.get(employeeId) ??
      'غير محدد';

    return {
      summary: {
        employeeId,
        employeeName,
        isServiceWorker,
        shopRevenue: overridden.shopRevenue,
        paidSalaryAndAdvances: overridden.paidSalaryAndAdvances,
        hasSpecialAccounting: overridden.hasSpecialAccounting,
        ledgerSalary,
        ledgerTarget,
        salaryAndTarget: overridden.salaryAndTarget,
        moneyTaken,
        advanceExcess: overridden.advanceExcess,
      },
      control: {
        employeeId,
        employeeName,
        isServiceWorker,
        live: {
          shopRevenue: baseShopRevenue,
          salaryAndTarget: liveSalaryAndTarget,
          advanceExcess: liveAdvanceExcess,
          ledgerSalary,
          ledgerTarget,
        },
        override: override ?? null,
      } satisfies PartnersEmployeeControlRow,
    };
  });

  rows.sort((a, b) => {
    const revenueDiff = (b.summary.shopRevenue ?? -1) - (a.summary.shopRevenue ?? -1);
    if (revenueDiff !== 0) return revenueDiff;
    return a.summary.employeeName.localeCompare(b.summary.employeeName, 'ar');
  });

  return {
    employeeSummary: rows.map((row) => row.summary),
    controlRows: rows.map((row) => row.control),
  };
}
