import { describe, expect, it } from 'vitest';
import { isWorkDateEligibleForLateDeduction } from '../rules';

describe('isWorkDateEligibleForLateDeduction', () => {
  it('disabled → never eligible', () => {
    expect(
      isWorkDateEligibleForLateDeduction('2026-10-31', {
        enabled: false,
        activatedOn: '2026-10-01',
      }),
    ).toBe(false);
  });

  it('enabled without activation date → never eligible (no silent history)', () => {
    expect(
      isWorkDateEligibleForLateDeduction('2026-10-31', {
        enabled: true,
        activatedOn: null,
      }),
    ).toBe(false);
  });

  it('work date before activation → not eligible (no retroactive charges)', () => {
    expect(
      isWorkDateEligibleForLateDeduction('2026-10-15', {
        enabled: true,
        activatedOn: '2026-10-31',
      }),
    ).toBe(false);
  });

  it('work date on/after activation → eligible', () => {
    expect(
      isWorkDateEligibleForLateDeduction('2026-10-31', {
        enabled: true,
        activatedOn: '2026-10-31',
      }),
    ).toBe(true);
    expect(
      isWorkDateEligibleForLateDeduction('2026-11-01', {
        enabled: true,
        activatedOn: '2026-10-31',
      }),
    ).toBe(true);
  });
});
