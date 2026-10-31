import { describe, expect, it } from 'vitest';
import { isLateDeductionLedgerUniqueError } from '../ledger';

describe('late deduction ledger unique race detection', () => {
  it('treats SQL 2627/2601 and duplicate-key messages as recoverable races', () => {
    expect(isLateDeductionLedgerUniqueError({ number: 2627, message: 'Violation' })).toBe(true);
    expect(isLateDeductionLedgerUniqueError({ number: 2601, message: 'dup' })).toBe(true);
    expect(isLateDeductionLedgerUniqueError(new Error('Cannot insert duplicate key'))).toBe(true);
    expect(isLateDeductionLedgerUniqueError({ number: 547, message: 'FK' })).toBe(false);
  });
});
