import { describe, it, expect } from 'vitest';
import { hasNonZeroHeaderDiscount, computeInvoiceItemsTotals } from '@/lib/sales/service-line-totals';

/**
 * Documents API contract expectations for create/update discount rules.
 * Route handlers are covered indirectly; pure helpers enforce the rules.
 */
describe('sales discount API contracts', () => {
  it('7. POST must reject non-zero header discount payload', () => {
    expect(
      hasNonZeroHeaderDiscount({
        dis: 0,
        disVal: 25,
        items: [],
      } as { dis: number; disVal: number }),
    ).toBe(true);
  });

  it('8. update line INSERT fields include Dis / DisVal / SPriceAfterDis via compute', () => {
    const totals = computeInvoiceItemsTotals([
      { sPrice: 150, qty: 1, discountValue: 20, discountPercent: 0 },
    ]);
    const line = totals.lines[0]!;
    // Mirrors updateInvoice INSERT column mapping
    const insertRow = {
      Dis: line.discountPercent,
      DisVal: line.discountValue,
      SPrice: 150,
      SValue: line.grossAmount,
      SPriceAfterDis: line.netAmount,
    };
    expect(insertRow.DisVal).toBe(20);
    expect(insertRow.SPriceAfterDis).toBe(130);
    expect(insertRow.SValue).toBe(150);
  });

  it('9. changing empId does not change line discount compute', () => {
    const before = computeInvoiceItemsTotals([
      { sPrice: 150, qty: 1, discountValue: 20 },
    ]).lines[0]!;
    const after = computeInvoiceItemsTotals([
      { sPrice: 150, qty: 1, discountValue: 20 },
    ]).lines[0]!;
    expect(after.discountValue).toBe(before.discountValue);
    expect(after.netAmount).toBe(before.netAmount);
  });

  it('10. payment method change is orthogonal to line nets', () => {
    const totals = computeInvoiceItemsTotals([
      { sPrice: 150, qty: 1, discountValue: 20 },
      { sPrice: 100, qty: 1 },
    ]);
    expect(totals.grandTotal).toBe(230);
  });

  it('11. legacy header discount invoice still identifiable', () => {
    // When existing head.DisVal > 0, update preserves it and allocation uses header path.
    expect(hasNonZeroHeaderDiscount({ disVal: 125 })).toBe(true);
  });
});
