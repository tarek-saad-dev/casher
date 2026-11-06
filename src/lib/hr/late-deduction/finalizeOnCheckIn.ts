import 'server-only';

import { getPool } from '@/lib/db';
import { withLateDeductionCaseLock } from './caseTransaction';
import { calcLateMinutes } from '@/lib/timeUtils';
import {
  getLateDeductionConfig,
  isWorkDateEligibleForLateDeduction,
} from './config';
import { resolveLateDeductionDailyBasePay } from './dailyBasePay';
import {
  upsertLateDeductionLedgerEntry,
  voidLateDeductionLedgerEntry,
} from './ledger';
import {
  buildExemptCheckInLateMessage,
  buildFinalDeductionMessage,
  buildManagerReviewEmployeeAckMessage,
} from './messages';
import {
  claimFinalNotified,
  findLateDeductionCase,
  isEmployeeLateDeductionExempt,
  releaseFinalNotified,
  upsertLateDeductionCase,
} from './repository';
import {
  calculateLateDeductionAmount,
  resolveLateDeductionBracket,
  type LateDeductionBracket,
} from './rules';
import { isLateDeductionSchemaReady } from './schema';
import { sendLateDeductionWhatsApp } from './whatsapp';

/**
 * Send at most one financial/final confirmation per case unless the amount or
 * lateness meaningfully changed (then release + re-claim for one new message).
 * Claims the persistent slot before provider accept; releases on hard failure.
 */
async function sendFinalConfirmationOnce(params: {
  db: Parameters<typeof claimFinalNotified>[0];
  caseId: number;
  empId: number;
  branchId: number;
  text: string;
  event: string;
  previousAmount?: number | null;
  previousLateMinutes?: number | null;
  nextAmount?: number | null;
  nextLateMinutes?: number | null;
  alreadyNotifiedAt?: string | null;
}): Promise<void> {
  const amountChanged =
    params.previousAmount != null &&
    params.nextAmount != null &&
    Number(params.previousAmount) !== Number(params.nextAmount);
  const lateChanged =
    params.previousLateMinutes != null &&
    params.nextLateMinutes != null &&
    Number(params.previousLateMinutes) !== Number(params.nextLateMinutes);

  if (params.alreadyNotifiedAt && (amountChanged || lateChanged)) {
    await releaseFinalNotified(params.db, params.caseId).catch(() => undefined);
  }

  const claimed = await claimFinalNotified(params.db, params.caseId);
  if (!claimed) return;

  const result = await sendLateDeductionWhatsApp({
    empId: params.empId,
    branchId: params.branchId,
    text: params.text,
    metadata: { lateCaseId: params.caseId, event: params.event },
  });
  // missing_phone / skipped: keep claim to avoid endless stale replays
  if (!result.sent && !result.skipped) {
    await releaseFinalNotified(params.db, params.caseId).catch(() => undefined);
  }
}

export interface FinalizeLateDeductionInput {
  empId: number;
  empName?: string;
  branchId: number;
  workDate: string;
  attendanceId: number;
  checkInTime: string;
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
  userId?: number | null;
  /** Skip WhatsApp (tests / dry paths). */
  suppressWhatsApp?: boolean;
}

export interface FinalizeLateDeductionResult {
  handled: boolean;
  reason?: string;
  caseId?: number;
  status?: string;
  bracket?: LateDeductionBracket;
  amount?: number | null;
  ledgerEntryId?: number | null;
  lateMinutes?: number;
}

/**
 * Apply (or update) automatic late deduction after a real check-in.
 * Safe to call repeatedly — idempotent ledger + case upsert.
 */
