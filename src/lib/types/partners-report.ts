export interface PartnersMonthlyReportResponse {
  period: {
    year: number;
    month: number;
    startDate: string;
    endDate: string;
  };

  summary: {
    totalRevenue: number;
    totalExpenses: number;
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

  metadata: {
    generatedAt: string;
  };
}
