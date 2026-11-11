import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ReferralCheckoutError,
  parseReferralCheckoutRequest,
  priceFirstVisitReferral,
  generatePermanentReferralCheckoutCode,
} from '@/lib/referrals/referralCheckoutPolicy';

const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const basic = [{ sPrice: 100.01, qty: 1, discountPercent: 0, discountValue: 0 }];

afterEach(() => {
  delete process.env.POS_REFERRAL_CHECKOUT_ENABLED;
});

describe('referral checkout server money and safety policy (#227)', () => {
  it('explicit referral attempts are rejected when the feature flag is OFF', () => {
    delete process.env.POS_REFERRAL_CHECKOUT_ENABLED;
    expect(parseReferralCheckoutRequest(undefined, 123)).toBeNull();
    expect(() => parseReferralCheckoutRequest(CODE, 123)).toThrowError(
      expect.objectContaining({ code: 'REFERRALS_DISABLED', status: 409 }),
    );
    expect(() => parseReferralCheckoutRequest('', 123)).toThrowError(
      expect.objectContaining({ code: 'REFERRALS_DISABLED' }),
    );
  });

  it('only accepts exact random-format codes for an identified customer', () => {
    expect(parseReferralCheckoutRequest('  ' + CODE.toLowerCase() + '  ', 123, true)).toBe(CODE);
    expect(() => parseReferralCheckoutRequest(CODE, null, true)).toThrowError(
      expect.objectContaining({ code: 'REFERRAL_CLIENT_REQUIRED' }),
    );
    for (const invalid of ['CUT-1', 'CUT-123456789012345678901234;DROP', '', '1234', 123, {}]) {
      expect(() => parseReferralCheckoutRequest(invalid, 12, true)).toThrowError(
        expect.objectContaining({ code: 'INVALID_REFERRAL_CODE' }),
      );
    }
  });

  it('calculates 50% using server invoice math including correct half-piaster rounding', () => {
    const c = priceFirstVisitReferral(basic, { discountPercent: 0, discountValue: 0 });
    expect(c.subTotal).toBe(100.01);
    expect(c.headerDiscountPercent).toBe(50);
    expect(c.headerDiscountValue).toBe(50.01);
    expect(c.grandTotal).toBe(50);
    expect(c.lineDiscountTotal).toBe(0);
    expect(c.totalDiscount).toBe(50.01);
  });

  it('forbids manual header and line discount stacking rather than double-spending', () => {
    for (const hdr of [{ discountPercent: 10 }, { discountValue: 5 }]) {
      expect(() => priceFirstVisitReferral(basic, hdr)).toThrowError(
        expect.objectContaining({ code: 'REFERRAL_DISCOUNT_CONFLICT' }),
      );
    }
    for (const item of [{ ...basic[0], discountPercent: 2 }, { ...basic[0], discountValue: 2 }]) {
      expect(() => priceFirstVisitReferral([item], {})).toThrowError(
        expect.objectContaining({ code: 'REFERRAL_DISCOUNT_CONFLICT' }),
      );
    }
  });

  it('rejects zero/inconsistent invoice inputs before any financial step', () => {
    for (const lines of [
      [],
      [{ sPrice: 0, qty: 1 }],
      [{ sPrice: 100, qty: 0 }],
      [{ sPrice: -5, qty: 1 }],
      [{ sPrice: 10, qty: 1, discountPercent: NaN }],
    ]) {
      expect(() => priceFirstVisitReferral(lines, {})).toThrowError(
        expect.any(ReferralCheckoutError),
      );
    }
  });

  it('generates a high-entropy permanent code not derived from customer IDs', () => {
    const fake = vi.fn().mockReturnValue(Buffer.from('11223344556677889900aabb', 'hex'));
    expect(generatePermanentReferralCheckoutCode(fake)).toBe('CUT-11223344556677889900AABB');
    expect(fake).toHaveBeenCalledWith(12);
  });
});
