export type GroupDailyDayStatus = 'open' | 'closed' | 'missing';

export type GroupDailyPaymentMethod = {
  paymentMethodId: number | null;
  paymentMethodKey: string;
  paymentMethodName: string;
  inflow: number;
  outflow: number;
  net: number;
  transactionCount: number;
  salesInflow: number;
  incomeInflow: number;
  percentageOfTotal: number;
};

export type GroupDailyBranchSummary = {
  branchId: number;
  branchCode: string;
  branchName: string;
  dayStatus: GroupDailyDayStatus;
  businessDayId: number | null;
  totalInflow: number;
  totalOutflow: number;
  grandNet: number;
  cashNet: number;
  transactionCount: number;
  salesInflow: number;
  incomeInflow: number;
  expenseOutflow: number;
  paymentMethods: GroupDailyPaymentMethod[];
  topUsers: Array<{
    userId: number;
    userName: string;
    net: number;
    transactionCount: number;
  }>;
};

export type GroupDailyIntegrityAlert = {
  code: string;
  message: string;
  count: number;
};

export type GroupDailyTreasuryResult = {
  day: string;
  groupSummary: {
    totalInflow: number;
    totalOutflow: number;
    grandNet: number;
    cashNet: number;
    transactionCount: number;
    salesInflow: number;
    incomeInflow: number;
    expenseOutflow: number;
    topPaymentMethod: string | null;
    branchCount: number;
    openDayCount: number;
    closedDayCount: number;
    missingDayCount: number;
    branchesWithActivity: number;
  };
  paymentMethods: GroupDailyPaymentMethod[];
  branches: GroupDailyBranchSummary[];
  alerts: GroupDailyIntegrityAlert[];
};
