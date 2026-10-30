import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildSettlementLedgerNote } from '@/lib/services/employeeLedgerInterBranchSettlementService';
import { isExcludedPartnersExpenseCategory } from '@/lib/reports/partnersExpenseCategories';

describe('inter-branch settlement accounting labels', () => {
  it('builds distinct source/dest ledger notes', () => {
    const src = buildSettlementLedgerNote({
      settlementId: 12,
      counterpartBranchCode: 'CAMP_CAESAR',
      direction: 'source',
      settlementType: 'ledger_only',
    });
    const dst = buildSettlementLedgerNote({
      settlementId: 12,
      counterpartBranchCode: 'GLEEM',
      direction: 'dest',
      settlementType: 'cash_transfer',
    });
    expect(src).toContain('#12');
    expect(src).toContain('خصم');
    expect(src).toContain('تسوية دفترية');
    expect(dst).toContain('إضافة');
    expect(dst).toContain('تحويل نقدي');
  });

  it('excludes settlement cash category from partners operating expenses', () => {
    expect(isExcludedPartnersExpenseCategory('تحويل تسوية مستحقات موظف')).toBe(true);
  });
});
