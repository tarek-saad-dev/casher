import { describe, it, expect } from 'vitest';
import { calcRemainingAfterEmployees } from '@/components/reports/partners/PartnersEmployeeFlowSection';
import { calcOperatingNet } from '@/components/reports/partners/PartnersOperatingNetFlowSection';

describe('partners operating net flow', () => {
  it('calculates operating net from employee remainder and filtered expenses', () => {
    const remainingAfterEmployees = calcRemainingAfterEmployees(191671, 79570);
    expect(remainingAfterEmployees).toBe(112101);
    expect(calcOperatingNet(remainingAfterEmployees, 45000)).toBe(67101);
  });

  it('matches employee remainder minus filtered operating expenses', () => {
    const remaining = calcRemainingAfterEmployees(100000, 30000);
    const expenses = 25000;
    expect(calcOperatingNet(remaining, expenses)).toBe(remaining - expenses);
  });

  it('returns negative operating net when expenses exceed remainder', () => {
    expect(calcOperatingNet(50000, 60000)).toBe(-10000);
  });

  it('handles zero values safely', () => {
    expect(calcOperatingNet(0, 0)).toBe(0);
  });
});
