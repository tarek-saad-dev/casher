import { describe, expect, it } from 'vitest';
import {
  isSourceLinkedLedgerEntry,
  validateEditableLedgerFields,
} from '@/lib/hr/employee-ledger-entry-actions';

const base = {
  entryDate: '2026-11-12',
  entryDirection: 'credit',
  entryReason: 'adjustment',
  amount: 125.25,
  payrollMonth: '2026-11',
  notes: 'تصحيح يدوي',
};

describe('employee ledger entry controls', () => {
  it('treats any source reference as linked, including a treasury or attendance FK', () => {
    const empty = { refType: null, refId: null, cashMoveId: null, attendanceId: null };
    expect(isSourceLinkedLedgerEntry(empty)).toBe(false);
    expect(isSourceLinkedLedgerEntry({ ...empty, refType: 'TblEmpDailyPayroll' })).toBe(true);
    expect(isSourceLinkedLedgerEntry({ ...empty, cashMoveId: 100 })).toBe(true);
    expect(isSourceLinkedLedgerEntry({ ...empty, attendanceId: 200 })).toBe(true);
    expect(isSourceLinkedLedgerEntry({ ...empty, refId: 300 })).toBe(true);
  });

  it('validates financial fields and optional notes for standalone entries', () => {
    expect(validateEditableLedgerFields(base)).toEqual(base);
    expect(validateEditableLedgerFields({ ...base, payrollMonth: '', notes: '' })).toMatchObject({
      payrollMonth: null, notes: null,
    });
  });

  it.each([
    [{ ...base, entryDate: '2026-02-30' }, 'تاريخ'],
    [{ ...base, amount: -2 }, 'المبلغ'],
    [{ ...base, amount: 2.345 }, 'المبلغ'],
    [{ ...base, entryDirection: 'other' }, 'اتجاه'],
    [{ ...base, entryReason: 'unknown' }, 'نوع'],
    [{ ...base, payrollMonth: '2026-13' }, 'شهر'],
    [{ ...base, notes: 'x'.repeat(501) }, 'الملاحظات'],
  ])('rejects invalid ledger changes', (input, errorFragment) => {
    expect(() => validateEditableLedgerFields(input)).toThrow(errorFragment);
  });
});
