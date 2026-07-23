import { describe, it, expect } from 'vitest';
import {
  calculateMonthlyFinancialEquations,
  calculatePartnerProfitShares,
} from '@/lib/reports/monthlyFinancialEquations';
import { PARTNERS } from '@/lib/types/monthly-report';

describe('calculatePartnerProfitShares', () => {
  it('distributes profit by partner percentages', () => {
    // Phase 1E: production paths resolve real shares via getEffectiveBranchPartnerShares;
    // this legacy test explicitly passes the deprecated PARTNERS constant as fixture data.
    const shares = calculatePartnerProfitShares(100000, PARTNERS);
    expect(shares).toHaveLength(3);
    expect(shares[0].name).toBe('زياد');
    expect(shares[0].profitShare).toBeCloseTo(36666.66666666667, 2);
    expect(shares[1].profitShare).toBeCloseTo(31666.66666666667, 2);
    expect(shares[2].profitShare).toBeCloseTo(31666.66666666667, 2);
  });

  it('keeps partner shares within 0.01 of distributable amount', () => {
    const amount = 67101.55;
    const shares = calculatePartnerProfitShares(amount, PARTNERS);
    const total = shares.reduce((sum, partner) => sum + partner.profitShare, 0);
    expect(Math.abs(total - amount)).toBeLessThanOrEqual(0.01);
  });

  it('throws when no partner shares are provided', () => {
    expect(() => calculatePartnerProfitShares(100000, [])).toThrow(
      'partner shares must be provided',
    );
  });
});

describe('calculateMonthlyFinancialEquations', () => {
  it('uses treasury net profit for monthly mode without extra deductions', () => {
    const result = calculateMonthlyFinancialEquations({
      year: 2026,
      month: 6,
      baseAmount: 120000,
      mode: 'monthly',
      partners: PARTNERS,
    });

    expect(result.finalDistributableAmount).toBe(120000);
    expect(result.partnerShares[0].profitShare).toBeCloseTo(44000, 0);
    expect(Math.abs(result.totalPartnerShares - 120000)).toBeLessThanOrEqual(0.01);
  });

  it('uses operating net for partners mode without deducting payroll or expenses again', () => {
    const operatingNet = 67101;
    const result = calculateMonthlyFinancialEquations({
      year: 2026,
      month: 6,
      baseAmount: operatingNet,
      mode: 'partners',
      partners: PARTNERS,
      baseAmountAlreadyNetOfEmployees: true,
      baseAmountAlreadyNetOfOperatingExpenses: true,
    });

    expect(result.baseAmount).toBe(operatingNet);
    expect(result.finalDistributableAmount).toBe(operatingNet);
    expect(Math.abs(result.totalPartnerShares - operatingNet)).toBeLessThanOrEqual(0.01);
  });

  it('handles negative operating months as loss', () => {
    const result = calculateMonthlyFinancialEquations({
      year: 2026,
      month: 6,
      baseAmount: -15000,
      mode: 'partners',
      partners: PARTNERS,
      baseAmountAlreadyNetOfEmployees: true,
      baseAmountAlreadyNetOfOperatingExpenses: true,
    });

    expect(result.isLoss).toBe(true);
    expect(result.partnerShares.every((partner) => partner.profitShare < 0)).toBe(true);
    expect(PARTNERS.reduce((sum, partner) => sum + partner.percentage, 0)).toBeCloseTo(100, 4);
  });
});
