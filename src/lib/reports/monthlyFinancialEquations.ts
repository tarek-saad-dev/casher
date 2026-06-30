import { roundMoney } from '@/lib/reportMonthUtils';
import { PARTNERS, type Partner, type PartnerProfitShare } from '@/lib/types/monthly-report';

export type MonthlyFinancialEquationsMode = 'monthly' | 'partners';

export interface MonthlyFinancialEquationsInput {
  year: number;
  month: number;
  baseAmount: number;
  mode: MonthlyFinancialEquationsMode;
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
  partners: readonly Partner[] = PARTNERS
): PartnerProfitShare[] {
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
  const partnerShares = calculatePartnerProfitShares(finalDistributableAmount);
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
