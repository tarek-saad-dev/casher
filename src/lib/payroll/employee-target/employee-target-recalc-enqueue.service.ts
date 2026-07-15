import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  dedupeTargetRecalcScopes,
  type TargetRecalcScope,
} from './employee-target-recalc-scope';
import { enqueueTargetRecalcInTransaction } from './employee-target-recalc.repository';
import { assertValidWorkDate, EmployeeTargetValidationError } from './target.validation';

export interface EnqueueResultItem {
  empId: number;
  workDate: string;
  requestId: number;
  requestedVersion: number;
  created: boolean;
}

/**
 * Upsert one recalc request inside an existing invoice (or other) transaction.
 */
export async function enqueueEmployeeTargetRecalculation(params: {
  transaction: sql.Transaction;
  empId: number;
  workDate: string;
  reason: string;
  sourceType?: string | null;
  sourceRef?: string | null;
}): Promise<EnqueueResultItem> {
  assertValidWorkDate(params.workDate);
  if (!Number.isInteger(params.empId) || params.empId <= 0) {
    throw new EmployeeTargetValidationError('EmpID غير صالح');
  }
  const r = await enqueueTargetRecalcInTransaction(params.transaction, {
    empId: params.empId,
    workDate: params.workDate,
    reason: params.reason || 'recalc',
    sourceType: params.sourceType ?? null,
    sourceRef: params.sourceRef ?? null,
  });
  return {
    empId: params.empId,
    workDate: params.workDate,
    requestId: r.id,
    requestedVersion: r.requestedVersion,
    created: r.created,
  };
}

/**
 * Batch enqueue — dedupe + stable sort (WorkDate, EmpID) to reduce deadlocks.
 */
export async function enqueueEmployeeTargetRecalculations(params: {
  transaction: sql.Transaction;
  scopes: TargetRecalcScope[];
  reason?: string;
  sourceType?: string | null;
  sourceRef?: string | null;
}): Promise<EnqueueResultItem[]> {
  const scopes = dedupeTargetRecalcScopes(params.scopes);
  const out: EnqueueResultItem[] = [];
  for (const scope of scopes) {
    const reason =
      params.reason ||
      (scope.reasons[0] ? scope.reasons.slice(0, 3).join(',') : 'invoice_mutation');
    out.push(
      await enqueueEmployeeTargetRecalculation({
        transaction: params.transaction,
        empId: scope.empId,
        workDate: scope.workDate,
        reason: reason.slice(0, 100),
        sourceType: params.sourceType,
        sourceRef: params.sourceRef,
      }),
    );
  }
  return out;
}

/** Manual/day enqueue without a caller transaction. */
export async function enqueueEmployeeTargetRecalculationsStandalone(params: {
  scopes: TargetRecalcScope[];
  reason?: string;
  sourceType?: string | null;
  sourceRef?: string | null;
}): Promise<EnqueueResultItem[]> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();
  try {
    const items = await enqueueEmployeeTargetRecalculations({
      transaction,
      scopes: params.scopes,
      reason: params.reason,
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
    });
    await transaction.commit();
    return items;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
