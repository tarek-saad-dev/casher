import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  convertInputTiersToDaily,
  EmployeeTargetValidationError,
} from '@/lib/payroll/employee-target';

describe('convertInputTiersToDaily (MTD monthly thresholds)', () => {
  it('monthly keeps start as calculation threshold (no ÷ days)', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'monthly',
      conversionDays: 26,
      tiers: [{ inputStartAmount: 26000, ratePercent: 20 }],
    });
    expect(tiers).toHaveLength(1);
    expect(tiers[0].dailyStartAmount).toBe(26000);
    expect(tiers[0].inputStartAmount).toBe(26000);
    expect(tiers[0].monthlyEquivalent).toBe(26000);
  });

  it('rejects daily input basis', () => {
    expect(() =>
      convertInputTiersToDaily({
        inputBasis: 'daily',
        conversionDays: 26,
        tiers: [{ inputStartAmount: 1000, ratePercent: 15 }],
      }),
    ).toThrow(EmployeeTargetValidationError);
  });

  it('allows zero start', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'monthly',
      conversionDays: 26,
      tiers: [{ inputStartAmount: 0, ratePercent: 20 }],
    });
    expect(tiers[0].dailyStartAmount).toBe(0);
  });

  it('keeps multiple monthly tiers as-is', () => {
    const tiers = convertInputTiersToDaily({
      inputBasis: 'monthly',
      conversionDays: 26,
      tiers: [
        { inputStartAmount: 10000, ratePercent: 10 },
        { inputStartAmount: 30000, ratePercent: 20 },
      ],
    });
    expect(tiers).toHaveLength(2);
    expect(tiers[0].dailyStartAmount).toBe(10000);
    expect(tiers[1].dailyStartAmount).toBe(30000);
    expect(tiers[0].sortOrder).toBe(1);
    expect(tiers[1].sortOrder).toBe(2);
  });

  it('rejects duplicate starts', () => {
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
        inputBasis: 'monthly',
        conversionDays: 26,
        tiers: [{ inputStartAmount: -1, ratePercent: 10 }],
      }),
    ).toThrow('بداية الشريحة لا يمكن أن تكون سالبة');
  });

  it('rejects rate outside 0..100', () => {
    expect(() =>
      convertInputTiersToDaily({
        inputBasis: 'monthly',
        conversionDays: 26,
        tiers: [{ inputStartAmount: 1000, ratePercent: 101 }],
      }),
    ).toThrow(EmployeeTargetValidationError);
  });

  it('rejects descending starts', () => {
    expect(() =>
      convertInputTiersToDaily({
        inputBasis: 'monthly',
        conversionDays: 26,
        tiers: [
          { inputStartAmount: 20000, ratePercent: 10 },
          { inputStartAmount: 10000, ratePercent: 20 },
        ],
      }),
    ).toThrow('يجب ترتيب الشرائح تصاعديًا');
  });
});
