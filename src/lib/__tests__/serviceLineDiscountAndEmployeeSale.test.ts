import { describe, it, expect } from 'vitest';
import {
  computeServiceLineTotals,
  computeInvoiceItemsTotals,
  hasNonZeroHeaderDiscount,
} from '@/lib/sales/service-line-totals';
import {
  allocateEmployeeInvoiceRevenue,
  type DetailLineForAllocation,
  type InvoiceHeaderInput,
} from '@/lib/services/employeeInvoiceAllocation';
import {
  buildEmployeeSaleMessage,
  employeeSaleGroupTotal,
  groupEmployeeSaleDetails,
} from '@/lib/sales/employee-sale-whatsapp';
import { buildEmployeeSalePayload } from '@/lib/integrations/whatsapp/payload-builders';

function line(
  overrides: Partial<DetailLineForAllocation> & Pick<DetailLineForAllocation, 'detailId' | 'empId'>,
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

describe('computeServiceLineTotals', () => {
  it('1. one service no discount', () => {
    const t = computeServiceLineTotals({ sPrice: 150, qty: 1 });
    expect(t).toEqual({
      grossAmount: 150,
      discountPercent: 0,
      discountValue: 0,
      netAmount: 150,
    });
  });

  it('2. discount value on service', () => {
    const t = computeServiceLineTotals({ sPrice: 150, qty: 1, discountValue: 20 });
    expect(t.grossAmount).toBe(150);
    expect(t.discountValue).toBe(20);
    expect(t.netAmount).toBe(130);
  });

  it('3. discount percent on service', () => {
    const t = computeServiceLineTotals({ sPrice: 200, qty: 1, discountPercent: 10 });
    expect(t.discountValue).toBe(20);
    expect(t.netAmount).toBe(180);
    expect(t.discountPercent).toBe(10);
  });

  it('4. multi services — discount on one only', () => {
    const totals = computeInvoiceItemsTotals([
      { sPrice: 150, qty: 1, discountValue: 20 },
      { sPrice: 100, qty: 1, discountValue: 0 },
    ]);
    expect(totals.lines[0]!.netAmount).toBe(130);
    expect(totals.lines[1]!.netAmount).toBe(100);
    expect(totals.totalDiscount).toBe(20);
    expect(totals.grandTotal).toBe(230);
    expect(totals.subTotal).toBe(250);
  });

  it('5. discount does not spill to other lines', () => {
    const totals = computeInvoiceItemsTotals([
      { sPrice: 150, qty: 1, discountValue: 20 },
      { sPrice: 100, qty: 1 },
      { sPrice: 1000, qty: 1 },
    ]);
    expect(totals.lines[1]!.discountValue).toBe(0);
    expect(totals.lines[2]!.discountValue).toBe(0);
    expect(totals.lines[1]!.netAmount).toBe(100);
    expect(totals.lines[2]!.netAmount).toBe(1000);
  });

  it('6. invoice total equals sum of line nets', () => {
    const totals = computeInvoiceItemsTotals([
      { sPrice: 150, qty: 1, discountValue: 20 },
      { sPrice: 100, qty: 1 },
    ]);
    expect(totals.grandTotal).toBe(
      totals.lines.reduce((s, l) => s + l.netAmount, 0),
    );
  });

  it('rejects header discount detection for non-zero', () => {
    expect(hasNonZeroHeaderDiscount({ disVal: 10 })).toBe(true);
    expect(hasNonZeroHeaderDiscount({ dis: 5 })).toBe(true);
    expect(hasNonZeroHeaderDiscount({ dis: 0, disVal: 0 })).toBe(false);
  });

  it('clamps discount not above gross and not below zero', () => {
    expect(computeServiceLineTotals({ sPrice: 50, qty: 1, discountValue: 80 }).netAmount).toBe(0);
    expect(computeServiceLineTotals({ sPrice: 50, qty: 1, discountValue: -5 }).discountValue).toBe(0);
  });

  it('qty must be positive — treats invalid as 1', () => {
    expect(computeServiceLineTotals({ sPrice: 100, qty: 0 }).grossAmount).toBe(100);
  });
});

describe('allocateEmployeeInvoiceRevenue — line-net vs legacy header', () => {
  it('12. three services three employees — each gets own net', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 1250, grandTotal: 1130, disVal: 0 })],
      [
        line({ detailId: 1, empId: 5, lineTotal: 130 }),
        line({ detailId: 2, empId: 8, lineTotal: 100 }),
        line({ detailId: 3, empId: 12, lineTotal: 900 }),
      ],
    );
    // 130+100+900=1130 → line-net path
    expect(result.employeeTotals.find((e) => e.employeeId === 5)!.actualInvoiceRevenue).toBe(130);
    expect(result.employeeTotals.find((e) => e.employeeId === 8)!.actualInvoiceRevenue).toBe(100);
    expect(result.employeeTotals.find((e) => e.employeeId === 12)!.actualInvoiceRevenue).toBe(900);
  });

  it('13. one employee two services — sum of nets', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 250, grandTotal: 230, disVal: 0 })],
      [
        line({ detailId: 1, empId: 5, lineTotal: 130 }),
        line({ detailId: 2, empId: 5, lineTotal: 100 }),
      ],
    );
    expect(result.employeeTotals).toHaveLength(1);
    expect(result.employeeTotals[0]!.actualInvoiceRevenue).toBe(230);
  });

  it('14. line discount on emp A does not reduce emp B', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 250, grandTotal: 230, disVal: 0 })],
      [
        line({ detailId: 1, empId: 5, lineTotal: 130 }),
        line({ detailId: 2, empId: 8, lineTotal: 100 }),
      ],
    );
    expect(result.employeeTotals.find((e) => e.employeeId === 5)!.actualInvoiceRevenue).toBe(130);
    expect(result.employeeTotals.find((e) => e.employeeId === 8)!.actualInvoiceRevenue).toBe(100);
  });

  it('15. legacy header discount still uses proportional allocation', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 1250, grandTotal: 1125, disVal: 125 })],
      [
        line({ detailId: 1, empId: 5, lineTotal: 150 }),
        line({ detailId: 2, empId: 8, lineTotal: 100 }),
        line({ detailId: 3, empId: 12, lineTotal: 1000 }),
      ],
    );
    expect(result.employeeTotals.find((e) => e.employeeId === 5)!.actualInvoiceRevenue).toBe(135);
    expect(result.employeeTotals.find((e) => e.employeeId === 8)!.actualInvoiceRevenue).toBe(90);
    expect(result.employeeTotals.find((e) => e.employeeId === 12)!.actualInvoiceRevenue).toBe(900);
  });

  it('example Hair Cut 130 + Beard 100', () => {
    const result = allocateEmployeeInvoiceRevenue(
      [header({ subTotal: 250, grandTotal: 230, disVal: 0 })],
      [
        line({ detailId: 1, empId: 5, lineTotal: 130 }),
        line({ detailId: 2, empId: 8, lineTotal: 100 }),
      ],
    );
    expect(result.employeeTotals.find((e) => e.employeeId === 5)!.actualInvoiceRevenue).toBe(130);
    expect(result.employeeTotals.find((e) => e.employeeId === 8)!.actualInvoiceRevenue).toBe(100);
    expect(result.reportTotals.totalActualInvoiceRevenue).toBe(230);
  });
});

