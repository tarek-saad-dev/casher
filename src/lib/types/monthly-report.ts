// ───────────────────────── Monthly Business Report Types ─────────────────────────

import type { FinancialReportClassificationPayload } from '@/lib/types/financial-report-classification';

export interface DailyRevenueExpensesData {
  day: string; // ISO date string (YYYY-MM-DD)
  revenue: number;
  expenses: number;
}

export type MonthlyBusinessReport = {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  totalInvoices: number;
  dailyData?: DailyRevenueExpensesData[]; // Optional for simplified report
  /** Phase 1E: effective branch partner shares resolved server-side. */
  partners?: Partner[];
} & Partial<FinancialReportClassificationPayload>;

export interface Partner {
  name: string;
  percentage: number;
}

export interface PartnerProfitShare extends Partner {
  profitShare: number;
}

/**
 * @deprecated Phase 1 MVP hardcoded configuration. Use
 * `getEffectiveBranchPartnerShares` (src/lib/branch/partnerShares.ts) instead.
 * Do NOT use this constant in production report calculation paths — it is
 * GLEEM-only and does not reflect per-branch or effective-dated shares.
 * Kept only for legacy tests that explicitly pass it.
 */
export const PARTNERS: Partner[] = [
  { name: 'زياد', percentage: 36.66666666666667 },
  { name: 'محمد حمدي', percentage: 31.66666666666667 },
  { name: 'علي الزيني', percentage: 31.66666666666667 },
];
