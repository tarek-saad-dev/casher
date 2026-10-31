import 'server-only';

import { getPool } from '@/lib/db';
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
  buildManagerReviewNotifyMessage,
} from './messages';
import {
  findLateDeductionCase,
  isEmployeeLateDeductionExempt,
  markFinalNotified,
  upsertLateDeductionCase,
} from './repository';
import {
  calculateLateDeductionAmount,
  resolveLateDeductionBracket,
  type LateDeductionBracket,
} from './rules';
import { ensureLateDeductionSchema } from './schema';
import { scheduleLateDeductionWhatsApp } from './whatsapp';

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
  const schemaOk = await ensureLateDeductionSchema(db);
  if (!schemaOk) {
    return { handled: false, reason: 'schema_unavailable' };
  }

  const config = await getLateDeductionConfig();
  if (!isWorkDateEligibleForLateDeduction(input.workDate, config)) {
    return { handled: false, reason: 'feature_disabled_or_before_activation' };
  }

  if (!input.checkInTime || !input.scheduledStart) {
    return { handled: false, reason: 'missing_checkin_or_schedule' };
  }

  const lateMinutes = calcLateMinutes(input.checkInTime, input.scheduledStart);
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

  const exempt = await isEmployeeLateDeductionExempt(db, input.empId);
  const bracket = resolveLateDeductionBracket(lateMinutes);

  if (lateMinutes <= 0) {
    if (existing?.ledgerEntryId || existing?.attendanceId) {
      await voidLateDeductionLedgerEntry(db, {
        attendanceId: input.attendanceId,
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
      scheduleLateDeductionWhatsApp({
        empId: input.empId,
        branchId: input.branchId,
        text: buildExemptCheckInLateMessage({
          checkInTime: input.checkInTime,
          lateMinutes,
        }),
        metadata: { lateCaseId: row.caseId, event: 'exempt_checkin' },
      });
      await markFinalNotified(db, row.caseId).catch(() => undefined);
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
      scheduleLateDeductionWhatsApp({
        empId: input.empId,
        branchId: input.branchId,
        text: buildManagerReviewNotifyMessage({
          employeeName: input.empName ?? `Emp#${input.empId}`,
          workDate: input.workDate,
          lateMinutes,
          checkInTime: input.checkInTime,
        }),
        metadata: { lateCaseId: row.caseId, event: 'missing_pay_data' },
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
      scheduleLateDeductionWhatsApp({
        empId: input.empId,
        branchId: input.branchId,
        text: buildManagerReviewNotifyMessage({
          employeeName: input.empName ?? `Emp#${input.empId}`,
          workDate: input.workDate,
          lateMinutes,
          checkInTime: input.checkInTime,
        }),
        metadata: { lateCaseId: row.caseId, event: 'manager_review' },
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

  const row = await upsertLateDeductionCase(db, {
    empId: input.empId,
    branchId: input.branchId,
    workDate: input.workDate,
    attendanceId: input.attendanceId,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd ?? null,
    lateMinutes,
    deductionKind: calc.bracket,
    status: financialOk ? 'applied' : 'pending_manager',
    dailyBasePay: pay.dailyBasePay,
    amount: financialOk ? calc.amount : null,
    ledgerEntryId,
  });

  if (financialOk && !input.suppressWhatsApp && (calc.bracket === 'quarter' || calc.bracket === 'half')) {
    scheduleLateDeductionWhatsApp({
      empId: input.empId,
      branchId: input.branchId,
      text: buildFinalDeductionMessage({
        checkInTime: input.checkInTime,
        lateMinutes,
        amount: calc.amount,
        bracket: calc.bracket,
      }),
      metadata: { lateCaseId: row.caseId, event: 'final_deduction' },
    });
    await markFinalNotified(db, row.caseId).catch(() => undefined);
  }

  return {
    handled: true,
    caseId: row.caseId,
    status: financialOk ? 'applied' : 'pending_manager',
    bracket: calc.bracket,
    amount: financialOk ? calc.amount : null,
    ledgerEntryId,
    lateMinutes,
    reason: financialOk ? undefined : 'ledger_failed',
  };
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
