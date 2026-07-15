export const EMP_LEDGER_REF_TYPE_DAILY_TARGET = 'TblEmpDailyTarget' as const;
export const EMP_LEDGER_REASON_TARGET = 'target' as const;
export const EMP_LEDGER_DIRECTION_CREDIT = 'credit' as const;

export function payrollMonthFromWorkDate(workDate: string): string {
  return workDate.slice(0, 7);
}

export function buildDailyTargetLedgerNote(workDate: string): string {
  return `استحقاق تارجت يومي بتاريخ ${workDate}`;
}

/** Ledger Amount is DECIMAL(12,2) with CHECK > 0. */
export function roundLedgerAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}
