/**
 * CUT Salon referral promotion — pure business-policy checks.
 *
 * IMPORTANT: these checks do NOT establish customer identity, prove invoice state,
 * or reserve a code. Callers must load all facts from the tenant-scoped database,
 * lock the one-time claim, and enforce issuance/redemption in the sale transaction.
 * Do not wire this module to public query-param client IDs.
 */
export const REFERRAL_PROMOTION = {
  referredFirstVisitDiscountPercent: 50,
  referrerVoucherDiscountPercent: 20,
} as const;

export type ReferralCheckoutInput = {
  referrerClientId: number;
  referredClientId: number;
  referrerHasCompletedPaidVisit: boolean;
  referredHasCompletedPaidVisit: boolean;
  referralClaimExists: boolean;
};

export type ReferralCheckoutDenial =
  | 'INVALID_CLIENT_ID'
  | 'SELF_REFERRAL'
  | 'REFERRER_NOT_ACTIVE'
  | 'REFERRED_ALREADY_VISITED'
  | 'REFERRAL_ALREADY_CLAIMED';

export type ReferralCheckoutDecision =
  | { eligible: true; discountPercent: typeof REFERRAL_PROMOTION.referredFirstVisitDiscountPercent }
  | { eligible: false; reason: ReferralCheckoutDenial };

function isValidClientId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

/**
 * Evaluate the candidate referral before taking payment.
 * "Completed paid visit" must be determined by the backend from committed invoices.
 */
export function evaluateReferralAtCheckout(input: ReferralCheckoutInput): ReferralCheckoutDecision {
  if (!isValidClientId(input.referrerClientId) || !isValidClientId(input.referredClientId)) {
    return { eligible: false, reason: 'INVALID_CLIENT_ID' };
  }
  if (input.referrerClientId === input.referredClientId) {
    return { eligible: false, reason: 'SELF_REFERRAL' };
  }
  if (!input.referrerHasCompletedPaidVisit) {
    return { eligible: false, reason: 'REFERRER_NOT_ACTIVE' };
  }
  if (input.referredHasCompletedPaidVisit) {
    return { eligible: false, reason: 'REFERRED_ALREADY_VISITED' };
  }
  if (input.referralClaimExists) {
    return { eligible: false, reason: 'REFERRAL_ALREADY_CLAIMED' };
  }
  return {
    eligible: true,
    discountPercent: REFERRAL_PROMOTION.referredFirstVisitDiscountPercent,
  };
}

/**
 * All money input/output is in integer minor units (e.g. piasters).
 * 50% rounds a half-minor-unit UP; the monetary rules must be consistent
 * with the server-side invoice totals calculation.
 */
export function calculateFirstVisitReferralDiscountMinor(eligibleBaseMinor: number): number {
  if (!Number.isSafeInteger(eligibleBaseMinor) || eligibleBaseMinor < 0) {
    throw new RangeError('eligibleBaseMinor must be a nonnegative safe integer');
  }
  return Math.round(eligibleBaseMinor / 2);
}

export type ReferrerRewardInput = {
  referralDiscountApplied: boolean;
  invoiceCommitted: boolean;
  invoicePaidInFull: boolean;
  invoiceReversed: boolean;
  rewardAlreadyIssued: boolean;
};

export type ReferrerRewardDenial =
  | 'REFERRAL_NOT_APPLIED'
  | 'INVOICE_NOT_COMMITTED'
  | 'INVOICE_NOT_PAID'
  | 'INVOICE_REVERSED'
  | 'REWARD_ALREADY_ISSUED';

export type ReferrerRewardDecision =
  | { eligible: true; voucherDiscountPercent: typeof REFERRAL_PROMOTION.referrerVoucherDiscountPercent }
  | { eligible: false; reason: ReferrerRewardDenial };

/**
 * Decision only. An actual 20% voucher must be stored exactly once for the
 * referral invoice in the SAME database transaction that finalizes payment.
 * Separate valid referrals may yield separate vouchers; no arbitrary cap.
 */
export function evaluateReferrerReward(input: ReferrerRewardInput): ReferrerRewardDecision {
  if (!input.referralDiscountApplied) {
    return { eligible: false, reason: 'REFERRAL_NOT_APPLIED' };
  }
  if (!input.invoiceCommitted) {
    return { eligible: false, reason: 'INVOICE_NOT_COMMITTED' };
  }
  if (!input.invoicePaidInFull) {
    return { eligible: false, reason: 'INVOICE_NOT_PAID' };
  }
  if (input.invoiceReversed) {
    return { eligible: false, reason: 'INVOICE_REVERSED' };
  }
  if (input.rewardAlreadyIssued) {
    return { eligible: false, reason: 'REWARD_ALREADY_ISSUED' };
  }
  return {
    eligible: true,
    voucherDiscountPercent: REFERRAL_PROMOTION.referrerVoucherDiscountPercent,
  };
}
