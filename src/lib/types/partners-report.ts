import type { FinancialReportClassificationPayload } from '@/lib/types/financial-report-classification';

export interface PartnersExpenseCategoryTransaction {
  id: number;
  categoryId: number | null;
  categoryName: string;
  date: string;
  time: string | null;
  notes: string | null;
  paymentMethod: string | null;
  amount: number;
}

export interface PartnersMonthlyReportCore {
  period: {
    year: number;
    month: number;
    startDate: string;
    endDate: string;
  };

  summary: {
    totalRevenue: number;
    totalExpenses: number;
    operatingExpenses: number;
    excludedEmployeeSettlementExpenses: number;
    totalEmployeeAdvances: number;
    advancesIncludedInExpenses: boolean;
    operatingNet: number;
    operatingNetExplanation: string;
  };

  revenueDetails: Array<{
    employeeId: number | null;
    employeeName: string;
    serviceRevenue: number;
    productRevenue?: number;
    totalRevenue: number;
    transactionCount?: number;
    invoiceCount?: number;
    percentage: number;
  }>;

  expensesByCategory: Array<{
    categoryId: number | null;
    categoryName: string;
    transactionCount: number;
    totalAmount: number;
    percentage: number;
  }>;

  employeeAdvances: Array<{
    employeeId: number;
    employeeName: string;
    transactionCount?: number;
    totalAdvance: number;
    percentage: number;
    riskStatus?: {
      level: string;
      label: string;
    };
  }>;

  employeeSummary: Array<{
    employeeId: number;
    employeeName: string;
    isServiceWorker: boolean;
    shopRevenue: number | null;
    paidSalaryAndAdvances: number;
    hasSpecialAccounting?: boolean;
  }>;

  employeeSummaryTotals: {
    totalShopRevenue: number;
    totalPaidSalaryAndAdvances: number;
  };

  metadata: {
    generatedAt: string;
  };
}

export type PartnersMonthlyReportResponse = PartnersMonthlyReportCore &
  Partial<FinancialReportClassificationPayload> & {
    classifiedPartnerSplit?: {
      cleanNetProfit: number;
      legacyOperatingNet: number;
      explanation: string;
    };
  };
