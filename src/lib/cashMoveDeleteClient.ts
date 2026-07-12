/**
 * Client-side helpers for CashMove delete UX + HR ledger refresh.
 */

export const EMPLOYEE_LEDGER_REFRESH_EVENT = 'employee-ledger:refresh';

export function cashMoveDeleteToastMessage(
  data: { message?: string; ledgerDeletedCount?: number } | null | undefined,
  fallback: string,
): string {
  if (data && typeof data.ledgerDeletedCount === 'number' && data.ledgerDeletedCount > 0) {
    return 'تم حذف الحركة وحذف تأثيرها من دفتر الموظفين.';
  }
  if (data?.message && typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }
  return fallback;
}

/** Notify mounted HR ledger panels to reload summary/entries. */
export function notifyEmployeeLedgerRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EMPLOYEE_LEDGER_REFRESH_EVENT));
}
