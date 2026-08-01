import { roundMoney } from '@/lib/reportMonthUtils';
import type { Partner, PartnerProfitShare } from '@/lib/types/monthly-report';

export type MonthlyFinancialEquationsMode = 'monthly' | 'partners';

/** Management fee taken from partners-report total before partner distribution. */
export const PARTNERS_MANAGEMENT_FEE_PERCENT = 5;

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
  /** Amount before management fee (operating / clean net). */
  baseAmount: number;
  /** Percent applied in partners mode (0 in monthly mode or on loss). */
  managementFeePercent: number;
  /** Absolute management fee deducted before partner split. */
  managementFeeAmount: number;
  /** Amount distributed to partners after management fee. */
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

export function calculatePartnersManagementFee(
  baseAmount: number,
  feePercent: number = PARTNERS_MANAGEMENT_FEE_PERCENT
): { feePercent: number; feeAmount: number; afterFee: number } {
  const base = Number.isFinite(baseAmount) ? baseAmount : 0;
  // Fee only on positive totals — losses are distributed in full.
  if (base <= 0 || feePercent <= 0) {
    return { feePercent: 0, feeAmount: 0, afterFee: roundMoney(base) };
  }
  const feeAmount = roundMoney((base * feePercent) / 100);
  const afterFee = roundMoney(base - feeAmount);
  return { feePercent, feeAmount, afterFee };
}

export function calculateMonthlyFinancialEquations(
  input: MonthlyFinancialEquationsInput
): MonthlyFinancialEquationsResult {
  const baseAmount = roundMoney(Number.isFinite(input.baseAmount) ? input.baseAmount : 0);

  const fee =
    input.mode === 'partners'
      ? calculatePartnersManagementFee(baseAmount)
      : { feePercent: 0, feeAmount: 0, afterFee: baseAmount };

  const finalDistributableAmount = fee.afterFee;
  const partnerShares = calculatePartnerProfitShares(finalDistributableAmount, input.partners);
  const totalPartnerShares = roundMoney(
    partnerShares.reduce((sum, partner) => sum + partner.profitShare, 0)
  );

  return {
    year: input.year,
    month: input.month,
    mode: input.mode,
    baseAmount,
    managementFeePercent: fee.feePercent,
    managementFeeAmount: fee.feeAmount,
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
