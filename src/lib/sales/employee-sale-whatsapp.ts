/**
 * Group invoice detail lines by EmpID and build employee_sale WhatsApp content.
 */

import { roundMoney } from '@/lib/reportMonthUtils';
import { computeServiceLineTotals } from '@/lib/sales/service-line-totals';

export type EmployeeSaleServiceLine = {
  detailId?: number;
  proId: number;
  serviceName: string;
  grossAmount: number;
  discountValue: number;
  netAmount: number;
};

export type EmployeeSaleGroup = {
  empId: number;
  employeeName: string;
  phone: string | null;
  services: EmployeeSaleServiceLine[];
};

export type RawEmployeeSaleDetailRow = {
  EmpID: number;
  EmpName?: string | null;
  WhatsApp?: string | null;
  Mobile?: string | null;
  ProID?: number | null;
  ServiceName?: string | null;
  detailId?: number | null;
  ID?: number | null;
  SPrice?: number | null;
  Qty?: number | null;
  DisVal?: number | null;
  SValue?: number | null;
  SPriceAfterDis?: number | null;
};

export function groupEmployeeSaleDetails(
  rows: RawEmployeeSaleDetailRow[],
  resolvePhone: (whatsApp: string | null | undefined, mobile: string | null | undefined) => string | null,
): Map<number, EmployeeSaleGroup> {
  const byEmployee = new Map<number, EmployeeSaleGroup>();

  for (const row of rows) {
    const empId = Number(row.EmpID);
    if (!Number.isInteger(empId) || empId <= 0) continue;

    const qty = Number(row.Qty ?? 1);
    const sPrice = Number(row.SPrice ?? 0);
    const sValue = Number(row.SValue ?? 0);
    const disVal = Number(row.DisVal ?? 0);

    const totals = computeServiceLineTotals({
      sPrice: sPrice,
      qty: qty > 0 ? qty : 1,
      discountValue: disVal,
    });

    // Prefer SValue as gross when persisted (matches create INSERT).
    const grossAmount = sValue > 0 ? roundMoney(sValue) : totals.grossAmount;
    const discountValue = roundMoney(Math.max(0, Math.min(grossAmount, disVal)));
    // Net = gross − line DisVal (do not trust SPriceAfterDis — historically often unit price).
    const netAmount = roundMoney(Math.max(0, grossAmount - discountValue));

    const serviceName = (row.ServiceName ?? '').trim() || 'خدمة';
    const proId = Number(row.ProID ?? 0);
    const detailId =
      row.detailId != null
        ? Number(row.detailId)
        : row.ID != null
          ? Number(row.ID)
          : undefined;

    const service: EmployeeSaleServiceLine = {
      detailId: Number.isFinite(detailId as number) ? (detailId as number) : undefined,
      proId,
      serviceName,
      grossAmount,
      discountValue,
      netAmount,
    };

    const existing = byEmployee.get(empId);
    if (existing) {
      existing.services.push(service);
      continue;
    }

    const phone = resolvePhone(row.WhatsApp, row.Mobile);
    byEmployee.set(empId, {
      empId,
      employeeName: (row.EmpName ?? '').trim() || 'موظف',
      phone,
      services: [service],
    });
  }

  return byEmployee;
}

export function employeeSaleGroupTotal(group: EmployeeSaleGroup): number {
  return roundMoney(group.services.reduce((sum, s) => sum + s.netAmount, 0));
}

export function buildEmployeeSaleMessage(input: {
  employeeName: string;
  invID: number;
  services: EmployeeSaleServiceLine[];
}): string {
  const name = input.employeeName.trim() || 'موظف';
  const services = input.services
    .map((s) => s.serviceName.trim())
    .filter(Boolean)
    .join(', ');

  return [
    `تم تسجيل فاتورة جديدة لك ${name}:`,
    `رقم الفاتورة: INV-${input.invID}`,
    `الخدمات: ${services}`,
  ].join('\n');
}
