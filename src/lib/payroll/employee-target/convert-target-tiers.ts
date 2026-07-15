import Decimal from 'decimal.js';
import type { TargetInputBasis } from './target.types';
import {
  EmployeeTargetValidationError,
  assertValidConversionDays,
  assertValidInputBasis,
  toDailyStartAmount,
} from './target.validation';

export interface ConvertibleTierInput {
  inputStartAmount: number | string;
  ratePercent: number | string;
  sortOrder?: number;
}

export interface ConvertedTargetTier {
  sortOrder: number;
  inputStartAmount: number;
  dailyStartAmount: number;
  /** For UI: monthly equivalent of the daily start (daily × conversionDays). */
  monthlyEquivalent: number;
  ratePercent: number;
}

export interface ConvertInputTiersParams {
  inputBasis: TargetInputBasis;
  conversionDays: number;
  tiers: ConvertibleTierInput[];
  /** When false, empty tiers are allowed (disabled plans). Default true. */
  requireAtLeastOne?: boolean;
}

function toSixDp(value: Decimal): number {
  return Number(value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
}

/**
 * Convert user-entered tier starts to DailyStartAmount for storage/calculation.
 * Does NOT round thresholds to piasters — keeps decimal(18,6).
 */
export function convertInputTiersToDaily(params: ConvertInputTiersParams): ConvertedTargetTier[] {
  const { inputBasis, conversionDays, tiers } = params;
  const requireAtLeastOne = params.requireAtLeastOne !== false;

  try {
    assertValidInputBasis(inputBasis);
  } catch {
    throw new EmployeeTargetValidationError('طريقة الإدخال يجب أن تكون شهري أو يومي');
  }
  try {
    assertValidConversionDays(conversionDays);
  } catch {
    throw new EmployeeTargetValidationError('عدد أيام التحويل من 1 إلى 31');
  }

  if (!Array.isArray(tiers)) {
    throw new EmployeeTargetValidationError('صيغة الشرائح غير صحيحة');
  }
  if (requireAtLeastOne && tiers.length === 0) {
    throw new EmployeeTargetValidationError('التارجت المفعّل يحتاج شريحة واحدة على الأقل');
  }
  if (tiers.length === 0) {
    return [];
  }

  // Duplicates before conversion (exact input string/number normalized via Decimal)
  const inputSeen = new Set<string>();
  for (let i = 0; i < tiers.length; i++) {
    const start = new Decimal(tiers[i].inputStartAmount);
    if (!start.isFinite()) {
      throw new EmployeeTargetValidationError(`بداية الشريحة #${i + 1} غير صالحة`);
    }
    if (start.isNeg()) {
      throw new EmployeeTargetValidationError('بداية الشريحة لا يمكن أن تكون سالبة');
    }
    const key = start.toFixed(6);
    if (inputSeen.has(key)) {
      throw new EmployeeTargetValidationError('لا يمكن تكرار بداية شريحتين');
    }
    inputSeen.add(key);

    const rate = new Decimal(tiers[i].ratePercent);
    if (!rate.isFinite() || rate.lt(0) || rate.gt(100)) {
      throw new EmployeeTargetValidationError('النسبة من 0 إلى 100');
    }
  }

  // Must be ascending by input start before conversion
  for (let i = 1; i < tiers.length; i++) {
    const prev = new Decimal(tiers[i - 1].inputStartAmount);
    const cur = new Decimal(tiers[i].inputStartAmount);
    if (cur.lt(prev)) {
      throw new EmployeeTargetValidationError('يجب ترتيب الشرائح تصاعديًا');
    }
  }

  const converted: ConvertedTargetTier[] = tiers.map((tier, index) => {
    const inputStart = toSixDp(new Decimal(tier.inputStartAmount));
    const dailyStart = toDailyStartAmount(inputStart, inputBasis, conversionDays);
    const rate = toSixDp(new Decimal(tier.ratePercent));
    const monthlyEquivalent = toSixDp(new Decimal(dailyStart).mul(conversionDays));

    return {
      sortOrder: index + 1,
      inputStartAmount: inputStart,
      dailyStartAmount: dailyStart,
      monthlyEquivalent,
      ratePercent: rate,
    };
  });

  // Duplicates after conversion to 6dp
  const dailySeen = new Set<string>();
  for (const tier of converted) {
    const key = new Decimal(tier.dailyStartAmount).toFixed(6);
    if (dailySeen.has(key)) {
      throw new EmployeeTargetValidationError(
        'لا يمكن تكرار بداية شريحتين بعد التحويل لليوم (تحقق من ConversionDays)',
      );
    }
    dailySeen.add(key);
  }

  // Ascending daily starts after conversion
  for (let i = 1; i < converted.length; i++) {
    if (converted[i].dailyStartAmount < converted[i - 1].dailyStartAmount) {
      throw new EmployeeTargetValidationError('يجب ترتيب الشرائح تصاعديًا');
    }
  }

  return converted;
}
