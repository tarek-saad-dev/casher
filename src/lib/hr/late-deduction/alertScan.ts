import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  getLateDeductionConfig,
  isWorkDateEligibleForLateDeduction,
} from './config';
import { recoverPendingLateDeductionFinalizations } from './recoverFinalizations';
import { isLateDeductionSchemaReady } from './schema';

const SCAN_LOCK_RESOURCE = 'late_deduction_alert_scan';

export interface LateAlertScanResult {
  skipped?: boolean;
  reason?: string;
  workDate?: string;
  candidates: number;
  notified: number;
  errors: number;
  recoveredFinalizations?: number;
  recoveryErrors?: number;
}

async function withScanLock<T>(
  fn: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();
  try {
    const lock = await new sql.Request(transaction)
      .input('res', sql.NVarChar(128), SCAN_LOCK_RESOURCE)
      .query(`
        DECLARE @r INT;
        EXEC @r = sp_getapplock
          @Resource = @res,
          @LockMode = N'Exclusive',
          @LockOwner = N'Transaction',
          @LockTimeout = 0;
        SELECT @r AS LockResult;
      `);
    const lockResult = Number(lock.recordset[0]?.LockResult ?? -1);
    if (lockResult < 0) {
      await transaction.rollback();
      return { skipped: true, reason: 'lock_not_acquired' };
    }
    const result = await fn();
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** The old alert scanner is now recovery only; never sends pre-arrival messages. */
export async function runLateDeductionAlertScan(params?: {
  businessDate?: string;
  branchId?: number;
  now?: Date;
  /** Deprecated: retained for cron callers; no pre-check-in sends. */
  sendInline?: boolean;
}): Promise<LateAlertScanResult> {
  const locked = await withScanLock(async () => {
    const db = await getPool();
    const schemaOk = await isLateDeductionSchemaReady(db);
    if (!schemaOk) {
      return {
        candidates: 0,
        notified: 0,
        errors: 0,
        reason: 'schema_unavailable',
      } satisfies LateAlertScanResult;
    }

    const config = await getLateDeductionConfig(params?.branchId ?? 0);
    const now = params?.now ?? new Date();
    const workDate = params?.businessDate ?? getCairoBusinessDate(now);
    if (!isWorkDateEligibleForLateDeduction(workDate, config)) {
      return {
        candidates: 0,
        notified: 0,
        errors: 0,
        workDate,
        reason: 'feature_disabled_or_before_activation',
      } satisfies LateAlertScanResult;
    }

    // Recover durable finalize_pending / missed check-in finalizations first.
    const recovery = await recoverPendingLateDeductionFinalizations({
      businessDate: workDate,
      branchId: params?.branchId,
    });

    // No WhatsApp before check-in. Recovery may finalize actual ledger entries.
    return {
      candidates: 0, notified: 0, errors: 0, workDate,
      recoveredFinalizations: recovery.recovered,
      recoveryErrors: recovery.errors,
    } satisfies LateAlertScanResult;
  });

  if (locked && typeof locked === 'object' && 'skipped' in locked && locked.skipped) {
    return {
      skipped: true,
      reason: locked.reason,
      candidates: 0,
      notified: 0,
      errors: 0,
    };
  }

  return locked as LateAlertScanResult;
}
