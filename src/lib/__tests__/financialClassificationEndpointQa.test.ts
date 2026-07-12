import { describe, it, expect } from 'vitest';
import {
  FINANCIAL_CLASSIFICATION_ENDPOINT_EXPECTATIONS,
  evaluateFinancialClassificationEndpointResponse,
  summarizeEndpointQaResults,
} from '@/lib/accounting/financialClassificationEndpointQa';

describe('financialClassificationEndpointQa', () => {
  const monthly = FINANCIAL_CLASSIFICATION_ENDPOINT_EXPECTATIONS.find((e) => e.id === 'monthly')!;

  it('401 returns SKIPPED not FAIL', () => {
    const result = evaluateFinancialClassificationEndpointResponse({
      expectation: monthly,
      endpoint: '/api/reports/monthly?year=2026&month=7',
      httpStatus: 401,
      body: null,
    });
    expect(result.status).toBe('SKIPPED');
    expect(result.notes).toContain('authenticated');
  });

  it('authenticated 200 with classificationEnabled true passes', () => {
    const result = evaluateFinancialClassificationEndpointResponse({
      expectation: monthly,
      endpoint: '/api/reports/monthly?year=2026&month=7',
      httpStatus: 200,
      body: {
        classificationEnabled: true,
        totalRevenue: 1,
        totalExpenses: 1,
        netProfit: 1,
        classifiedTotals: { cleanNetProfit: 100 },
      },
    });
    expect(result.status).toBe('PASS');
    expect(result.classificationEnabled).toBe(true);
    expect(result.classifiedTotalsPresent).toBe(true);
  });

  it('missing classifiedTotals fails when classificationEnabled true', () => {
    const result = evaluateFinancialClassificationEndpointResponse({
      expectation: monthly,
      endpoint: '/api/reports/monthly?year=2026&month=7',
      httpStatus: 200,
      body: {
        classificationEnabled: true,
        totalRevenue: 1,
        totalExpenses: 1,
        netProfit: 1,
      },
    });
    expect(result.status).toBe('FAIL');
  });

  it('summarize: all SKIPPED → SKIPPED', () => {
    expect(
      summarizeEndpointQaResults([
        { status: 'SKIPPED' } as never,
        { status: 'SKIPPED' } as never,
      ]),
    ).toBe('SKIPPED');
  });
});