describe('employee sale WhatsApp grouping', () => {
  const resolvePhone = (wa: string | null | undefined, mobile: string | null | undefined) =>
    wa?.trim() || mobile?.trim() || null;

  it('16. one employee → one group', () => {
    const map = groupEmployeeSaleDetails(
      [
        {
          EmpID: 5,
          EmpName: 'Ali',
          Mobile: '0100',
          ProID: 1,
          ServiceName: 'Hair Cut',
          SPrice: 150,
          Qty: 1,
          DisVal: 20,
          SValue: 150,
        },
      ],
      resolvePhone,
    );
    expect(map.size).toBe(1);
    expect(employeeSaleGroupTotal(map.get(5)!)).toBe(130);
  });

  it('17. two employees → two groups', () => {
    const map = groupEmployeeSaleDetails(
      [
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 1,
          ServiceName: 'Hair Cut',
          SValue: 150,
          DisVal: 20,
          SPrice: 150,
          Qty: 1,
        },
        {
          EmpID: 8,
          EmpName: 'B',
          Mobile: '0101',
          ProID: 2,
          ServiceName: 'Beard',
          SValue: 100,
          DisVal: 0,
          SPrice: 100,
          Qty: 1,
        },
      ],
      resolvePhone,
    );
    expect(map.size).toBe(2);
  });

  it('18. one employee two services → single group with both', () => {
    const map = groupEmployeeSaleDetails(
      [
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 1,
          ServiceName: 'Hair Cut',
          SValue: 150,
          DisVal: 20,
          SPrice: 150,
          Qty: 1,
        },
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 2,
          ServiceName: 'Beard',
          SValue: 100,
          DisVal: 0,
          SPrice: 100,
          Qty: 1,
        },
      ],
      resolvePhone,
    );
    expect(map.size).toBe(1);
    expect(map.get(5)!.services).toHaveLength(2);
    expect(employeeSaleGroupTotal(map.get(5)!)).toBe(230);
  });

  it('19. each employee sees only own services', () => {
    const map = groupEmployeeSaleDetails(
      [
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 1,
          ServiceName: 'Hair Cut',
          SValue: 150,
          DisVal: 20,
          SPrice: 150,
          Qty: 1,
        },
        {
          EmpID: 8,
          EmpName: 'B',
          Mobile: '0101',
          ProID: 2,
          ServiceName: 'Beard',
          SValue: 100,
          DisVal: 0,
          SPrice: 100,
          Qty: 1,
        },
      ],
      resolvePhone,
    );
    expect(map.get(5)!.services.map((s) => s.serviceName)).toEqual(['Hair Cut']);
    expect(map.get(8)!.services.map((s) => s.serviceName)).toEqual(['Beard']);
  });

  it('20. employeeTotal equals sum of nets', () => {
    const map = groupEmployeeSaleDetails(
      [
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 1,
          ServiceName: 'Hair Cut',
          SValue: 150,
          DisVal: 20,
          SPrice: 150,
          Qty: 1,
        },
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 2,
          ServiceName: 'Beard',
          SValue: 100,
          DisVal: 0,
          SPrice: 100,
          Qty: 1,
        },
      ],
      resolvePhone,
    );
    expect(employeeSaleGroupTotal(map.get(5)!)).toBe(230);
  });

  it('21. missing phone still creates group with null phone (caller skips send)', () => {
    const map = groupEmployeeSaleDetails(
      [
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: null,
          WhatsApp: null,
          ProID: 1,
          ServiceName: 'Hair Cut',
          SValue: 150,
          DisVal: 0,
          SPrice: 150,
          Qty: 1,
        },
        {
          EmpID: 8,
          EmpName: 'B',
          Mobile: '0101',
          ProID: 2,
          ServiceName: 'Beard',
          SValue: 100,
          DisVal: 0,
          SPrice: 100,
          Qty: 1,
        },
      ],
      resolvePhone,
    );
    expect(map.get(5)!.phone).toBeNull();
    expect(map.get(8)!.phone).toBe('0101');
  });

  it('24. same EmpID never duplicated as separate groups', () => {
    const map = groupEmployeeSaleDetails(
      [
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 1,
          ServiceName: 'S1',
          SValue: 50,
          DisVal: 0,
          SPrice: 50,
          Qty: 1,
        },
        {
          EmpID: 5,
          EmpName: 'A',
          Mobile: '0100',
          ProID: 2,
          ServiceName: 'S2',
          SValue: 50,
          DisVal: 0,
          SPrice: 50,
          Qty: 1,
        },
      ],
      resolvePhone,
    );
    expect([...map.keys()]).toEqual([5]);
  });

  it('builds short employee_sale message with name, invoice, services', () => {
    const msg = buildEmployeeSaleMessage({
      employeeName: 'محمد',
      invID: 7703,
      services: [
        {
          proId: 1,
          serviceName: 'Haircut & Beard',
          grossAmount: 200,
          discountValue: 0,
          netAmount: 200,
        },
      ],
    });
    expect(msg).toBe(
      [
        'تم تسجيل فاتورة جديدة لك محمد:',
        'رقم الفاتورة: INV-7703',
        'الخدمات: Haircut & Beard',
      ].join('\n'),
    );
  });

  it('buildEmployeeSalePayload includes employeeTotal and message', () => {
    const payload = buildEmployeeSalePayload({
      phone: '0100',
      employeeName: 'Ali',
      customerName: 'أحمد',
      invID: 10,
      employeeId: 5,
      services: ['Hair Cut'],
      employeeTotal: 130,
      invoiceTotal: 230,
      message: 'test',
      serviceDetails: [
        {
          detailId: 1,
          proId: 10,
          serviceName: 'Hair Cut',
          grossAmount: 150,
          discountValue: 20,
          netAmount: 130,
        },
      ],
    });
    expect(payload.type).toBe('employee_sale');
    expect(payload.employeeTotal).toBe(130);
    expect(payload.invoiceTotal).toBe(230);
    expect(payload.clientName).toBe('أحمد');
    expect(payload.message).toBe('test');
    expect(payload.serviceDetails?.[0]?.netAmount).toBe(130);
  });
});
