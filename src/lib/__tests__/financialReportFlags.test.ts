import { describe, it, expect, afterEach } from 'vitest';
import { isFinancialReportClassificationEnabled } from '@/lib/accounting/financialReportFlags';

describe('isFinancialReportClassificationEnabled', () => {
  const original = process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED;
    } else {
      process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED = original;
    }
  });

  it('returns false when flag is missing', () => {
    delete process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED;
    expect(isFinancialReportClassificationEnabled()).toBe(false);
  });

  it('returns false when flag is not true', () => {
    process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED = 'false';
    expect(isFinancialReportClassificationEnabled()).toBe(false);
  });

  it('returns true when flag is true', () => {
    process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED = 'true';
    expect(isFinancialReportClassificationEnabled()).toBe(true);
  });
});
