import type { EmpLedgerEntryRow } from '@/lib/types/employee-ledger';
import { roundMoney } from '@/lib/reportMonthUtils';

export type EmpLedgerEntryWithRunningBalance = EmpLedgerEntryRow & {
  runningBalance: number;
};

/**
 * Attach balance-after-entry for each row.
 * Input may be DESC (UI default: newest first); balance is computed chronologically
 * using credit − debit, matching the employee ledger formula.
 */
export function attachRunningBalances(
  entries: EmpLedgerEntryRow[],
): EmpLedgerEntryWithRunningBalance[] {
  const chronological = [...entries].reverse();
  let running = 0;
  const byId = new Map<number, number>();
  for (const entry of chronological) {
    const signed = entry.entryDirection === 'credit' ? entry.amount : -entry.amount;
    running = roundMoney(running + signed);
    byId.set(entry.id, running);
  }
  return entries.map((entry) => ({
    ...entry,
    runningBalance: byId.get(entry.id) ?? 0,
  }));
}
