import { describe, expect, it } from 'vitest';
import { attachRunningBalances } from '@/lib/hr/employee-ledger-running-balance';
import type { EmpLedgerEntryRow } from '@/lib/types/employee-ledger';

function entry(
  partial: Pick<EmpLedgerEntryRow, 'id' | 'entryDirection' | 'amount' | 'entryDate'>,
): EmpLedgerEntryRow {
  return {
    empId: 1,
    empName: 'خيري',
    entryReason: 'advance',
    payrollMonth: '2026-07',
    refType: null,
    refId: null,
    cashMoveId: null,
    attendanceId: null,
    notes: null,
    isVoided: false,
    voidReason: null,
    createdByUserId: null,
    createdAt: 'x',
    updatedAt: null,
    ...partial,
  };
}

describe('attachRunningBalances', () => {
  it('computes chronological running balance on DESC-ordered entries', () => {
    // UI order: newest first
    const rows = [
      entry({ id: 3, entryDate: '2026-07-03', entryDirection: 'debit', amount: 50 }),
      entry({ id: 2, entryDate: '2026-07-02', entryDirection: 'credit', amount: 200 }),
      entry({ id: 1, entryDate: '2026-07-01', entryDirection: 'credit', amount: 100 }),
    ];

    const withBalance = attachRunningBalances(rows);

    expect(withBalance.map((r) => r.runningBalance)).toEqual([250, 300, 100]);
    // newest row balance === final month balance
    expect(withBalance[0].runningBalance).toBe(250);
  });

  it('rounds to 2 decimal places', () => {
    const rows = [
      entry({ id: 2, entryDate: '2026-07-02', entryDirection: 'debit', amount: 0.1 }),
      entry({ id: 1, entryDate: '2026-07-01', entryDirection: 'credit', amount: 0.2 }),
    ];
    const withBalance = attachRunningBalances(rows);
    expect(withBalance[0].runningBalance).toBe(0.1);
    expect(withBalance[1].runningBalance).toBe(0.2);
  });
});
