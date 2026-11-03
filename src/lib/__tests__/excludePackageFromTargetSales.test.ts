import { describe, expect, it } from 'vitest';
import { buildGroomPackageMetadataNote } from '@/lib/booking/groomPackageMetadata';
import { excludePackageRevenueFromTargetAllocation } from '@/lib/payroll/employee-target/excludePackageFromTargetSales';
import { allocateEmployeeInvoiceRevenue } from '@/lib/services/employeeInvoiceAllocation';
import type { DetailLineForAllocation } from '@/lib/services/employeeInvoiceAllocation';

const INV_TYPE = 'مبيعات';

function line(
  partial: Partial<DetailLineForAllocation> & {
    detailId: number;
    invID: number;
    empId: number;
    proId: number;
    lineTotal: number;
  },
): DetailLineForAllocation {
  return {
    invType: INV_TYPE,
    empName: `Emp${partial.empId}`,
    qty: 1,
    unitPrice: partial.lineTotal,
    discountValue: 0,
    sValue: partial.lineTotal,
    ...partial,
  };
}

describe('excludePackageRevenueFromTargetAllocation', () => {
  it('package-only invoice → employee target sales 0', () => {
    const notes2 = buildGroomPackageMetadataNote({
      packageId: 10,
      packagePrice: 600,
      addonProIds: [],
      requiredServiceIds: [101, 102],
      totalPrice: 600,
    });
    const headers = [
      {
        invID: 1,
        invType: INV_TYPE,
        subTotal: 600,
        grandTotal: 600,
        disVal: 0,
        notes2,
      },
    ];
    const details = [
      line({ detailId: 1, invID: 1, empId: 7, proId: 101, lineTotal: 600 }),
      line({ detailId: 2, invID: 1, empId: 7, proId: 102, lineTotal: 0 }),
    ];

    const filtered = excludePackageRevenueFromTargetAllocation(headers, details);
    expect(filtered.detailLines).toHaveLength(0);
    expect(filtered.headers[0]).toMatchObject({
      subTotal: 0,
      grandTotal: 0,
      disVal: 0,
    });

    const allocation = allocateEmployeeInvoiceRevenue(
      filtered.headers,
      filtered.detailLines,
    );
    expect(allocation.employeeTotals).toHaveLength(0);
  });

  it('package + paid addon → only addon amount remains', () => {
    const notes2 = buildGroomPackageMetadataNote({
      packageId: 10,
      packagePrice: 600,
      addonProIds: [201],
      requiredServiceIds: [101, 102],
      totalPrice: 650,
    });
    const headers = [
      {
        invID: 2,
        invType: INV_TYPE,
        subTotal: 650,
        grandTotal: 650,
        disVal: 0,
        notes2,
      },
    ];
    const details = [
      line({ detailId: 1, invID: 2, empId: 7, proId: 101, lineTotal: 600 }),
      line({ detailId: 2, invID: 2, empId: 7, proId: 102, lineTotal: 0 }),
      line({ detailId: 3, invID: 2, empId: 7, proId: 201, lineTotal: 50 }),
    ];

    const filtered = excludePackageRevenueFromTargetAllocation(headers, details);
    expect(filtered.detailLines).toHaveLength(1);
    expect(filtered.detailLines[0].proId).toBe(201);
    expect(filtered.headers[0]).toMatchObject({
      subTotal: 50,
      grandTotal: 50,
      disVal: 0,
    });

    const allocation = allocateEmployeeInvoiceRevenue(
      filtered.headers,
      filtered.detailLines,
    );
    expect(allocation.employeeTotals).toHaveLength(1);
    expect(allocation.employeeTotals[0].actualInvoiceRevenue).toBe(50);
  });

  it('non-package invoice → unchanged', () => {
    const headers = [
      {
        invID: 3,
        invType: INV_TYPE,
        subTotal: 120,
        grandTotal: 120,
        disVal: 0,
        notes2: null,
      },
    ];
    const details = [
      line({ detailId: 1, invID: 3, empId: 7, proId: 55, lineTotal: 120 }),
    ];

    const filtered = excludePackageRevenueFromTargetAllocation(headers, details);
    expect(filtered.detailLines).toEqual(details);
    expect(filtered.headers[0]).toMatchObject({
      subTotal: 120,
      grandTotal: 120,
      disVal: 0,
    });

    const allocation = allocateEmployeeInvoiceRevenue(
      filtered.headers,
      filtered.detailLines,
    );
    expect(allocation.employeeTotals[0].actualInvoiceRevenue).toBe(120);
  });

  it('legacy DisVal > 0 mixed invoice → package gross does not inflate addon share', () => {
    const notes2 = buildGroomPackageMetadataNote({
      packageId: 10,
      packagePrice: 600,
      addonProIds: [201],
      requiredServiceIds: [101],
      totalPrice: 650,
    });
    // SubTotal 650, header discount 65 → GrandTotal 585
    const headers = [
      {
        invID: 4,
        invType: INV_TYPE,
        subTotal: 650,
        grandTotal: 585,
        disVal: 65,
        notes2,
      },
    ];
    const details = [
      line({ detailId: 1, invID: 4, empId: 7, proId: 101, lineTotal: 600 }),
      line({ detailId: 2, invID: 4, empId: 7, proId: 201, lineTotal: 50 }),
    ];

    const filtered = excludePackageRevenueFromTargetAllocation(headers, details);
    expect(filtered.detailLines).toHaveLength(1);
    expect(filtered.detailLines[0].proId).toBe(201);
    // Remaining share: 50/650 of net → GrandTotal 45, DisVal 5
    expect(filtered.headers[0].subTotal).toBe(50);
    expect(filtered.headers[0].grandTotal).toBe(45);
    expect(filtered.headers[0].disVal).toBe(5);

    const allocation = allocateEmployeeInvoiceRevenue(
      filtered.headers,
      filtered.detailLines,
    );
    expect(allocation.employeeTotals).toHaveLength(1);
    expect(allocation.employeeTotals[0].actualInvoiceRevenue).toBe(45);
  });

  it('reads package marker from Notes when Notes2 empty', () => {
    const notes = buildGroomPackageMetadataNote({
      packageId: 3,
      packagePrice: 400,
      addonProIds: [],
      requiredServiceIds: [9],
      totalPrice: 400,
    });
    const headers = [
      {
        invID: 5,
        invType: INV_TYPE,
        subTotal: 400,
        grandTotal: 400,
        disVal: 0,
        notes,
        notes2: null,
      },
    ];
    const details = [
      line({ detailId: 1, invID: 5, empId: 1, proId: 9, lineTotal: 400 }),
    ];

    const filtered = excludePackageRevenueFromTargetAllocation(headers, details);
    expect(filtered.detailLines).toHaveLength(0);
    expect(filtered.headers[0].grandTotal).toBe(0);
  });
});
