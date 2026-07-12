/**
 * Phase 5B — Financial report classification feature flag.
 */

export function isFinancialReportClassificationEnabled(): boolean {
  return process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED === 'true';
}

export function buildDisabledClassificationPayload() {
  return { classificationEnabled: false as const };
}
