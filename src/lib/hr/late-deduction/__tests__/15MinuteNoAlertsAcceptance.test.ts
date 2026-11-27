import { describe, expect, it } from 'vitest';
import { resolveLateDeductionBracket, calculateLateDeductionAmount } from '../rules';

describe('0–14 minute grace and one penalty per daily shift', () => {
  it.each([
    [0, 'none', null],
    [1, 'none', null],
    [14, 'none', null],
    [15, 'quarter', 100],
    [60, 'quarter', 100],
    [61, 'half', 200],
    [120, 'half', 200],
    [121, 'manager_review', null],
  ] as const)('%i minutes => %s, amount %s', (lateMinutes, bracket, amount) => {
    expect(resolveLateDeductionBracket(lateMinutes)).toBe(bracket);
    expect(calculateLateDeductionAmount({ lateMinutes, dailyBasePay: 400 }).amount).toBe(amount);
  });
});
