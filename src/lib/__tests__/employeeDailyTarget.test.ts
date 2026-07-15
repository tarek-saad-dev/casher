import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  calculateDailyTarget,
  toDailyStartAmount,
  normalizeTiersForCalculation,
  EmployeeTargetValidationError,
  type DailyTargetTier,
} from '@/lib/payroll/employee-target';

function tier(dailyStartAmount: number, ratePercent: number, sortOrder = 1): DailyTargetTier {
  return {
    sortOrder,
    inputStartAmount: dailyStartAmount,
    dailyStartAmount,
    ratePercent,
  };
}

describe('toDailyStartAmount', () => {
  it('monthly start=26000, conversionDays=26 → daily=1000', () => {
    expect(toDailyStartAmount(26000, 'monthly', 26)).toBe(1000);
  });

  it('monthly start=10000, conversionDays=26 → ~384.615385 (6dp half-up)', () => {
    // 10000/26 = 384.615384615... → 6dp ROUND_HALF_UP = 384.615385
    // Spec asked ~384.615384 internally; we store 6dp. Document exact:
    const daily = toDailyStartAmount(10000, 'monthly', 26);
    expect(daily).toBeCloseTo(384.615385, 6);
    // Progressive example in product uses 384.615384 — allow either by using exact string for engine tests
  });

  it('daily basis leaves amount unchanged', () => {
    expect(toDailyStartAmount(1000, 'daily', 26)).toBe(1000);
  });
});

describe('calculateDailyTarget — progressive marginal', () => {
  it('1) sales=800, start=1000, rate=20 → 0', () => {
    const r = calculateDailyTarget(800, [tier(1000, 20)]);
    expect(r.targetAmount).toBe(0);
    expect(r.activeTierIndex).toBeNull();
  });

  it('2) sales=1000, start=1000, rate=20 → 0 (boundary exclusive of start)', () => {
    const r = calculateDailyTarget(1000, [tier(1000, 20)]);
    expect(r.targetAmount).toBe(0);
  });

  it('3) sales=1500, start=1000, rate=20 → 100', () => {
    const r = calculateDailyTarget(1500, [tier(1000, 20)]);
    expect(r.targetAmount).toBe(100);
    expect(r.activeTierIndex).toBe(1);
  });

  it('4) sales=1500, start=0, rate=20 → 300', () => {
    const r = calculateDailyTarget(1500, [tier(0, 20)]);
    expect(r.targetAmount).toBe(300);
  });

  it('5/6) multiple tiers with monthly-derived starts → 146.15', () => {
    // Product example uses 384.615384 and 1153.846154 exactly
    const tiers: DailyTargetTier[] = [
      { sortOrder: 1, inputStartAmount: 10000, dailyStartAmount: 384.615384, ratePercent: 10 },
      { sortOrder: 2, inputStartAmount: 30000, dailyStartAmount: 1153.846154, ratePercent: 20 },
    ];
    const r = calculateDailyTarget(1500, tiers);
    expect(r.targetAmount).toBe(146.15);
    expect(r.breakdown).toHaveLength(2);
    expect(r.activeTierIndex).toBe(2);
  });

  it('7) exact next-tier boundary (sales = tier2 start) only fills tier1', () => {
    const tiers = [
      tier(384.615384, 10, 1),
      tier(1153.846154, 20, 2),
    ];
    const r = calculateDailyTarget(1153.846154, tiers);
    // eligible tier1 = 1153.846154 - 384.615384 = 769.23077 × 10% = 76.923077 → 76.92
    expect(r.targetAmount).toBe(76.92);
    expect(r.breakdown[1].eligibleAmount).toBe(0);
  });

  it('8) zero sales → 0', () => {
    expect(calculateDailyTarget(0, [tier(0, 20)]).targetAmount).toBe(0);
  });

  it('9) rounding only after final sum (partials keep precision)', () => {
    const tiers = [
      tier(384.615384, 10, 1),
      tier(1153.846154, 20, 2),
    ];
    const r = calculateDailyTarget(1500, tiers);
    const rawSum = r.breakdown.reduce((s, b) => s + b.targetAmount, 0);
    // breakdown slices may show more than 2dp; final is rounded once
    expect(r.targetAmount).toBe(146.15);
    expect(Math.abs(rawSum - 146.153846)).toBeLessThan(0.00001);
  });
});

describe('calculateDailyTarget — validation', () => {
  it('10) negative sales throws', () => {
    expect(() => calculateDailyTarget(-1, [tier(0, 20)])).toThrow(EmployeeTargetValidationError);
  });

  it('11) duplicate tier starts throws', () => {
    expect(() =>
      calculateDailyTarget(1500, [tier(1000, 10, 1), tier(1000, 20, 2)]),
    ).toThrow(/تكرار/);
  });

  it('12) percentage above 100 throws', () => {
    expect(() => calculateDailyTarget(1500, [tier(0, 100.001)])).toThrow(/RatePercent/);
  });

  it('13) percentage below 0 throws', () => {
    expect(() => calculateDailyTarget(1500, [tier(0, -1)])).toThrow(/RatePercent/);
  });

  it('14) unordered tiers throw (unless sortTiers)', () => {
    expect(() =>
      calculateDailyTarget(1500, [tier(1000, 20, 1), tier(500, 10, 2)]),
    ).toThrow(/غير مرتبة/);

    const sorted = calculateDailyTarget(
      1500,
      [tier(1000, 20, 1), tier(500, 10, 2)],
      { sortTiers: true },
    );
    // After sort: 500@10% then 1000@20%
    // (1000-500)*10% + (1500-1000)*20% = 50 + 100 = 150
    expect(sorted.targetAmount).toBe(150);
  });

  it('normalizeTiersForCalculation assigns sortOrder', () => {
    const n = normalizeTiersForCalculation([
      { dailyStartAmount: 0, ratePercent: 10, sortOrder: 1, inputStartAmount: 0 },
      { dailyStartAmount: 500, ratePercent: 20, sortOrder: 2, inputStartAmount: 500 },
    ]);
    expect(n.map((t) => t.sortOrder)).toEqual([1, 2]);
  });
});
