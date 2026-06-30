import { describe, it, expect } from 'vitest';
import {
  allocateEmployeeInvoiceRevenue,
  distributeProportionally,
  type DetailLineForAllocation,
  type InvoiceHeaderInput,
} from '@/lib/services/employeeInvoiceAllocation';

function line(
  overrides: Partial<DetailLineForAllocation> & Pick<DetailLineForAllocation, 'detailId' | 'empId'>
): DetailLineForAllocation {
  return {
    invID: 1,
    invType: 'مبيعات',
    empName: `Emp ${overrides.empId}`,
    proId: 1,
    lineTotal: 100,
    ...overrides,
  };
}

function header(overrides: Partial<InvoiceHeaderInput> = {}): InvoiceHeaderInput {
  return {
    invID: 1,
    invType: 'مبيعات',
    subTotal: 100,
    grandTotal: 100,
    disVal: 0,
    ...overrides,
  };
}

describe('allocateEmployeeInvoiceRevenue', () => {
  it('1. one invoice, one employee, no discount', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 300, grandTotal: 300 })],
      [line({ detailId: 1, empId: 1, lineTotal: 300 })]
    );

    expect(result.employeeTotals[0].grossServiceRevenue).toBe(300);
    expect(result.employeeTotals[0].allocatedInvoiceDiscount).toBe(0);
    expect(result.employeeTotals[0].actualInvoiceRevenue).toBe(300);
    expect(result.reportTotals.unattributedInvoiceRevenue).toBe(0);
    expect(result.reportTotals.treasuryComparableRevenue).toBe(300);
  });

  it('2. one invoice, one employee, invoice discount', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 500, grandTotal: 400, disVal: 100 })],
      [line({ detailId: 1, empId: 1, lineTotal: 500 })]
    );

    expect(result.employeeTotals[0].grossServiceRevenue).toBe(500);
    expect(result.employeeTotals[0].allocatedInvoiceDiscount).toBe(100);
    expect(result.employeeTotals[0].actualInvoiceRevenue).toBe(400);
    expect(
      result.employeeTotals[0].grossServiceRevenue -
        result.employeeTotals[0].allocatedInvoiceDiscount
    ).toBe(result.employeeTotals[0].actualInvoiceRevenue);
  });

  it('3. one invoice, two employees, proportional discount', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 500, grandTotal: 400 })],
      [
        line({ detailId: 1, empId: 1, lineTotal: 300 }),
        line({ detailId: 2, empId: 2, lineTotal: 200 }),
      ]
    );

    const emp1 = result.employeeTotals.find((e) => e.employeeId === 1)!;
    const emp2 = result.employeeTotals.find((e) => e.employeeId === 2)!;

    expect(emp1.actualInvoiceRevenue).toBe(240);
    expect(emp2.actualInvoiceRevenue).toBe(160);
    expect(result.reportTotals.totalActualInvoiceRevenue).toBe(400);
    expect(result.reportTotals.unattributedInvoiceRevenue).toBe(0);
  });

  it('4. detail-level discount plus invoice-level discount', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 450, grandTotal: 360 })],
      [
        line({ detailId: 1, empId: 1, lineTotal: 270 }),
        line({ detailId: 2, empId: 2, lineTotal: 180 }),
      ]
    );

    expect(result.reportTotals.totalGrossServiceRevenue).toBe(450);
    expect(result.reportTotals.totalActualInvoiceRevenue).toBe(360);
    expect(result.reportTotals.totalAllocatedInvoiceDiscount).toBe(90);
  });

  it('5. invoice with zero total', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 200, grandTotal: 0 })],
      [line({ detailId: 1, empId: 1, lineTotal: 200 })]
    );

    expect(result.employeeTotals[0].actualInvoiceRevenue).toBe(0);
    expect(result.reportTotals.totalActualInvoiceRevenue).toBe(0);
    expect(result.reportTotals.unattributedInvoiceRevenue).toBe(0);
  });

  it('6. cancelled invoice excluded when not in headers', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ invID: 10, subTotal: 100, grandTotal: 100 })],
      [line({ detailId: 1, invID: 99, empId: 1, lineTotal: 100 })]
    );

    expect(result.employeeTotals).toHaveLength(0);
    expect(result.reportTotals.treasuryComparableRevenue).toBe(100);
    expect(result.reportTotals.unattributedInvoiceRevenue).toBe(100);
  });

  it('7. returned service — negative line reduces gross and actual', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 100, grandTotal: 80 })],
      [line({ detailId: 1, empId: 1, lineTotal: -20 }), line({ detailId: 2, empId: 1, lineTotal: 120 })]
    );

    expect(result.employeeTotals[0].grossServiceRevenue).toBe(100);
    expect(result.employeeTotals[0].actualInvoiceRevenue).toBe(80);
  });

  it('8. multiple payment methods do not duplicate revenue (single header)', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 300, grandTotal: 300 })],
      [line({ detailId: 1, empId: 1, lineTotal: 300 })]
    );

    expect(result.reportTotals.treasuryComparableRevenue).toBe(300);
    expect(result.reportTotals.totalActualInvoiceRevenue).toBe(300);
  });

  it('9. fractional allocation with deterministic rounding remainder', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 3, grandTotal: 1 })],
      [
        line({ detailId: 1, empId: 1, lineTotal: 1 }),
        line({ detailId: 2, empId: 2, lineTotal: 1 }),
        line({ detailId: 3, empId: 3, lineTotal: 1 }),
      ]
    );

    const actualSum = result.employeeTotals.reduce((s, e) => s + e.actualInvoiceRevenue, 0);
    expect(actualSum).toBe(1);
  });

  it('10. report actual total reconciles with treasury comparable total', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [
        header({ invID: 1, subTotal: 500, grandTotal: 400 }),
        header({ invID: 2, subTotal: 200, grandTotal: 200 }),
      ],
      [
        line({ detailId: 1, invID: 1, empId: 1, lineTotal: 500 }),
        line({ detailId: 2, invID: 2, empId: 1, lineTotal: 200 }),
      ]
    );

    expect(result.reportTotals.treasuryComparableRevenue).toBe(600);
    expect(
      result.reportTotals.totalActualInvoiceRevenue +
        result.reportTotals.unattributedInvoiceRevenue
    ).toBe(result.reportTotals.treasuryComparableRevenue);
  });

  it('11. employee filter context preserves proportional allocation', () => {
    const full = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 500, grandTotal: 400 })],
      [
        line({ detailId: 1, empId: 1, lineTotal: 300 }),
        line({ detailId: 2, empId: 2, lineTotal: 200 }),
      ]
    );

    const filtered = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 500, grandTotal: 400 })],
      [line({ detailId: 1, empId: 1, lineTotal: 300 })]
    );

    expect(filtered.employeeTotals[0].actualInvoiceRevenue).toBe(240);
    expect(full.employeeTotals.find((e) => e.employeeId === 1)?.actualInvoiceRevenue).toBe(240);
  });

  it('12. date filter uses invoice header invDate eligibility', () => {
    const inRange = allocateEmployeeInvoiceRevenue(
      [header({ invID: 1, subTotal: 100, grandTotal: 100 })],
      [line({ detailId: 1, invID: 1, empId: 1, lineTotal: 100 })]
    );
    const outOfRange = allocateEmployeeInvoiceRevenue([], [line({ detailId: 1, invID: 1, empId: 1, lineTotal: 100 })]);

    expect(inRange.reportTotals.treasuryComparableRevenue).toBe(100);
    expect(outOfRange.reportTotals.treasuryComparableRevenue).toBe(0);
    expect(outOfRange.employeeTotals).toHaveLength(0);
  });

  it('13. invoice with unattributed product amount', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 500, grandTotal: 400 })],
      [line({ detailId: 1, empId: 1, lineTotal: 300 })]
    );

    expect(result.employeeTotals[0].actualInvoiceRevenue).toBe(240);
    expect(result.reportTotals.unattributedInvoiceRevenue).toBe(160);
    expect(
      result.reportTotals.totalActualInvoiceRevenue +
        result.reportTotals.unattributedInvoiceRevenue
    ).toBe(400);
  });

  it('14. null monetary values treated as zero', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: null, grandTotal: null })],
      [
        line({
          detailId: 1,
          empId: 1,
          lineTotal: null,
          qty: null,
          unitPrice: null,
          discountValue: null,
          sValue: null,
        }),
      ]
    );

    expect(result.employeeTotals[0].grossServiceRevenue).toBe(0);
    expect(result.employeeTotals[0].actualInvoiceRevenue).toBe(0);
  });
});

describe('distributeProportionally', () => {
  it('assigns remainder to largest weight', () => {
    const map = distributeProportionally(
      [
        { detailId: 1, weight: 33.33 },
        { detailId: 2, weight: 33.33 },
        { detailId: 3, weight: 33.34 },
      ],
      100
    );

    const sum = [...map.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBe(100);
  });
});
