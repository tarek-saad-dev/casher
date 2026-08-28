import { describe, expect, it } from 'vitest';
import { mergeEmployeeLedgerBranchScope } from '@/lib/services/employeeLedgerService';

describe('mergeEmployeeLedgerBranchScope', () => {
  it('always includes Camp Caesar table branch even when not in accessible set', () => {
    const gleem = 1;
    const campCaesar = 3;
    expect(mergeEmployeeLedgerBranchScope([gleem], [gleem, campCaesar])).toEqual([gleem, campCaesar]);
  });

  it('deduplicates and sorts branch ids', () => {
    expect(mergeEmployeeLedgerBranchScope([3, 1], [1, 3])).toEqual([1, 3]);
  });

  it('ignores invalid branch ids', () => {
    expect(mergeEmployeeLedgerBranchScope([0, -1, NaN], [2])).toEqual([2]);
  });
});
