import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { referralSalePayloadDiscount } from '@/lib/referrals/posReferralCheckoutPolicy';

const code = 'CUT-ABCDEF0123456789ABCDEF01';

describe('referral sale request and UI money safety (#229)', () => {
  it('sends explicit verified referral intent WITHOUT the manual 50% header field', () => {
    expect(referralSalePayloadDiscount({
      referralCode: code, discountPercent: 50, discountValue: 50.01,
    })).toEqual({ dis: 0, disVal: 0, referralCode: code });
  });
  it('retains normal cashiers standard discounts when no referral is applied', () => {
    expect(referralSalePayloadDiscount({
      referralCode: null, discountPercent: 12, discountValue: 24,
    })).toEqual({ dis: 12, disVal: 24 });
  });
  it('fails closed if a stale referral token is paired with wrong manual discount', () => {
    for (const state of [
      { referralCode: code, discountPercent: 10, discountValue: 50 },
      { referralCode: code, discountPercent: 50, discountValue: 0 },
      { referralCode: 'CUT-1', discountPercent: 50, discountValue: 50 },
    ]) {
      expect(() => referralSalePayloadDiscount(state)).toThrow('REFERRAL_CHECKOUT_INCONSISTENT');
    }
  });
  it('never submits applied referrals to PUT invoice edit route', () => {
    const page = readFileSync('src/app/income/pos/page.tsx', 'utf8');
    expect(page).toContain('state.referralCode && (editingSaleId !== null || !state.customer)');
    expect(page).toContain('...referralSalePayloadDiscount(state)');
    expect(page).toContain("method = isEditing ? 'PUT' : 'POST'");
  });
  it('hides legacy voucher redemption during a live referral draft', () => {
    const page = readFileSync('src/app/income/pos/page.tsx', 'utf8');
    expect(page).toContain('state.customer && !state.referralCode && (');
    expect(page).toContain('if (state.referralCode) setVouchersOpen(false)');
  });
});
