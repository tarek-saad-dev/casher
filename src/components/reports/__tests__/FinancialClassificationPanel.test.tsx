// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FinancialClassificationPanel, {
  CLASSIFICATION_BANNER_TEXT,
  IncomeRowClassificationBadge,
} from '@/components/reports/FinancialClassificationPanel';

describe('FinancialClassificationPanel', () => {
  it('renders nothing when classification is disabled', () => {
    const { container } = render(
      <FinancialClassificationPanel payload={{ classificationEnabled: false }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows banner and classified cards when enabled', () => {
    render(
      <FinancialClassificationPanel
        payload={{
          classificationEnabled: true,
          classifiedTotals: {
            salesRevenue: 1000,
            otherBusinessIncome: 100,
            nonRevenueCashIn: 50,
            legacyEmployeeIncomeMirror: 25,
            operatingExpense: 300,
            employeeAdvances: 80,
            employeePayouts: 120,
            payrollExpenseFromLedger: 400,
            legacyPayrollExpense: 0,
            internalTransfers: 10,
            uncategorizedCashIn: 0,
            uncategorizedCashOut: 0,
            cashInTotal: 1175,
            cashOutTotal: 910,
            cleanNetProfit: 400,
          },
        }}
        variant="profit"
      />,
    );

    expect(screen.getByText(CLASSIFICATION_BANNER_TEXT)).toBeTruthy();
    expect(screen.getByText('إيرادات حقيقية')).toBeTruthy();
    expect(screen.getByText('صافي ربح نظيف')).toBeTruthy();
  });
});

describe('IncomeRowClassificationBadge', () => {
  it('shows treasury label for non-revenue rows', () => {
    render(
      <IncomeRowClassificationBadge
        reportClassification={{
          label: 'تدفقات داخلة غير إيراد',
          isRealRevenue: false,
          treasuryLabel: 'هذه حركة خزنة وليست إيراد ربح',
        }}
      />,
    );
    expect(screen.getByText('هذه حركة خزنة وليست إيراد ربح')).toBeTruthy();
  });
});
