import { describe, it, expect } from 'vitest';
import { calcRemainingAfterEmployees } from '@/components/reports/partners/PartnersEmployeeFlowSection';

describe('calcRemainingAfterEmployees', () => {
  it('subtracts paid salaries from actual barber revenue', () => {
    expect(calcRemainingAfterEmployees(191671, 79570)).toBe(112101);
  });

  it('returns negative remainder when payroll exceeds revenue', () => {
    expect(calcRemainingAfterEmployees(50000, 60000)).toBe(-10000);
  });

  it('handles zero values safely', () => {
    expect(calcRemainingAfterEmployees(0, 0)).toBe(0);
  });
});
