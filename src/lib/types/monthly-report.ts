// ───────────────────────── Monthly Business Report Types ─────────────────────────

export interface DailyRevenueExpensesData {
  day: string; // ISO date string (YYYY-MM-DD)
  revenue: number;
  expenses: number;
}

export interface MonthlyBusinessReport {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  totalInvoices: number;
  dailyData?: DailyRevenueExpensesData[]; // Optional for simplified report
}

export interface Partner {
  name: string;
  percentage: number;
}

export interface PartnerProfitShare extends Partner {
  profitShare: number;
}

// Fixed partner configuration for Phase 1 MVP
export const PARTNERS: Partner[] = [
  { name: 'زياد', percentage: 36.66666666666667 },
  { name: 'محمد حمدي', percentage: 31.66666666666667 },
  { name: 'علي الزيني', percentage: 31.66666666666667 },
];
