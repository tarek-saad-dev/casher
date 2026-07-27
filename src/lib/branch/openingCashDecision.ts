/**
 * Phase 1S — opening cash decision (ZERO or AMOUNT). Never invent GLEEM balances.
 */
import 'server-only';
import { BranchDomainError } from './types';
import {
  getBranchSetupPolicy,
  upsertBranchSetupPolicy,
  type OpeningCashDecision,
} from './branchSetupPolicy';

export async function isOpeningCashResolved(branchId: number): Promise<boolean> {
  const policy = await getBranchSetupPolicy(branchId);
  if (!policy?.openingCashDecision || !policy.openingCashApprovedAt) return false;
  if (policy.openingCashDecision === 'ZERO') return true;
  if (policy.openingCashDecision === 'AMOUNT') {
    return (
      Number(policy.openingCashAmount) > 0 &&
      !!policy.openingCashEffectiveDate &&
      !!(policy.openingCashReason && policy.openingCashReason.trim())
    );
  }
  return false;
}

export async function decideOpeningCashZero(args: {
  branchId: number;
  actorUserId: number;
  confirmZero: boolean;
}): Promise<{ policy: NonNullable<Awaited<ReturnType<typeof getBranchSetupPolicy>>>; blockerCleared: boolean }> {
  if (!args.confirmZero) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'يلزم تأكيد بدء الخزنة برصيد صفر',
      400,
    );
  }
  const policy = await upsertBranchSetupPolicy(args.branchId, {
    openingCashDecision: 'ZERO',
    openingCashAmount: 0,
    openingCashReason: 'ZERO_OPENING_CASH_CONFIRMED',
    openingCashApprovedByUserId: args.actorUserId,
    markOpeningCashApprovedNow: true,
    notes: 'Phase 1S opening cash ZERO — no CashMove created',
  });
  return { policy: policy!, blockerCleared: true };
}

export async function decideOpeningCashAmount(args: {
  branchId: number;
  actorUserId: number;
  amount: number;
  effectiveDate: string;
  reason: string;
}): Promise<{ policy: NonNullable<Awaited<ReturnType<typeof getBranchSetupPolicy>>>; blockerCleared: boolean }> {
  const amount = Number(args.amount);
  if (!(amount > 0)) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'مبلغ الرصيد الافتتاحي يجب أن يكون أكبر من صفر', 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveDate)) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تاريخ السريان غير صالح', 400);
  }
  const reason = String(args.reason || '').trim();
  if (reason.length < 3) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'سبب الرصيد الافتتاحي مطلوب', 400);
  }

  // Persist audited decision. Dedicated opening CashMove service is not present —
  // do not invent a sales income row. Policy approval clears readiness.
  const policy = await upsertBranchSetupPolicy(args.branchId, {
    openingCashDecision: 'AMOUNT',
    openingCashAmount: amount,
    openingCashEffectiveDate: args.effectiveDate,
    openingCashReason: reason,
    openingCashApprovedByUserId: args.actorUserId,
    markOpeningCashApprovedNow: true,
    notes: `Phase 1S opening cash AMOUNT=${amount} effective=${args.effectiveDate}`,
  });
  return { policy: policy!, blockerCleared: true };
}

export type { OpeningCashDecision };
