import { describe, expect, it } from 'vitest';
import {
  buildFinalDeductionMessage,
  buildManagerDecisionEmployeeMessage,
  buildLateDeductionLedgerNote,
} from '../messages';

describe('late deduction employee notifications — Arabic financial debit only', () => {
  it.each([
    ['quarter', 'ربع يوم', 75],
    ['half', 'نصف يوم', 150],
  ] as const)('final %s deduction is Arabic only and states minutes/amount', (bracket, type, amount) => {
    const msg = buildFinalDeductionMessage({
      checkInTime: '12:20', lateMinutes: 20, amount, bracket,
    });
    expect(msg).toContain('مدة التأخير: *20 دقيقة*');
    expect(msg).toContain('قيمة الخصم:');
    expect(msg).toContain(type);
    expect(msg).toContain(amount.toFixed(2));
    expect(msg).not.toMatch(/Attendance|Check-in|Late duration|EGP|Escalation|Potential/i);
  });

  it('manager-approved positive deduction is Arabic only', () => {
    const msg = buildManagerDecisionEmployeeMessage({ lateMinutes: 135, amount: 200 });
    expect(msg).toContain('مدة التأخير: *135 دقيقة*');
    expect(msg).toContain('قرار إداري');
    expect(msg).toContain('200.00');
    expect(msg).not.toMatch(/Attendance|Check-in|Escalation|EGP|Potential/i);
  });

  it('ledger retains work date and actual lateness', () => {
    expect(buildLateDeductionLedgerNote({
      workDate: '2026-11-18', lateMinutes: 15, kind: 'quarter',
    })).toContain('15 دقيقة');
  });
});
