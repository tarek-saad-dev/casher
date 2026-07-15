import Decimal from 'decimal.js';
import type { DailyTargetCalculationResult, DailyTargetTier, TargetInputBasis } from './target.types';

const CALCULATION_VERSION = 'v1';

function moneyStr(value: number | string | Decimal): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function amountStr(value: number | string | Decimal, places = 6): string {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

export interface BreakdownSnapshotInput {
  workDate: string;
  targetPlanId: number;
  inputBasis: TargetInputBasis;
  conversionDays: number;
  tiers: DailyTargetTier[];
  calculation: DailyTargetCalculationResult;
  /** Unrounded final sum before money round — optional audit aid. */
  rawTargetAmount?: string;
}

export function buildCalculationBreakdownJson(input: BreakdownSnapshotInput): string {
  const { calculation } = input;
  const payload = {
    calculationVersion: CALCULATION_VERSION,
    workDate: input.workDate,
    targetPlanId: input.targetPlanId,
    inputBasis: input.inputBasis,
    conversionDays: input.conversionDays,
    netSalesAfterDiscount: moneyStr(calculation.netSalesAfterDiscount),
    targetAmount: moneyStr(calculation.targetAmount),
    rawTargetAmountBeforeMoneyRound: input.rawTargetAmount ?? null,
    tiers: input.tiers.map((t) => ({
      dailyStartAmount: amountStr(t.dailyStartAmount),
      ratePercent: amountStr(t.ratePercent),
      sortOrder: t.sortOrder,
      inputStartAmount: amountStr(t.inputStartAmount),
    })),
    breakdown: calculation.breakdown.map((b) => ({
      from: amountStr(b.from),
      to: b.to == null ? null : amountStr(b.to),
      eligibleAmount: amountStr(b.eligibleAmount),
      ratePercent: amountStr(b.ratePercent),
      targetAmount: amountStr(b.targetAmount),
    })),
  };
  return JSON.stringify(payload);
}

export { CALCULATION_VERSION, moneyStr, amountStr };
