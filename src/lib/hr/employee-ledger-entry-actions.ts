import type { EmpLedgerEntryRow } from '@/lib/types/employee-ledger';
import { EMP_LEDGER_ENTRY_REASONS, type EmpLedgerEntryReason } from '@/lib/types/employee-ledger';

export type LedgerEntryLink = Pick<EmpLedgerEntryRow, 'refType' | 'refId' | 'cashMoveId' | 'attendanceId'>;

export function isSourceLinkedLedgerEntry(entry: LedgerEntryLink): boolean {
  return entry.refType != null || entry.refId != null ||
    entry.cashMoveId != null || entry.attendanceId != null;
}

export interface EditableLedgerFields {
  entryDate: string;
  entryDirection: 'credit' | 'debit';
  entryReason: EmpLedgerEntryReason;
  amount: number;
  payrollMonth: string | null;
  notes: string | null;
}

function realDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(s + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}

/** Only standalone (source-free) entries may change their financial fields. */
export function validateEditableLedgerFields(input: Record<string, unknown>): EditableLedgerFields {
  const entryDate = String(input.entryDate ?? '').trim();
  const entryDirection = String(input.entryDirection ?? '').trim();
  const entryReason = String(input.entryReason ?? '').trim();
  const amount = Number(input.amount);
  const monthRaw = String(input.payrollMonth ?? '').trim();
  const notes = String(input.notes ?? '').trim();

  if (!realDate(entryDate)) throw new Error('تاريخ القيد غير صالح');
  if (entryDirection !== 'credit' && entryDirection !== 'debit') throw new Error('اتجاه القيد غير صالح');
  if (!EMP_LEDGER_ENTRY_REASONS.includes(entryReason as EmpLedgerEntryReason)) throw new Error('نوع القيد غير صالح');
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e10 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
    throw new Error('المبلغ لازم يكون أكبر من صفر وبحد أقصى خانتين عشريتين');
  }
  if (monthRaw && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw))) {
    throw new Error('شهر الرواتب غير صالح');
  }
  if (notes.length > 500) throw new Error('الملاحظات لا تتجاوز 500 حرف');
  return {
    entryDate,
    entryDirection: entryDirection as EditableLedgerFields['entryDirection'],
    entryReason: entryReason as EmpLedgerEntryReason,
    amount,
    payrollMonth: monthRaw || null,
    notes: notes || null,
  };
}
