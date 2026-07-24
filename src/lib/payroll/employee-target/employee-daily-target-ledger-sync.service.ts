import 'server-only';

import { sql } from '@/lib/db';
import type { DailyTargetRow } from './employee-daily-target.repository';
import {
  EMP_LEDGER_DIRECTION_CREDIT,
  EMP_LEDGER_REASON_TARGET,
  EMP_LEDGER_REF_TYPE_DAILY_TARGET,
  buildDailyTargetLedgerNote,
  payrollMonthFromWorkDate,
  roundLedgerAmount,
} from './employee-daily-target-ledger.constants';
import {
  deleteTargetLedgerEntry,
  insertTargetLedgerEntry,
  isUniqueConstraintError,
  lockTargetLedgerEntriesForRef,
  updateTargetLedgerEntry,
  type TargetLedgerEntryRow,
} from './employee-daily-target-ledger.repository';
import type { TargetLedgerSyncAction } from './employee-daily-target-ledger.schemas';

export class EmployeeDailyTargetLedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeDailyTargetLedgerConflictError';
  }
}

export interface SyncEmployeeDailyTargetLedgerParams {
  dailyTarget: Pick<DailyTargetRow, 'id' | 'empId' | 'branchId' | 'workDate' | 'targetAmount'>;
  actorUserId: number | null;
  transaction: sql.Transaction;
}

export interface SyncEmployeeDailyTargetLedgerResult {
  action: TargetLedgerSyncAction;
  ledgerEntryId: number | null;
  amount: number;
}

function assertHealthyTargetEntry(
  entry: TargetLedgerEntryRow,
  dailyTarget: SyncEmployeeDailyTargetLedgerParams['dailyTarget'],
): void {
  if (entry.refType !== EMP_LEDGER_REF_TYPE_DAILY_TARGET) {
    throw new EmployeeDailyTargetLedgerConflictError(
      `قيد دفتر يشير لمرجع غير متوقع (#${entry.id}) — يحتاج مراجعة يدوية`,
    );
  }
  if (entry.entryReason !== EMP_LEDGER_REASON_TARGET) {
    throw new EmployeeDailyTargetLedgerConflictError(
      `قيد الدفتر #${entry.id} ليس EntryReason=target — لن يُعدَّل بصمت`,
    );
  }
  if (entry.entryDirection !== EMP_LEDGER_DIRECTION_CREDIT) {
    throw new EmployeeDailyTargetLedgerConflictError(
      `قيد التارجت #${entry.id} اتجاهه ليس credit — يحتاج مراجعة يدوية`,
    );
  }
  if (entry.empId !== dailyTarget.empId) {
    throw new EmployeeDailyTargetLedgerConflictError(
      `قيد التارجت #${entry.id} مربوط بموظف مختلف عن TblEmpDailyTarget — يحتاج مراجعة يدوية`,
    );
  }
  if (entry.isVoided) {
    throw new EmployeeDailyTargetLedgerConflictError(
      `قيد التارجت #${entry.id} ملغى (IsVoided) — يحتاج مراجعة يدوية قبل إعادة المزامنة`,
    );
  }
}

function fieldsMatch(
  entry: TargetLedgerEntryRow,
  dailyTarget: SyncEmployeeDailyTargetLedgerParams['dailyTarget'],
  amount: number,
): boolean {
  return (
    entry.empId === dailyTarget.empId &&
    entry.entryDate === dailyTarget.workDate &&
    roundLedgerAmount(entry.amount) === amount &&
    entry.payrollMonth === payrollMonthFromWorkDate(dailyTarget.workDate) &&
    entry.notes === buildDailyTargetLedgerNote(dailyTarget.workDate) &&
    entry.cashMoveId == null &&
    entry.entryDirection === EMP_LEDGER_DIRECTION_CREDIT &&
    entry.entryReason === EMP_LEDGER_REASON_TARGET
  );
}

/**
 * Sync one daily-target row to a single credit `target` ledger entry.
 * Must run inside the same transaction as the TblEmpDailyTarget upsert.
 * No MERGE. No CashMove. Never touches payroll/salary ledger rows.
 */
export async function syncEmployeeDailyTargetLedgerEntry(
  params: SyncEmployeeDailyTargetLedgerParams,
): Promise<SyncEmployeeDailyTargetLedgerResult> {
  const { dailyTarget, actorUserId, transaction } = params;
  const amount = roundLedgerAmount(dailyTarget.targetAmount);

  const locked = await lockTargetLedgerEntriesForRef(transaction, dailyTarget.id);

  if (locked.length > 1) {
    throw new EmployeeDailyTargetLedgerConflictError(
      `تكرار قيود تارجت لنفس المرجع TblEmpDailyTarget #${dailyTarget.id} — راجع الدفتر يدويًا`,
    );
  }

  const existing = locked[0];

  // Zero target: delete linked entry only
  if (amount <= 0) {
    if (!existing) {
      return { action: 'noop', ledgerEntryId: null, amount: 0 };
    }
    assertHealthyTargetEntry(existing, dailyTarget);
    await deleteTargetLedgerEntry(transaction, existing.id);
    return { action: 'deleted', ledgerEntryId: null, amount: 0 };
  }

  if (existing) {
    assertHealthyTargetEntry(existing, dailyTarget);
    if (fieldsMatch(existing, dailyTarget, amount)) {
      return { action: 'unchanged', ledgerEntryId: existing.id, amount };
    }
    await updateTargetLedgerEntry(transaction, {
      ledgerEntryId: existing.id,
      empId: dailyTarget.empId,
      workDate: dailyTarget.workDate,
      amount,
    });
    return { action: 'updated', ledgerEntryId: existing.id, amount };
  }

  try {
    const id = await insertTargetLedgerEntry(transaction, {
      empId: dailyTarget.empId,
      branchId: dailyTarget.branchId,
      workDate: dailyTarget.workDate,
      amount,
      dailyTargetId: dailyTarget.id,
      actorUserId,
    });
    return { action: 'inserted', ledgerEntryId: id, amount };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;

    // Race: another TX inserted — re-lock and update safely
    const again = await lockTargetLedgerEntriesForRef(transaction, dailyTarget.id);
    if (again.length !== 1) {
      throw new EmployeeDailyTargetLedgerConflictError(
        `تعارض تزامن عند إنشاء قيد التارجت لـ TblEmpDailyTarget #${dailyTarget.id}`,
      );
    }
    const raced = again[0]!;
    assertHealthyTargetEntry(raced, dailyTarget);
    if (fieldsMatch(raced, dailyTarget, amount)) {
      return { action: 'unchanged', ledgerEntryId: raced.id, amount };
    }
    await updateTargetLedgerEntry(transaction, {
      ledgerEntryId: raced.id,
      empId: dailyTarget.empId,
      workDate: dailyTarget.workDate,
      amount,
    });
    return { action: 'updated', ledgerEntryId: raced.id, amount };
  }
}
