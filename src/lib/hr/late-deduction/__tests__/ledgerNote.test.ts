import { describe, expect, it } from 'vitest';
import { buildLateDeductionLedgerNote } from '../messages';
import { LATE_DEDUCTION_ENTRY_REASON, LATE_DEDUCTION_REF_TYPE } from '../constants';

describe('late deduction ledger identity', () => {
  it('uses stable RefType for attendance-linked deductions (idempotency key)', () => {
    expect(LATE_DEDUCTION_REF_TYPE).toBe('LateDeductionAttendance');
    expect(LATE_DEDUCTION_ENTRY_REASON).toBe('deduction');
  });

  it('ledger note includes work date, late minutes, and kind — no cash-move wording', () => {
    const note = buildLateDeductionLedgerNote({
      workDate: '2026-10-31',
      lateMinutes: 20,
      kind: 'quarter',
    });
    expect(note).toContain('2026-10-31');
    expect(note).toContain('20');
    expect(note).toContain('quarter');
    expect(note.toLowerCase()).not.toContain('cash');
    expect(note.toLowerCase()).not.toContain('خزنة');
  });
});
