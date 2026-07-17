import { describe, it, expect } from 'vitest';
import { calculateTipAmount, resolveTipBarberCandidates } from '@/lib/pos/tipMath';

describe('calculateTipAmount', () => {
  it('returns the overpayment difference', () => {
    expect(calculateTipAmount(250, 200)).toBe(50);
  });

  it('rounds to 2 decimals', () => {
    expect(calculateTipAmount(100.129, 90)).toBe(10.13);
  });

  it('returns zero when paid equals invoice', () => {
    expect(calculateTipAmount(150, 150)).toBe(0);
  });

  it('returns negative when underpaid', () => {
    expect(calculateTipAmount(100, 120)).toBe(-20);
  });
});

describe('resolveTipBarberCandidates', () => {
  it('groups by barber and sorts by line total desc', () => {
    const result = resolveTipBarberCandidates([
      { EmpID: 1, EmpName: 'أحمد', SPrice: 50, Qty: 1 },
      { EmpID: 2, EmpName: 'محمود', SPrice: 100, Qty: 1 },
      { EmpID: 1, EmpName: 'أحمد', SPrice: 80, Qty: 1 },
    ]);

    expect(result).toEqual([
      { empId: 1, empName: 'أحمد', lineTotal: 130 },
      { empId: 2, empName: 'محمود', lineTotal: 100 },
    ]);
  });

  it('returns empty for empty cart', () => {
    expect(resolveTipBarberCandidates([])).toEqual([]);
  });
});
