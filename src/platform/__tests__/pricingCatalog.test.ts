import { describe, expect, it } from 'vitest';
import {
  DRVO_ANNUAL_FREE_MONTHS,
  DRVO_PLAN_PRICING,
  annualSavings,
  getPlanPricing,
  monthlyEquivalentFromAnnual,
} from '@/platform/commercial/pricingCatalog';

describe('DRVO V1 pricing catalog', () => {
  it('contains the three public plans in sales order', () => {
    expect(DRVO_PLAN_PRICING.map((p) => p.planCode)).toEqual(['starter', 'growth', 'pro']);
  });

  it('annual price equals ten monthly payments (two months free)', () => {
    expect(DRVO_ANNUAL_FREE_MONTHS).toBe(2);
    for (const plan of DRVO_PLAN_PRICING) {
      expect(plan.annualPrice).toBe(plan.monthlyPrice * 10);
      expect(annualSavings(plan)).toBe(plan.monthlyPrice * 2);
      expect(monthlyEquivalentFromAnnual(plan)).toBeGreaterThan(0);
    }
  });

  it('marks Growth as the recommended offer', () => {
    expect(getPlanPricing('growth')?.recommended).toBe(true);
    expect(getPlanPricing('internal')).toBeNull();
  });
});
