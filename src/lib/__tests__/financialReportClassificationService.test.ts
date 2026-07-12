import { describe, it, expect, afterEach } from 'vitest';
import {
  buildDisabledClassificationPayload,
  isFinancialReportClassificationEnabled,
} from '@/lib/accounting/financialReportFlags';

describe('financialReportClassificationService flag behavior', () => {
  const original = process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED;
    } else {
      process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED = original;
    }
  });

  it('buildDisabledClassificationPayload returns classificationEnabled false', () => {
    expect(buildDisabledClassificationPayload()).toEqual({ classificationEnabled: false });
  });

  it('flag off means classification disabled', () => {
    delete process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED;
    expect(isFinancialReportClassificationEnabled()).toBe(false);
  });
});
