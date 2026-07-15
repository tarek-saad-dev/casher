import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  EMP_LEDGER_DIRECTION_CREDIT,
  EMP_LEDGER_REASON_TARGET,
  EMP_LEDGER_REF_TYPE_DAILY_TARGET,
  payrollMonthFromWorkDate,
  roundLedgerAmount,
} from './employee-daily-target-ledger.constants';
import {
  getDailyTargetById,
  getTargetPlanMeta,
  listDailyTargetsForLedgerScope,
  listOrphanTargetLedgerEntries,
  listTargetLedgerEntriesForScope,
  listTiersSnapshotForPlan,
  type TargetLedgerEntryRow,
} from './employee-daily-target-ledger.repository';
import {
  syncEmployeeDailyTargetLedgerEntry,
  EmployeeDailyTargetLedgerConflictError,
} from './employee-daily-target-ledger-sync.service';
import type {
  TargetLedgerReconcileStatus,
  TargetLedgerSyncBody,
} from './employee-daily-target-ledger.schemas';
import type { DailyTargetRow } from './employee-daily-target.repository';

export interface TargetLedgerReconcileRow {
  status: TargetLedgerReconcileStatus;
  repairable: boolean;
  dailyTargetId: number | null;
  empId: number | null;
  workDate: string | null;
  targetAmount: number | null;
  ledgerEntryId: number | null;
  ledgerAmount: number | null;
  ledgerEmpId: number | null;
  ledgerEntryDate: string | null;
  ledgerPayrollMonth: string | null;
  message: string;
}

export interface TargetLedgerReconcileResult {
  scope: {
    workDate?: string;
    year?: number;
    month?: number;
    empIds: number[] | null;
    dryRun: boolean;
  };
  totals: {
    checked: number;
    matched: number;
    missing: number;
    mismatched: number;
    duplicates: number;
    orphans: number;
    repairable: number;
    repaired: number;
  };
  repair: {
    inserted: number;
    updated: number;
    deleted: number;
    unchanged: number;
    skippedConflicts: number;
  };
  rows: TargetLedgerReconcileRow[];
}

