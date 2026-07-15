import type Decimal from 'decimal.js';

export type TargetInputBasis = 'monthly' | 'daily';

export interface TargetTierInput {
  /** Start threshold in the input basis (monthly or daily as entered). */
  inputStartAmount: number | string;
  /** Commission rate percent, e.g. 20 for 20%. */
  ratePercent: number | string;
  sortOrder?: number;
}

export interface DailyTargetTier {
  sortOrder: number;
  inputStartAmount: number;
  dailyStartAmount: number;
  ratePercent: number;
}

export interface DailyTargetBreakdownRow {
  from: number;
  to: number | null;
  eligibleAmount: number;
  ratePercent: number;
  targetAmount: number;
}

export interface DailyTargetCalculationResult {
  netSalesAfterDiscount: number;
  targetAmount: number;
  /** 1-based index of the highest tier that had eligible amount; null if none. */
  activeTierIndex: number | null;
  breakdown: DailyTargetBreakdownRow[];
}

export interface CalculateDailyTargetOptions {
  /** If true, sort tiers by dailyStart ascending instead of rejecting unordered input. Default false (reject). */
  sortTiers?: boolean;
}

/** Internal tier with Decimal for engine precision. */
export interface InternalTier {
  sortOrder: number;
  dailyStart: Decimal;
  ratePercent: Decimal;
}
