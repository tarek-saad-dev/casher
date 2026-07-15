import Decimal from 'decimal.js';
import type {
  CalculateDailyTargetOptions,
  DailyTargetBreakdownRow,
  DailyTargetCalculationResult,
  DailyTargetTier,
} from './target.types';
import {
  assertNonNegativeSales,
  normalizeTiersForCalculation,
} from './target.validation';

function toMoneyNumber(value: Decimal): number {
  return Number(value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
}

function toAmountNumber(value: Decimal, places = 6): number {
  return Number(value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toString());
}

/**
 * Progressive marginal daily target.
 * Round only the final total to 2 decimal places (piasters).
 */
export function calculateDailyTarget(
  netSalesAfterDiscount: number | string,
  tiers: DailyTargetTier[],
  options?: CalculateDailyTargetOptions,
): DailyTargetCalculationResult {
  const sales = assertNonNegativeSales(netSalesAfterDiscount);
  const normalized = normalizeTiersForCalculation(tiers, { sortTiers: options?.sortTiers });

  const breakdown: DailyTargetBreakdownRow[] = [];
  let totalTarget = new Decimal(0);
  let activeTierIndex: number | null = null;

  for (let i = 0; i < normalized.length; i++) {
    const tier = normalized[i];
    const from = new Decimal(tier.dailyStartAmount);
    const to = i + 1 < normalized.length
      ? new Decimal(normalized[i + 1].dailyStartAmount)
      : null;

    let eligible = new Decimal(0);
    if (sales.gt(from)) {
      const upper = to ?? sales;
      const cappedUpper = Decimal.min(sales, upper);
      eligible = Decimal.max(0, cappedUpper.minus(from));
    }

    const sliceTarget = eligible.mul(new Decimal(tier.ratePercent)).div(100);
    // Keep full precision in partials; only final sum is rounded to money.
    totalTarget = totalTarget.plus(sliceTarget);

    if (eligible.gt(0)) {
      activeTierIndex = i + 1;
    }

    breakdown.push({
      from: toAmountNumber(from),
      to: to != null ? toAmountNumber(to) : null,
      eligibleAmount: toAmountNumber(eligible),
      ratePercent: Number(new Decimal(tier.ratePercent).toString()),
      // Unrounded slice for transparency; consumers should use result.targetAmount
      targetAmount: toAmountNumber(sliceTarget, 6),
    });
  }

  const targetAmount = Math.max(0, toMoneyNumber(totalTarget));

  return {
    netSalesAfterDiscount: toMoneyNumber(sales),
    targetAmount,
    activeTierIndex,
    breakdown,
  };
}
