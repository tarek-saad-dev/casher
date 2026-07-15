import Decimal from 'decimal.js';
import type { DailyTargetTier, TargetInputBasis, TargetTierInput } from './target.types';

export class EmployeeTargetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeTargetValidationError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidWorkDate(workDate: string): void {
  if (!DATE_RE.test(workDate)) {
    throw new EmployeeTargetValidationError('workDate يجب أن يكون بصيغة YYYY-MM-DD');
  }
  const d = new Date(`${workDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new EmployeeTargetValidationError('workDate غير صالح');
  }
}

export function assertValidConversionDays(conversionDays: number): void {
  if (!Number.isInteger(conversionDays) || conversionDays < 1 || conversionDays > 31) {
    throw new EmployeeTargetValidationError('ConversionDays يجب أن يكون عددًا صحيحًا بين 1 و 31');
  }
}

export function assertValidInputBasis(basis: string): asserts basis is TargetInputBasis {
  if (basis !== 'monthly' && basis !== 'daily') {
    throw new EmployeeTargetValidationError('InputBasis يجب أن يكون monthly أو daily');
  }
}

/**
 * Convert an input start amount to a daily start amount.
 * monthly → divide by ConversionDays; daily → unchanged.
 * Keeps up to 6 decimal places (matches DailyStartAmount column).
 */
export function toDailyStartAmount(
  inputStartAmount: number | string,
  inputBasis: TargetInputBasis,
  conversionDays: number,
): number {
  assertValidInputBasis(inputBasis);
  assertValidConversionDays(conversionDays);

  const input = new Decimal(inputStartAmount);
  if (input.isNeg()) {
    throw new EmployeeTargetValidationError('StartAmount لا يمكن أن يكون سالبًا');
  }

  if (inputBasis === 'daily') {
    return Number(input.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
  }

  const daily = input.div(conversionDays);
  return Number(daily.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
}

/**
 * Validate and normalize tiers for calculation.
 * - rate in [0, 100]
 * - starts >= 0
 * - no duplicate daily starts
 * - must be strictly ascending by dailyStart (or sorted if sortTiers=true)
 */
export function normalizeTiersForCalculation(
  tiers: Array<Pick<DailyTargetTier, 'dailyStartAmount' | 'ratePercent' | 'sortOrder'> | TargetTierInput & { dailyStartAmount: number }>,
  options?: { sortTiers?: boolean },
): DailyTargetTier[] {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new EmployeeTargetValidationError('يجب توفير شريحة واحدة على الأقل');
  }

  const mapped: DailyTargetTier[] = tiers.map((t, index) => {
    const dailyStart = new Decimal(
      'dailyStartAmount' in t && t.dailyStartAmount != null
        ? t.dailyStartAmount
        : (t as TargetTierInput).inputStartAmount,
    );
    const rate = new Decimal(t.ratePercent);
    if (dailyStart.isNeg()) {
      throw new EmployeeTargetValidationError(`DailyStartAmount سالب في الشريحة #${index + 1}`);
    }
    if (rate.lt(0) || rate.gt(100)) {
      throw new EmployeeTargetValidationError(`RatePercent خارج النطاق [0,100] في الشريحة #${index + 1}`);
    }
    return {
      sortOrder: t.sortOrder ?? index + 1,
      inputStartAmount:
        'inputStartAmount' in t && t.inputStartAmount != null
          ? Number(t.inputStartAmount)
          : Number(dailyStart.toString()),
      dailyStartAmount: Number(dailyStart.toString()),
      ratePercent: Number(rate.toString()),
    };
  });

  const ordered = options?.sortTiers
    ? [...mapped].sort((a, b) => a.dailyStartAmount - b.dailyStartAmount || a.sortOrder - b.sortOrder)
    : mapped;

  if (!options?.sortTiers) {
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].dailyStartAmount < ordered[i - 1].dailyStartAmount) {
        throw new EmployeeTargetValidationError(
          'الشرائح غير مرتبة تصاعديًا حسب DailyStartAmount — أعد الترتيب أو فعّل sortTiers',
        );
      }
    }
  }

  const seen = new Set<string>();
  for (const tier of ordered) {
    const key = new Decimal(tier.dailyStartAmount).toFixed(6);
    if (seen.has(key)) {
      throw new EmployeeTargetValidationError(`تكرار DailyStartAmount=${key}`);
    }
    seen.add(key);
  }

  return ordered.map((t, i) => ({ ...t, sortOrder: i + 1 }));
}

export function assertNonNegativeSales(netSalesAfterDiscount: number | string): Decimal {
  const sales = new Decimal(netSalesAfterDiscount);
  if (sales.isNeg()) {
    throw new EmployeeTargetValidationError('صافي المبيعات لا يمكن أن يكون سالبًا');
  }
  if (!sales.isFinite()) {
    throw new EmployeeTargetValidationError('صافي المبيعات غير صالح');
  }
  return sales;
}
