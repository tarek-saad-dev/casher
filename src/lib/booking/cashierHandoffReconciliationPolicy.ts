/**
 * Pure, deterministic evidence guard for linking a paid POS invoice to
 * an employee booking handoff. No writes, tenant lookups or payment effects.
 */
export type ReservedBookingLine = {
  ProID: number; EmpID: number; Qty: number;
};
export type PaidInvoiceLine = {
  ProID: number; EmpID: number | null; Qty: number;
};
export type SelectedHandoffLine = { proId: number; qty: number };

export function matchesPaidHandoffLines(
  selected: SelectedHandoffLine[],
  booked: ReservedBookingLine[],
  paid: PaidInvoiceLine[],
): boolean {
  if (!Array.isArray(selected) || selected.length === 0) return false;

  // Qty may be fractional for legacy retail, but employee booked services
  // must have valid whole quantities and valid performer identifiers.
  const allocation = new Map<string, number>();
  const remainingByPro = new Map<number, Array<{ employee: number; remaining: number }>>();
  for (const line of booked) {
    if (!Number.isSafeInteger(line.ProID) || line.ProID <= 0 ||
        !Number.isSafeInteger(line.EmpID) || line.EmpID <= 0 ||
        !Number.isSafeInteger(line.Qty) || line.Qty <= 0) return false;
    const existing = remainingByPro.get(line.ProID) ?? [];
    existing.push({ employee: line.EmpID, remaining: line.Qty });
    remainingByPro.set(line.ProID, existing);
  }
  for (const chosen of selected) {
    if (!Number.isSafeInteger(chosen.proId) || chosen.proId <= 0 ||
        !Number.isSafeInteger(chosen.qty) || chosen.qty <= 0) return false;
    const candidates = remainingByPro.get(chosen.proId) ?? [];
    let pending = chosen.qty;
    for (const reserved of candidates) {
      if (pending <= 0) break;
      const count = Math.min(pending, reserved.remaining);
      if (count <= 0) continue;
      reserved.remaining -= count;
      pending -= count;
      const key = chosen.proId + ':' + reserved.employee;
      allocation.set(key, (allocation.get(key) ?? 0) + count);
    }
    if (pending > 0) return false;
  }

  const paidByPerformer = new Map<string, number>();
  for (const line of paid) {
    if (!Number.isSafeInteger(line.ProID) || line.ProID <= 0 ||
        !Number.isSafeInteger(line.EmpID) || line.EmpID <= 0 ||
        !Number.isFinite(line.Qty) || line.Qty < 0) return false;
    const key = line.ProID + ':' + line.EmpID;
    paidByPerformer.set(key, (paidByPerformer.get(key) ?? 0) + line.Qty);
  }
  for (const [key, qty] of allocation) {
    if ((paidByPerformer.get(key) ?? 0) + 0.001 < qty) return false;
  }
  return true;
}
