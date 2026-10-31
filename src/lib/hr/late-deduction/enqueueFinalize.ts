import 'server-only';

import { getPool } from '@/lib/db';
import { calcLateMinutes } from '@/lib/timeUtils';
import {
  getLateDeductionConfig,
  isWorkDateEligibleForLateDeduction,
} from './config';
import { findLateDeductionCase, upsertLateDeductionCase } from './repository';
import { isLateDeductionSchemaReady } from './schema';

export interface EnqueueLateDeductionFinalizeInput {
  empId: number;
  branchId: number;
  workDate: string;
  attendanceId: number;
  checkInTime: string;
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
}

/**
 * Durable handoff: persist finalize_pending BEFORE returning from attendance write.
 * Background finalize + minute recovery worker complete the ledger work.
 */
export async function enqueueLateDeductionFinalize(
  input: EnqueueLateDeductionFinalizeInput,
): Promise<{ enqueued: boolean; caseId?: number; reason?: string }> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    return { enqueued: false, reason: 'schema_unavailable' };
  }

  const config = await getLateDeductionConfig();
  if (!isWorkDateEligibleForLateDeduction(input.workDate, config)) {
    return { enqueued: false, reason: 'feature_disabled_or_before_activation' };
  }
  if (!input.checkInTime || !input.scheduledStart) {
    return { enqueued: false, reason: 'missing_checkin_or_schedule' };
  }

  const existing = await findLateDeductionCase(
    db,
    input.empId,
    input.branchId,
    input.workDate,
  );
  if (existing?.doNotAutoRecreate || existing?.status === 'cancelled') {
    return { enqueued: false, caseId: existing.caseId, reason: 'cancelled_do_not_recreate' };
  }
  // Manager-approved penalties must not be silently overwritten by auto finalize.
  if (existing?.status === 'manager_applied') {
    return { enqueued: false, caseId: existing.caseId, reason: 'manager_decision_locked' };
  }

  const lateMinutes = calcLateMinutes(input.checkInTime, input.scheduledStart);
  const row = await upsertLateDeductionCase(db, {
    empId: input.empId,
    branchId: input.branchId,
    workDate: input.workDate,
    attendanceId: input.attendanceId,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd ?? null,
    lateMinutes,
    deductionKind: existing?.deductionKind ?? 'none',
    status: 'finalize_pending',
    dailyBasePay: existing?.dailyBasePay ?? null,
    amount: existing?.amount ?? null,
    ledgerEntryId: existing?.ledgerEntryId ?? null,
  });

  return { enqueued: true, caseId: row.caseId };
}