function classifyAgainstLedger(
  daily: DailyTargetRow,
  ledgerRows: TargetLedgerEntryRow[],
): TargetLedgerReconcileRow {
  const amount = roundLedgerAmount(daily.targetAmount);
  const expectedMonth = payrollMonthFromWorkDate(daily.workDate);

  if (ledgerRows.length > 1) {
    return {
      status: 'duplicate_ledger_entries',
      repairable: false,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: ledgerRows[0]?.id ?? null,
      ledgerAmount: ledgerRows[0]?.amount ?? null,
      ledgerEmpId: ledgerRows[0]?.empId ?? null,
      ledgerEntryDate: ledgerRows[0]?.entryDate ?? null,
      ledgerPayrollMonth: ledgerRows[0]?.payrollMonth ?? null,
      message: `تكرار ${ledgerRows.length} قيود تارجت لنفس المرجع`,
    };
  }

  const entry = ledgerRows[0];

  if (amount <= 0) {
    if (!entry) {
      return {
        status: 'matched',
        repairable: false,
        dailyTargetId: daily.id,
        empId: daily.empId,
        workDate: daily.workDate,
        targetAmount: 0,
        ledgerEntryId: null,
        ledgerAmount: null,
        ledgerEmpId: null,
        ledgerEntryDate: null,
        ledgerPayrollMonth: null,
        message: 'TargetAmount=0 ولا يوجد قيد — مطابق',
      };
    }
    return {
      status: 'extra_ledger_entry_for_zero_target',
      repairable: true,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: 0,
      ledgerEntryId: entry.id,
      ledgerAmount: entry.amount,
      ledgerEmpId: entry.empId,
      ledgerEntryDate: entry.entryDate,
      ledgerPayrollMonth: entry.payrollMonth,
      message: 'TargetAmount=0 مع وجود قيد تارجت — يجب حذف القيد',
    };
  }

  if (!entry) {
    return {
      status: 'missing_ledger_entry',
      repairable: true,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: null,
      ledgerAmount: null,
      ledgerEmpId: null,
      ledgerEntryDate: null,
      ledgerPayrollMonth: null,
      message: 'قيد التارجت غير موجود في الدفتر',
    };
  }

  if (entry.entryReason !== EMP_LEDGER_REASON_TARGET) {
    return {
      status: 'wrong_reason',
      repairable: false,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: entry.id,
      ledgerAmount: entry.amount,
      ledgerEmpId: entry.empId,
      ledgerEntryDate: entry.entryDate,
      ledgerPayrollMonth: entry.payrollMonth,
      message: `EntryReason غير متوقع: ${entry.entryReason}`,
    };
  }

  if (entry.entryDirection !== EMP_LEDGER_DIRECTION_CREDIT) {
    return {
      status: 'wrong_direction',
      repairable: false,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: entry.id,
      ledgerAmount: entry.amount,
      ledgerEmpId: entry.empId,
      ledgerEntryDate: entry.entryDate,
      ledgerPayrollMonth: entry.payrollMonth,
      message: `EntryDirection غير متوقع: ${entry.entryDirection}`,
    };
  }

  if (entry.empId !== daily.empId) {
    return {
      status: 'employee_mismatch',
      repairable: false,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: entry.id,
      ledgerAmount: entry.amount,
      ledgerEmpId: entry.empId,
      ledgerEntryDate: entry.entryDate,
      ledgerPayrollMonth: entry.payrollMonth,
      message: 'EmpID غير متطابق بين التارجت والدفتر',
    };
  }

  if (entry.entryDate !== daily.workDate) {
    return {
      status: 'date_mismatch',
      repairable: true,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: entry.id,
      ledgerAmount: entry.amount,
      ledgerEmpId: entry.empId,
      ledgerEntryDate: entry.entryDate,
      ledgerPayrollMonth: entry.payrollMonth,
      message: 'EntryDate لا يساوي WorkDate',
    };
  }

  if (entry.payrollMonth !== expectedMonth) {
    return {
      status: 'payroll_month_mismatch',
      repairable: true,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: entry.id,
      ledgerAmount: entry.amount,
      ledgerEmpId: entry.empId,
      ledgerEntryDate: entry.entryDate,
      ledgerPayrollMonth: entry.payrollMonth,
      message: 'PayrollMonth غير متطابق',
    };
  }

  if (roundLedgerAmount(entry.amount) !== amount) {
    return {
      status: 'amount_mismatch',
      repairable: true,
      dailyTargetId: daily.id,
      empId: daily.empId,
      workDate: daily.workDate,
      targetAmount: amount,
      ledgerEntryId: entry.id,
      ledgerAmount: entry.amount,
      ledgerEmpId: entry.empId,
      ledgerEntryDate: entry.entryDate,
      ledgerPayrollMonth: entry.payrollMonth,
      message: `فرق المبلغ: دفتر=${entry.amount} تارجت=${amount}`,
    };
  }

  return {
    status: 'matched',
    repairable: false,
    dailyTargetId: daily.id,
    empId: daily.empId,
    workDate: daily.workDate,
    targetAmount: amount,
    ledgerEntryId: entry.id,
    ledgerAmount: entry.amount,
    ledgerEmpId: entry.empId,
    ledgerEntryDate: entry.entryDate,
    ledgerPayrollMonth: entry.payrollMonth,
    message: 'متطابق',
  };
}

/**
 * Reconcile Daily Targets with ledger. dryRun=true is SELECT-only.
 * Does not auto-fix duplicate/orphan rows.
 */
