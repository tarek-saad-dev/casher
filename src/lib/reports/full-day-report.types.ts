export interface FullDayMoneyLine {
  id: number;
  label: string;
  amount: number;
  meta?: string | null;
}

export interface FullDayEmployeeRow {
  empId: number;
  empName: string;
  checkIn: string | null;
  checkOut: string | null;
  actualHours: number | null;
  attendanceStatus: string | null;
  baseWage: number;
  targetAmount: number;
  targetSales: number | null;
  dayTotal: number;
  payrollStatus: string | null;
  hasPhone: boolean;
}

export interface FullDayGroupedMoneyLine {
  key: string;
  label: string;
  amount: number;
  count: number;
  meta?: string | null;
}

/** Owner treasury lens: cash in vs cash out (includes advances). */
export interface FullDayTreasuryReport {
  inflows: {
    sales: number;
    incomes: number;
    total: number;
  };
  outflows: {
    operatingTotal: number;
    advancesTotal: number;
    total: number;
    operatingByCategory: FullDayGroupedMoneyLine[];
    advancesByEmployee: FullDayGroupedMoneyLine[];
  };
  /** إجمالي المدخلات − إجمالي المصروفات (شامل السلف) */
  net: number;
}

/** Owner operating lens: same numbers as the main day report. */
export interface FullDayOwnerDaySnapshot {
  sales: number;
  incomes: number;
  operatingExpenses: number;
  staffBase: number;
  staffTarget: number;
  staffCost: number;
  totalIn: number;
  totalOut: number;
  net: number;
}

export interface FullDayEmployeeAccountRow {
  empId: number;
  empName: string;
  /** أساسي اليوم */
  dayBase: number;
  /** تارجت اليوم */
  dayTarget: number;
  /** إجمالي استحقاق اليوم */
  dayTotal: number;
  /** سلف اليوم (مجمّعة) */
  advancesToday: number;
  /** رصيد حساب الموظف في الدفتر لهذا الشهر حتى الآن */
  ledgerBalance: number;
}

export interface FullDayEmployeeAccounts {
  payrollMonth: string;
  totalDayCost: number;
  totalAdvancesToday: number;
  totalLedgerBalance: number;
  rows: FullDayEmployeeAccountRow[];
}

export interface FullDayReport {
  workDate: string;
  workDateLabelAr: string;
  timezone: 'Africa/Cairo';
  sales: {
    total: number;
    invoiceCount: number;
    customerCount: number;
    averageInvoice: number;
  };
  incomes: {
    total: number;
    count: number;
    lines: FullDayMoneyLine[];
  };
  expenses: {
    total: number;
    count: number;
    lines: FullDayMoneyLine[];
  };
  payroll: {
    wageTotal: number;
    targetTotal: number;
    staffCostTotal: number;
    employeeCount: number;
    presentCount: number;
    employees: FullDayEmployeeRow[];
  };
  profit: {
    /** مبيعات + إيرادات */
    totalIn: number;
    /** مصروفات + أساسي + تارجت */
    totalOut: number;
    /** صافي ربح اليوم */
    net: number;
  };
  /** Owner section — operating day report (mirrors profit above) */
  ownerDay: FullDayOwnerDaySnapshot;
  /** Owner section — per-employee accounts / ledger balances */
  employeeAccounts: FullDayEmployeeAccounts;
  /** Owner section — treasury cash report */
  treasury: FullDayTreasuryReport;
  whatsapp: {
    readyToSend: number;
    missingPhone: number;
  };
}
