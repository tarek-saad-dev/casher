import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  convertInputTiersToDaily,
  EmployeeTargetValidationError,
} from '@/lib/payroll/employee-target';

describe('convertInputTiersToDaily', () => {
  it('monthly conversion divides by conversionDays (6dp, no piaster round)', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'monthly',
      conversionDays: 26,
      tiers: [{ inputStartAmount: 26000, ratePercent: 20 }],
    });
    expect(tiers).toHaveLength(1);
    expect(tiers[0].dailyStartAmount).toBe(1000);
    expect(tiers[0].inputStartAmount).toBe(26000);
    expect(tiers[0].monthlyEquivalent).toBe(26000);
  });

  it('daily passthrough keeps input start', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'daily',
      conversionDays: 26,
      tiers: [{ inputStartAmount: 1000, ratePercent: 15 }],
    });
    expect(tiers[0].dailyStartAmount).toBe(1000);
    expect(tiers[0].monthlyEquivalent).toBe(26000);
  });

  it('allows zero start', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'daily',
      conversionDays: 26,
      tiers: [{ inputStartAmount: 0, ratePercent: 20 }],
    });
    expect(tiers[0].dailyStartAmount).toBe(0);
  });

  it('converts multiple tiers', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'monthly',
      conversionDays: 26,
      tiers: [
        { inputStartAmount: 10000, ratePercent: 10 },
        { inputStartAmount: 30000, ratePercent: 20 },
      ],
    });
    expect(tiers).toHaveLength(2);
    expect(tiers[0].dailyStartAmount).toBeCloseTo(384.615385, 6);
    expect(tiers[1].dailyStartAmount).toBeCloseTo(1153.846154, 6);
    expect(tiers[0].sortOrder).toBe(1);
    expect(tiers[1].sortOrder).toBe(2);
  });

  it('rejects duplicate converted starts', () => {
    // Same daily after /26 would collide if two monthly map to same 6dp — use identical inputs
    expect(() =>
      convertInputTiersToDaily({
        inputBasis: 'monthly',
        conversionDays: 26,
        tiers: [
          { inputStartAmount: 26000, ratePercent: 10 },
          { inputStartAmount: 26000, ratePercent: 20 },
        ],
      }),
    ).toThrow(EmployeeTargetValidationError);
  });

  it('rejects negative starts with Arabic UX message', () => {
    expect(() =>
      convertInputTiersToDaily({
        inputBasis: 'daily',
        conversionDays: 26,
        tiers: [{ inputStartAmount: -1, ratePercent: 10 }],
      }),
    ).toThrow('بداية الشريحة لا يمكن أن تكون سالبة');
  });

  it('rejects rate outside 0–100', () => {
    expect(() =>
      convertInputTiersToDaily({
        inputBasis: 'daily',
        conversionDays: 26,
        tiers: [{ inputStartAmount: 0, ratePercent: 101 }],
      }),
    ).toThrow('النسبة من 0 إلى 100');
  });

  it('rejects non-ascending order', () => {
    expect(() =>
      convertInputTiersToDaily({
        inputBasis: 'daily',
        conversionDays: 26,
        tiers: [
          { inputStartAmount: 1000, ratePercent: 10 },
          { inputStartAmount: 500, ratePercent: 20 },
        ],
      }),
    ).toThrow('يجب ترتيب الشرائح تصاعديًا');
  });

  it('allows empty tiers when requireAtLeastOne=false (disabled plan)', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'monthly',
      conversionDays: 26,
      tiers: [],
      requireAtLeastOne: false,
    });
    expect(tiers).toEqual([]);
  });
});
