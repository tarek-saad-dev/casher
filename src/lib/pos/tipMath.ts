import { roundMoney } from '@/lib/reportMonthUtils';

/** Tip = amount customer paid minus final invoice total. */
export function calculateTipAmount(amountPaid: number, invoiceTotal: number): number {
  return roundMoney(amountPaid - invoiceTotal);
}

export interface TipBarberCandidate {
  empId: number;
  empName: string;
  lineTotal: number;
}

/** Group cart lines by barber, highest revenue first. */
export function resolveTipBarberCandidates(
  items: Array<{ EmpID: number; EmpName: string; SPrice: number; Qty: number }>,
): TipBarberCandidate[] {
  const byEmp = new Map<number, TipBarberCandidate>();

  for (const item of items) {
    if (!item.EmpID) continue;
    const lineTotal = roundMoney(Number(item.SPrice) * Number(item.Qty));
    const existing = byEmp.get(item.EmpID);
    if (existing) {
      existing.lineTotal = roundMoney(existing.lineTotal + lineTotal);
    } else {
      byEmp.set(item.EmpID, {
        empId: item.EmpID,
        empName: item.EmpName,
        lineTotal,
      });
    }
  }

  return Array.from(byEmp.values()).sort((a, b) => b.lineTotal - a.lineTotal);
}