export async function finalizeLateDeductionOnCheckIn(
  input: FinalizeLateDeductionInput,
): Promise<FinalizeLateDeductionResult> {
  const db = await getPool();
  const schemaOk = await isLateDeductionSchemaReady(db);
  if (!schemaOk) {
    return { handled: false, reason: 'schema_unavailable' };
  }

  const config = await getLateDeductionConfig(input.branchId);
  if (!isWorkDateEligibleForLateDeduction(input.workDate, config)) {
    return { handled: false, reason: 'feature_disabled_or_before_activation' };
  }

  if (!input.checkInTime || !input.scheduledStart) {
    return { handled: false, reason: 'missing_checkin_or_schedule' };
  }

  const lateMinutes = calcLateMinutes(input.checkInTime, input.scheduledStart);
  return withLateDeductionCaseLock(input, async (db) => {
  const existing = await findLateDeductionCase(
    db,
    input.empId,
    input.branchId,
    input.workDate,
  );

  if (existing?.doNotAutoRecreate || existing?.status === 'cancelled') {
    return {
      handled: true,
      reason: 'cancelled_do_not_recreate',
      caseId: existing.caseId,
      status: existing.status,
      lateMinutes,
    };
  }
  if (existing?.status === 'manager_applied') {
    return {
      handled: true,
      reason: 'manager_decision_locked',
      caseId: existing.caseId,
      status: existing.status,
      amount: existing.amount,
      lateMinutes,
    };
  }

  const exempt = await isEmployeeLateDeductionExempt(db, input.empId);
  const bracket = resolveLateDeductionBracket(lateMinutes);

  if (lateMinutes <= 0) {
    if (existing?.ledgerEntryId || existing?.attendanceId) {
      await voidLateDeductionLedgerEntry(db, {
        attendanceId: input.attendanceId,
        branchId: input.branchId,
        voidReason: 'إلغاء خصم التأخير — لم يعد متأخراً بعد تصحيح الحضور',
      });
    }
    const row = await upsertLateDeductionCase(db, {
      empId: input.empId,
      branchId: input.branchId,
      workDate: input.workDate,
      attendanceId: input.attendanceId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd ?? null,
      lateMinutes: 0,
      deductionKind: 'none',
      status: 'skipped',
      dailyBasePay: existing?.dailyBasePay ?? null,
      amount: null,
      ledgerEntryId: null,
    });
    return {
      handled: true,
      reason: 'on_time',
      caseId: row.caseId,
      status: 'skipped',
      bracket: 'none',
      amount: null,
      lateMinutes: 0,
    };
  }

  if (exempt) {
    if (existing?.ledgerEntryId) {
      await voidLateDeductionLedgerEntry(db, {
        attendanceId: input.attendanceId,
        branchId: input.branchId,
        voidReason: 'إلغاء خصم التأخير — الموظف معفى',
      });
    }
    const row = await upsertLateDeductionCase(db, {
      empId: input.empId,
      branchId: input.branchId,
      workDate: input.workDate,
      attendanceId: input.attendanceId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd ?? null,
      lateMinutes,
      deductionKind: 'exempt',
      status: 'exempt',
      dailyBasePay: null,
      amount: null,
      ledgerEntryId: null,
    });
    if (!input.suppressWhatsApp) {
      await sendFinalConfirmationOnce({
        db,
        caseId: row.caseId,
        empId: input.empId,
        branchId: input.branchId,
        text: buildExemptCheckInLateMessage({
          checkInTime: input.checkInTime,
          lateMinutes,
        }),
        event: 'exempt_checkin',
        previousAmount: existing?.amount,
        previousLateMinutes: existing?.lateMinutes,
        nextAmount: null,
        nextLateMinutes: lateMinutes,
        alreadyNotifiedAt: existing?.notifiedFinalAt,
      });
    }
    return {
      handled: true,
      caseId: row.caseId,
      status: 'exempt',
      bracket,
      amount: null,
      lateMinutes,
    };
  }

  const pay = await resolveLateDeductionDailyBasePay({
    empId: input.empId,
    branchId: input.branchId,
    workDate: input.workDate,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
  });

  if (pay.dailyBasePay == null || !(pay.dailyBasePay > 0)) {
    if (existing?.ledgerEntryId) {
      await voidLateDeductionLedgerEntry(db, {
        attendanceId: input.attendanceId,
        branchId: input.branchId,
        voidReason: 'إلغاء خصم التأخير — بيانات الراتب/الجدول غير مكتملة',
      });
    }
    const row = await upsertLateDeductionCase(db, {
      empId: input.empId,
      branchId: input.branchId,
      workDate: input.workDate,
      attendanceId: input.attendanceId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd ?? null,
      lateMinutes,
      deductionKind: 'missing_pay_data',
      status: 'pending_manager',
      dailyBasePay: null,
      amount: null,
      ledgerEntryId: null,
    });
    if (!input.suppressWhatsApp) {
      await sendFinalConfirmationOnce({
        db,
        caseId: row.caseId,
        empId: input.empId,
        branchId: input.branchId,
        text: buildManagerReviewEmployeeAckMessage({
          checkInTime: input.checkInTime,
          lateMinutes,
        }),
        event: 'missing_pay_data',
        previousAmount: existing?.amount,
        previousLateMinutes: existing?.lateMinutes,
        nextAmount: null,
        nextLateMinutes: lateMinutes,
        alreadyNotifiedAt: existing?.notifiedFinalAt,
      });
    }
    return {
      handled: true,
      reason: pay.reason ?? 'missing_pay_data',
      caseId: row.caseId,
      status: 'pending_manager',
      bracket,
      amount: null,
      lateMinutes,
    };
  }

  if (bracket === 'manager_review') {
    if (existing?.ledgerEntryId) {
      await voidLateDeductionLedgerEntry(db, {
        attendanceId: input.attendanceId,
        branchId: input.branchId,
        voidReason: 'تحويل لقرار مدير — تجاوز 120 دقيقة',
      });
    }
    const row = await upsertLateDeductionCase(db, {
      empId: input.empId,
      branchId: input.branchId,
      workDate: input.workDate,
      attendanceId: input.attendanceId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd ?? null,
      lateMinutes,
      deductionKind: 'manager_review',
      status: 'pending_manager',
      dailyBasePay: pay.dailyBasePay,
      amount: null,
      ledgerEntryId: null,
    });
    if (!input.suppressWhatsApp) {
      await sendFinalConfirmationOnce({
        db,
        caseId: row.caseId,
        empId: input.empId,
        branchId: input.branchId,
        text: buildManagerReviewEmployeeAckMessage({
          checkInTime: input.checkInTime,
          lateMinutes,
        }),
        event: 'manager_review',
        previousAmount: existing?.amount,
        previousLateMinutes: existing?.lateMinutes,
        nextAmount: null,
        nextLateMinutes: lateMinutes,
        alreadyNotifiedAt: existing?.notifiedFinalAt,
      });
    }
    return {
      handled: true,
      caseId: row.caseId,
      status: 'pending_manager',
      bracket,
      amount: null,
      lateMinutes,
    };
  }

  const calc = calculateLateDeductionAmount({
    lateMinutes,
    dailyBasePay: pay.dailyBasePay,
  });
  if (calc.amount == null || calc.amount <= 0) {
    return { handled: false, reason: 'zero_amount', lateMinutes, bracket };
  }

  let ledgerEntryId: number | null = null;
  let financialOk = false;
  try {
    const ledger = await upsertLateDeductionLedgerEntry(db, {
      empId: input.empId,
      branchId: input.branchId,
      workDate: input.workDate,
      attendanceId: input.attendanceId,
      amount: calc.amount,
      lateMinutes,
      kind: calc.bracket,
      createdByUserId: input.userId ?? null,
    });
    ledgerEntryId = ledger.ledgerEntryId;
    financialOk = true;
  } catch (err) {
    console.error('[late-deduction] ledger upsert failed:', err);
    financialOk = false;
  }

  // Prefer finalize_pending over pending_manager on ledger failure so minute
  // recovery can retry; never invent a manager queue item for a race loser.
  const failureStatus =
    existing?.status === 'applied' ? 'applied' : 'finalize_pending';

  const row = await upsertLateDeductionCase(db, {
    empId: input.empId,
    branchId: input.branchId,
    workDate: input.workDate,
    attendanceId: input.attendanceId,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd ?? null,
    lateMinutes,
    deductionKind: calc.bracket,
    status: financialOk ? 'applied' : failureStatus,
    dailyBasePay: pay.dailyBasePay,
    amount: financialOk ? calc.amount : existing?.amount ?? null,
    ledgerEntryId,
  });

  if (financialOk && !input.suppressWhatsApp && (calc.bracket === 'quarter' || calc.bracket === 'half')) {
    await sendFinalConfirmationOnce({
      db,
      caseId: row.caseId,
      empId: input.empId,
      branchId: input.branchId,
      text: buildFinalDeductionMessage({
        checkInTime: input.checkInTime,
        lateMinutes,
        amount: calc.amount,
        bracket: calc.bracket,
      }),
      event: 'final_deduction',
      previousAmount: existing?.amount,
      previousLateMinutes: existing?.lateMinutes,
      nextAmount: calc.amount,
      nextLateMinutes: lateMinutes,
      alreadyNotifiedAt: existing?.notifiedFinalAt,
    });
  }

  return {
    handled: true,
    caseId: row.caseId,
    status: financialOk ? 'applied' : failureStatus,
    bracket: calc.bracket,
    amount: financialOk ? calc.amount : existing?.amount ?? null,
    ledgerEntryId: ledgerEntryId ?? existing?.ledgerEntryId ?? null,
    lateMinutes,
    reason: financialOk ? undefined : 'ledger_failed',
  };
  });
}

/** Fire-and-forget wrapper used from attendance writers. */
export function scheduleFinalizeLateDeductionOnCheckIn(
  input: FinalizeLateDeductionInput,
): void {
  void finalizeLateDeductionOnCheckIn(input).catch((err) => {
    console.warn(
      '[late-deduction] finalize failed (non-blocking):',
      err instanceof Error ? err.message : err,
    );
  });
}
