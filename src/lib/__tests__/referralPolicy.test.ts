import { describe, expect, it } from 'vitest';
import {
  REFERRAL_PROMOTION,
  calculateFirstVisitReferralDiscountMinor,
  evaluateReferralAtCheckout,
  evaluateReferrerReward,
  type ReferralCheckoutInput,
  type ReferrerRewardInput,
} from '@/lib/referrals/referralPolicy';

const checkout: ReferralCheckoutInput = {
  referrerClientId: 123,
  referredClientId: 456,
  referrerHasCompletedPaidVisit: true,
  referredHasCompletedPaidVisit: false,
  referralClaimExists: false,
};

const reward: ReferrerRewardInput = {
  referralDiscountApplied: true,
  invoicePersistedInTransaction: true,
  invoicePaidInFull: true,
  invoiceReversed: false,
  rewardAlreadyIssued: false,
};

describe('CUT Salon referral promotion rules', () => {
  it('applies the agreed first-paid-visit 50% policy', () => {
    expect(evaluateReferralAtCheckout(checkout)).toEqual({
      eligible: true,
      discountPercent: REFERRAL_PROMOTION.referredFirstVisitDiscountPercent,
    });
    expect(REFERRAL_PROMOTION.referredFirstVisitDiscountPercent).toBe(50);
  });

  it.each([
    [{ referrerClientId: 0 }, 'INVALID_CLIENT_ID'],
    [{ referrerClientId: 2_147_483_648 }, 'INVALID_CLIENT_ID'],
    [{ referredClientId: 1.2 }, 'INVALID_CLIENT_ID'],
    [{ referredClientId: 123 }, 'SELF_REFERRAL'],
    [{ referrerHasCompletedPaidVisit: false }, 'REFERRER_NOT_ACTIVE'],
    [{ referredHasCompletedPaidVisit: true }, 'REFERRED_ALREADY_VISITED'],
    [{ referralClaimExists: true }, 'REFERRAL_ALREADY_CLAIMED'],
  ] as const)('rejects an ineligible referral: %s', (change, reason) => {
    expect(evaluateReferralAtCheckout({ ...checkout, ...change })).toEqual({
      eligible: false,
      reason,
    });
  });

  it('fails closed if checkout facts are missing at runtime', () => {
    expect(evaluateReferralAtCheckout({ ...checkout, referralClaimExists: undefined as unknown as boolean }))
      .toEqual({ eligible: false, reason: 'INVALID_FACTS' });
  });

  it('calculates a discount in integer minor units with half-up rounding', () => {
    expect(calculateFirstVisitReferralDiscountMinor(0)).toBe(0);
    expect(calculateFirstVisitReferralDiscountMinor(10_000)).toBe(5_000);
    expect(calculateFirstVisitReferralDiscountMinor(101)).toBe(51);
    expect(calculateFirstVisitReferralDiscountMinor(100)).toBe(50);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.3, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid monetary base: %s',
    (value) => expect(() => calculateFirstVisitReferralDiscountMinor(value)).toThrow(RangeError),
  );

  it('issues a separate 20% voucher only for a valid paid referral invoice', () => {
    expect(evaluateReferrerReward(reward)).toEqual({
      eligible: true,
      voucherDiscountPercent: REFERRAL_PROMOTION.referrerVoucherDiscountPercent,
    });
    expect(REFERRAL_PROMOTION.referrerVoucherDiscountPercent).toBe(20);
  });

  it.each([
    [{ referralDiscountApplied: false }, 'REFERRAL_NOT_APPLIED'],
    [{ invoicePersistedInTransaction: false }, 'INVOICE_NOT_PERSISTED'],
    [{ invoicePaidInFull: false }, 'INVOICE_NOT_PAID'],
    [{ invoiceReversed: true }, 'INVOICE_REVERSED'],
    [{ rewardAlreadyIssued: true }, 'REWARD_ALREADY_ISSUED'],
  ] as const)('rejects reward issuance: %s', (change, reason) => {
    expect(evaluateReferrerReward({ ...reward, ...change })).toEqual({
      eligible: false,
      reason,
    });
  });

  it('fails closed if payment state was not established', () => {
    expect(evaluateReferrerReward({ ...reward, invoicePaidInFull: undefined as unknown as boolean }))
      .toEqual({ eligible: false, reason: 'INVALID_FACTS' });
  });

  it('does not impose a global cap on rewards from distinct qualifying referrals', () => {
    for (let i = 0; i < 10; i++) {
      expect(evaluateReferrerReward({ ...reward, rewardAlreadyIssued: false })).toMatchObject({
        eligible: true,
      });
    }
    // Exactly-once per referred invoice is a DB unique-key and transaction obligation,
    // not a counter in this pure policy.
  });
});
