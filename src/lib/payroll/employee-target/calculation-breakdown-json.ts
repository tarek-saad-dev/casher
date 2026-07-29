import Decimal from 'decimal.js';
import type { DailyTargetCalculationResult, DailyTargetTier, TargetInputBasis } from './target.types';

/** MTD progressive commission on cumulative month sales. */
const CALCULATION_VERSION = 'v2-mtd';

function moneyStr(value: number | string | Decimal): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function amountStr(value: number | string | Decimal, places = 6): string {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

export interface BreakdownSnapshotInput {
  workDate: string;
  monthStart: string;
  targetPlanId: number;
  inputBasis: TargetInputBasis;
  conversionDays: number;
  tiers: DailyTargetTier[];
  /** Progressive calc on MTD sales (targetAmount here = mtdTarget). */
  mtdCalculation: DailyTargetCalculationResult;
  daySales: number | string;
  mtdSales: number | string;
  mtdTargetAmount: number | string;
  dayDelta: number | string;
  priorWorkDate: string | null;
  priorMtdTargetAmount: number | string;
  /** Unrounded final day delta before money round — optional audit aid. */
  rawTargetAmount?: string;
}

export function buildCalculationBreakdownJson(input: BreakdownSnapshotInput): string {
  const { mtdCalculation } = input;
  const payload = {
    calculationVersion: CALCULATION_VERSION,
    workDate: input.workDate,
    monthStart: input.monthStart,
    targetPlanId: input.targetPlanId,
    inputBasis: input.inputBasis,
    conversionDays: input.conversionDays,
    /** Day-only sales (also stored in NetSalesAfterDiscount column). */
    daySales: moneyStr(input.daySales),
    netSalesAfterDiscount: moneyStr(input.daySales),
    mtdSales: moneyStr(input.mtdSales),
    mtdTargetAmount: moneyStr(input.mtdTargetAmount),
    priorWorkDate: input.priorWorkDate,
    priorMtdTargetAmount: moneyStr(input.priorMtdTargetAmount),
    /** Day payable / ledger credit. */
    dayDelta: moneyStr(input.dayDelta),
    targetAmount: moneyStr(input.dayDelta),
    rawTargetAmountBeforeMoneyRound: input.rawTargetAmount ?? null,
    tiers: input.tiers.map((t) => ({
      dailyStartAmount: amountStr(t.dailyStartAmount),
      ratePercent: amountStr(t.ratePercent),
      sortOrder: t.sortOrder,
      inputStartAmount: amountStr(t.inputStartAmount),
    })),
    breakdown: mtdCalculation.breakdown.map((b) => ({
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
