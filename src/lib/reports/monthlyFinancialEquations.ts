import { roundMoney } from '@/lib/reportMonthUtils';
import type { Partner, PartnerProfitShare } from '@/lib/types/monthly-report';

export type MonthlyFinancialEquationsMode = 'monthly' | 'partners';

export interface MonthlyFinancialEquationsInput {
  year: number;
  month: number;
  baseAmount: number;
  mode: MonthlyFinancialEquationsMode;
  /**
   * Phase 1E: branch-scoped partner shares (from getEffectiveBranchPartnerShares).
   * Required — production report paths must resolve real shares per branch;
   * the legacy hardcoded PARTNERS constant is no longer used as a default.
   */
  partners: readonly Partner[];
  baseAmountAlreadyNetOfEmployees?: boolean;
  baseAmountAlreadyNetOfOperatingExpenses?: boolean;
}

export interface MonthlyFinancialEquationsResult {
  year: number;
  month: number;
  mode: MonthlyFinancialEquationsMode;
  baseAmount: number;
  finalDistributableAmount: number;
  partnerShares: PartnerProfitShare[];
  totalPartnerShares: number;
  roundingDifference: number;
  isLoss: boolean;
}

export function calculatePartnerProfitShares(
  distributableAmount: number,
  partners: readonly Partner[]
): PartnerProfitShare[] {
  if (!partners || partners.length === 0) {
    throw new Error('partner shares must be provided');
  }
  const base = Number.isFinite(distributableAmount) ? distributableAmount : 0;

  return partners.map((partner) => ({
    ...partner,
    profitShare: base * (partner.percentage / 100),
  }));
}

export function calculateMonthlyFinancialEquations(
  input: MonthlyFinancialEquationsInput
): MonthlyFinancialEquationsResult {
  const baseAmount = Number.isFinite(input.baseAmount) ? input.baseAmount : 0;

  // Partners mode starts from operatingNet; monthly mode starts from treasury netProfit.
  // Neither mode applies further salary, advance, or operating-expense deductions here.
  const finalDistributableAmount = roundMoney(baseAmount);
  const partnerShares = calculatePartnerProfitShares(finalDistributableAmount, input.partners);
  const totalPartnerShares = roundMoney(
    partnerShares.reduce((sum, partner) => sum + partner.profitShare, 0)
  );

  return {
    year: input.year,
    month: input.month,
    mode: input.mode,
    baseAmount: finalDistributableAmount,
    finalDistributableAmount,
    partnerShares,
    totalPartnerShares,
    roundingDifference: roundMoney(finalDistributableAmount - totalPartnerShares),
    isLoss: finalDistributableAmount < 0,
  };
}

export function formatPartnerPercentage(percentage: number): string {
  return `${percentage.toFixed(4)}%`;
}
