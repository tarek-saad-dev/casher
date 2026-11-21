import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseReferralRewardVoucherId,
  priceReferralRewardVoucher,
  ReferralCheckoutError,
} from '@/lib/referrals/referralCheckoutPolicy';

beforeEach(() => {
  process.env.POS_REFERRAL_CHECKOUT_ENABLED = 'true';
  process.env.POS_REFERRAL_REDEEM_ENABLED = 'true';
});
afterEach(() => {
  delete process.env.POS_REFERRAL_CHECKOUT_ENABLED;
  delete process.env.POS_REFERRAL_REDEEM_ENABLED;
});

describe('20% wallet checkout policy (#231)', () => {
  it('is OFF by default with an explicit error instead of silently charging full price', () => {
    delete process.env.POS_REFERRAL_REDEEM_ENABLED;
    expect(parseReferralRewardVoucherId(undefined, null)).toBeNull();
    expect(() => parseReferralRewardVoucherId(51, null)).toThrowError(
      expect.objectContaining({ code: 'REFERRALS_DISABLED' }),
    );
  });

  it('requires BOTH server flags, refuses combining first-visit and referral reward', () => {
    delete process.env.POS_REFERRAL_CHECKOUT_ENABLED;
    expect(() => parseReferralRewardVoucherId(51, null)).toThrowError(
      expect.objectContaining({ code: 'REFERRALS_DISABLED' }),
    );
    process.env.POS_REFERRAL_CHECKOUT_ENABLED = 'true';
    expect(() => parseReferralRewardVoucherId(51, 'CUT-ABCDEF0123456789ABCDEF01')).toThrowError(
      expect.objectContaining({ code: 'REFERRAL_DISCOUNT_CONFLICT' }),
    );
  });

  it('accepts safe numeric voucher ids and rejects injected/unsafe ids', () => {
    expect(parseReferralRewardVoucherId(51, null)).toBe(51);
    expect(parseReferralRewardVoucherId('51', null)).toBe(51);
    for (const bad of [0, -1, '', ' ', '1;drop', '1e3', '1.5', 4.5, NaN, 9007199254740992, {}, true]) {
      expect(() => parseReferralRewardVoucherId(bad, null)).toThrowError(
        expect.objectContaining({ code: 'INVALID_REFERRAL_VOUCHER' }),
      );
    }
  });

  it('uses canonical server money math for 20% discount, no stacking', () => {
    const base = [{ sPrice: 100.01, qty: 1, discountPercent: 0, discountValue: 0 }];
    const priced = priceReferralRewardVoucher(base, { discountPercent: 0, discountValue: 0 });
    expect(priced.headerDiscountPercent).toBe(20);
    expect(priced.headerDiscountValue).toBe(20);
    expect(priced.grandTotal).toBe(80.01);
    expect(() => priceReferralRewardVoucher(base, { discountPercent: 10 })).toThrowError(
      expect.objectContaining({ code: 'REFERRAL_DISCOUNT_CONFLICT' }),
    );
    expect(() => priceReferralRewardVoucher([{ ...base[0], discountValue: 1 }], {})).toThrowError(
      expect.any(ReferralCheckoutError),
    );
  });
});
