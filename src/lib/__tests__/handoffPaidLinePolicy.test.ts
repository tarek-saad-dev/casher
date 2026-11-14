import { describe, expect, it } from 'vitest';
import { matchesPaidHandoffLines as valid } from '@/lib/booking/cashierHandoffReconciliationPolicy';

describe('safe reconciliation to an existing paid invoice', () => {
  const selected = [{ proId: 9, qty: 2 }];
  const booked = [
    { ProID: 9, EmpID: 7, Qty: 1 },
    { ProID: 9, EmpID: 8, Qty: 1 },
  ];
  it('accepts same service performed by two barbers with correct invoice attribution', () => {
    expect(valid(selected, booked, [
      { ProID: 9, EmpID: 7, Qty: 1 },
      { ProID: 9, EmpID: 8, Qty: 1 },
    ])).toBe(true);
  });
  it('rejects wrong-barber invoice, even if total service quantity matches', () => {
    expect(valid(selected, booked, [{ ProID: 9, EmpID: 7, Qty: 2 }])).toBe(false);
  });
  it('rejects partially paid or missing extra services', () => {
    expect(valid(selected, booked, [{ ProID: 9, EmpID: 8, Qty: 1 }])).toBe(false);
  });
  it('rejects quantities not backed by reserved booking rows', () => {
    expect(valid([{ proId: 9, qty: 3 }], booked, [
      { ProID: 9, EmpID: 7, Qty: 2 },
      { ProID: 9, EmpID: 8, Qty: 1 },
    ])).toBe(false);
  });
  it('does not double count one booking service row when duplicate selection lines exist', () => {
    expect(valid([{ proId: 9, qty: 1 }, { proId: 9, qty: 2 }], booked, [
      { ProID: 9, EmpID: 7, Qty: 3 },
    ])).toBe(false);
  });
  it('rejects missing employee id and fractional reserved quantities', () => {
    expect(valid(selected, booked, [
      { ProID: 9, EmpID: null, Qty: 2 },
    ])).toBe(false);
    expect(valid([{ proId: 9, qty: 1 }], [
      { ProID: 9, EmpID: 7, Qty: 0.5 },
    ], [{ ProID: 9, EmpID: 7, Qty: 1 }])).toBe(false);
  });
  it('rejects empty handoff selection and non-finite quantities', () => {
    expect(valid([], booked, [])).toBe(false);
    expect(valid([{ proId: 9, qty: NaN }], booked, [
      { ProID: 9, EmpID: 7, Qty: 1 },
    ])).toBe(false);
  });
});