export async function reconcileEmployeeDailyTargetLedger(
  body: TargetLedgerSyncBody,
  actorUserId: number | null,
): Promise<TargetLedgerReconcileResult> {
  const scope = {
    workDate: body.workDate,
    year: body.year,
    month: body.month,
    empIds: body.empIds ?? null,
    dryRun: body.dryRun,
  };

  const dailyRows = await listDailyTargetsForLedgerScope({
    workDate: body.workDate,
    year: body.year,
    month: body.month,
    empIds: body.empIds,
  });

  const ledgerRows = await listTargetLedgerEntriesForScope({
    workDate: body.workDate,
    year: body.year,
    month: body.month,
    empIds: body.empIds,
  });

  const byRef = new Map<number, TargetLedgerEntryRow[]>();
  for (const row of ledgerRows) {
    if (row.refId == null) continue;
    const list = byRef.get(row.refId) ?? [];
    list.push(row);
    byRef.set(row.refId, list);
  }

  const rows: TargetLedgerReconcileRow[] = [];
  for (const daily of dailyRows) {
    rows.push(classifyAgainstLedger(daily, byRef.get(daily.id) ?? []));
  }

  const orphans = await listOrphanTargetLedgerEntries({
    workDate: body.workDate,
    year: body.year,
    month: body.month,
    empIds: body.empIds,
  });
  for (const orphan of orphans) {
    rows.push({
      status: 'orphan_target_ledger_entry',
      repairable: false,
      dailyTargetId: orphan.refId,
      empId: orphan.empId,
      workDate: orphan.entryDate,
      targetAmount: null,
      ledgerEntryId: orphan.id,
      ledgerAmount: orphan.amount,
      ledgerEmpId: orphan.empId,
      ledgerEntryDate: orphan.entryDate,
      ledgerPayrollMonth: orphan.payrollMonth,
      message: `قيد يتيم: لا يوجد TblEmpDailyTarget #${orphan.refId}`,
    });
  }

  const totals = {
    checked: dailyRows.length + orphans.length,
    matched: rows.filter((r) => r.status === 'matched').length,
    missing: rows.filter((r) => r.status === 'missing_ledger_entry').length,
    mismatched: rows.filter((r) =>
      [
        'amount_mismatch',
        'employee_mismatch',
        'date_mismatch',
        'payroll_month_mismatch',
        'wrong_direction',
        'wrong_reason',
        'extra_ledger_entry_for_zero_target',
      ].includes(r.status),
    ).length,
    duplicates: rows.filter((r) => r.status === 'duplicate_ledger_entries').length,
    orphans: orphans.length,
    repairable: rows.filter((r) => r.repairable).length,
    repaired: 0,
  };

  const repair = {
    inserted: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skippedConflicts: 0,
  };

  if (!body.dryRun) {
    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();
    try {
      for (const daily of dailyRows) {
        const classification = classifyAgainstLedger(daily, byRef.get(daily.id) ?? []);
        if (!classification.repairable) {
          if (
            classification.status === 'duplicate_ledger_entries' ||
            classification.status === 'wrong_direction' ||
            classification.status === 'wrong_reason' ||
            classification.status === 'employee_mismatch'
          ) {
            repair.skippedConflicts += 1;
          }
          continue;
        }
        try {
          const outcome = await syncEmployeeDailyTargetLedgerEntry({
            dailyTarget: daily,
            actorUserId,
            transaction,
          });
          if (outcome.action === 'inserted') repair.inserted += 1;
          else if (outcome.action === 'updated') repair.updated += 1;
          else if (outcome.action === 'deleted') repair.deleted += 1;
          else repair.unchanged += 1;
          totals.repaired += 1;
        } catch (e) {
          if (e instanceof EmployeeDailyTargetLedgerConflictError) {
            repair.skippedConflicts += 1;
          } else {
            throw e;
          }
        }
      }
      await transaction.commit();
    } catch (err) {
      try {
        await transaction.rollback();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  return { scope, totals, repair, rows };
}

export interface DailyTargetLedgerDetails {
  dailyTarget: DailyTargetRow & {
    empName: string;
    inputBasis: string | null;
    conversionDays: number | null;
  };
  tiers: Array<{
    sortOrder: number;
    inputStartAmount: number;
    dailyStartAmount: number;
    ratePercent: number;
  }>;
  ledger: TargetLedgerEntryRow | null;
  match: {
    status: TargetLedgerReconcileStatus;
    message: string;
  };
  sourceSync: {
    status: 'up_to_date' | 'pending' | 'processing' | 'failed';
    message: string;
    lastErrorSafe: string | null;
  };
}

export async function getDailyTargetLedgerDetails(
  dailyTargetId: number,
): Promise<DailyTargetLedgerDetails | null> {
  const daily = await getDailyTargetById(dailyTargetId);
  if (!daily) return null;

  const db = await getPool();
  const empRes = await db
    .request()
    .input('empId', sql.Int, daily.empId)
    .query(`SELECT EmpName FROM dbo.TblEmp WHERE EmpID = @empId`);
  const empName = String((empRes.recordset[0] as { EmpName?: string } | undefined)?.EmpName ?? '');

  const planMeta = await getTargetPlanMeta(daily.targetPlanId);
  const tiers = await listTiersSnapshotForPlan(daily.targetPlanId);

  const ledgerRes = await db
    .request()
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_TARGET)
    .input('refId', sql.Int, daily.id)
    .input('reason', sql.NVarChar(40), EMP_LEDGER_REASON_TARGET)
    .query(`
      SELECT
        ID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, Notes,
        IsVoided, CreatedByUserID, CreatedAt, UpdatedAt
      FROM dbo.TblEmpLedgerEntry
      WHERE RefType = @refType AND RefID = @refId AND EntryReason = @reason
      ORDER BY ID
    `);

  const ledgerMapped = (ledgerRes.recordset as Record<string, unknown>[]).map((row) => ({
    id: Number(row.ID),
    empId: Number(row.EmpID),
    entryDate:
      row.EntryDate instanceof Date
        ? row.EntryDate.toISOString().slice(0, 10)
        : String(row.EntryDate ?? '').slice(0, 10),
    entryDirection: String(row.EntryDirection),
    entryReason: String(row.EntryReason),
    amount: Number(row.Amount),
    payrollMonth: row.PayrollMonth == null ? null : String(row.PayrollMonth),
    refType: row.RefType == null ? null : String(row.RefType),
    refId: row.RefID == null ? null : Number(row.RefID),
    cashMoveId: row.CashMoveID == null ? null : Number(row.CashMoveID),
    notes: row.Notes == null ? null : String(row.Notes),
    isVoided: Boolean(row.IsVoided),
    createdByUserId: row.CreatedByUserID == null ? null : Number(row.CreatedByUserID),
    createdAt: String(row.CreatedAt ?? ''),
    updatedAt: row.UpdatedAt == null ? null : String(row.UpdatedAt),
  }));

  const classification = classifyAgainstLedger(daily, ledgerMapped);

  let sourceSync: DailyTargetLedgerDetails['sourceSync'] = {
    status: 'up_to_date',
    message: 'المبيعات والتارجت محدثان',
    lastErrorSafe: null,
  };
  try {
    const { listTargetRecalcRequestsForDate } = await import(
      './employee-target-recalc.repository'
    );
    const { deriveTargetSyncStatus } = await import('./employee-daily-target-query.service');
    const reqs = await listTargetRecalcRequestsForDate(daily.workDate, [daily.empId]);
    const sync = deriveTargetSyncStatus(reqs[0] ?? null);
    if (sync.syncStatus === 'pending') {
      sourceSync = {
        status: 'pending',
        message: 'يوجد طلب إعادة حساب Pending',
        lastErrorSafe: null,
      };
    } else if (sync.syncStatus === 'processing') {
      sourceSync = {
        status: 'processing',
        message: 'جاري تحديث التارجت من المبيعات',
        lastErrorSafe: null,
      };
    } else if (sync.syncStatus === 'failed') {
      sourceSync = {
        status: 'failed',
        message: 'آخر محاولة تحديث فشلت',
        lastErrorSafe: sync.syncLastErrorSafe,
      };
    }
  } catch {
    /* table may be missing before migration — keep up_to_date */
  }

  return {
    dailyTarget: {
      ...daily,
      empName,
      inputBasis: planMeta?.inputBasis ?? null,
      conversionDays: planMeta?.conversionDays ?? null,
    },
    tiers,
    ledger: ledgerMapped[0] ?? null,
    match: { status: classification.status, message: classification.message },
    sourceSync,
  };
}
