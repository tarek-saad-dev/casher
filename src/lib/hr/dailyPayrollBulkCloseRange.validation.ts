/**
 * Pure validation + date helpers for bulk date-range payroll close.
 * No DB / payroll formulas — safe to unit-test in isolation.
 */

import { getCairoBusinessDate } from '@/lib/businessDate';

export const BULK_CLOSE_RANGE_MAX_DAYS = 31;
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BulkCloseBranchOutcome =
  | 'alreadyClosed'
  | 'closed'
  | 'notReady'
  | 'failed';

export type BulkCloseRangeValidation =
  | { ok: true; fromDate: string; toDate: string; dates: string[] }
  | { ok: false; error: string };

export function listDatesInclusive(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let cur = fromDate;
  while (cur <= toDate) {
    out.push(cur);
    cur = shiftYmd(cur, 1);
  }
  return out;
}

export function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function validateBulkCloseRangeParams(input: {
  fromDate: unknown;
  toDate: unknown;
  /** Override “today” for tests (Cairo business date). */
  todayCairo?: string;
}): BulkCloseRangeValidation {
  const fromDate = String(input.fromDate ?? '').trim();
  const toDate = String(input.toDate ?? '').trim();

  if (!YMD_RE.test(fromDate) || !YMD_RE.test(toDate)) {
    return { ok: false, error: 'fromDate و toDate مطلوبان بصيغة YYYY-MM-DD' };
  }
  if (fromDate > toDate) {
    return { ok: false, error: 'fromDate يجب أن يكون قبل أو يساوي toDate' };
  }

  const dates = listDatesInclusive(fromDate, toDate);
  if (dates.length > BULK_CLOSE_RANGE_MAX_DAYS) {
    return {
      ok: false,
      error: `الحد الأقصى للرينج ${BULK_CLOSE_RANGE_MAX_DAYS} يومًا (المطلوب ${dates.length})`,
    };
  }

  const today = input.todayCairo ?? getCairoBusinessDate();
  if (toDate > today) {
    return {
      ok: false,
      error: `لا يمكن قفل تاريخ مستقبلي — آخر يوم مسموح ${today}`,
    };
  }

  return { ok: true, fromDate, toDate, dates };
}

/** Process-level lock: only one bulk-close-range at a time in this Node process. */
let bulkCloseRangeInFlightKey: string | null = null;

export function bulkCloseRangeLockKey(fromDate: string, toDate: string): string {
  return `${fromDate}:${toDate}`;
}

export function tryAcquireBulkCloseRangeLock(key: string): boolean {
  if (bulkCloseRangeInFlightKey != null) return false;
  bulkCloseRangeInFlightKey = key;
  return true;
}

export function releaseBulkCloseRangeLock(key: string): void {
  if (bulkCloseRangeInFlightKey === key) {
    bulkCloseRangeInFlightKey = null;
  }
}

/** Test-only reset. */
export function __resetBulkCloseRangeLockForTests(): void {
  bulkCloseRangeInFlightKey = null;
}

export function summarizeBulkCloseBranchOutcomes(
  outcomes: Array<{ outcome: BulkCloseBranchOutcome }>,
): {
  branchesProcessed: number;
  closed: number;
  alreadyClosed: number;
  notReady: number;
  failed: number;
} {
  const summary = {
    branchesProcessed: outcomes.length,
    closed: 0,
    alreadyClosed: 0,
    notReady: 0,
    failed: 0,
  };
  for (const row of outcomes) {
    if (row.outcome === 'closed') summary.closed += 1;
    else if (row.outcome === 'alreadyClosed') summary.alreadyClosed += 1;
    else if (row.outcome === 'notReady') summary.notReady += 1;
    else summary.failed += 1;
  }
  return summary;
}
