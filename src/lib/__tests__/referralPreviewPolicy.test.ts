import { describe, expect, it } from 'vitest';
import {
  decideReferralPreview,
  generateReferralCustomerCode,
  normalizeReferralCustomerCode,
  parseSqlClientId,
  type ReferralPreviewFacts,
} from '@/lib/referrals/referralPreviewPolicy';

const valid: ReferralPreviewFacts = {
  referrerClientId: 12,
  referredClientId: 34,
  activated: true,
  referrerHasPaidVisit: true,
  referredHasPaidVisit: false,
  referredHasClaim: false,
};

describe('referral code and eligibility policy (#223)', () => {
  it('generates high-entropy non-sequential tenant-unique-format codes', () => {
    const codes = Array.from({ length: 100 }, () => generateReferralCustomerCode());
    expect(new Set(codes).size).toBe(100);
    codes.forEach((code) => expect(code).toMatch(/^CUT-[0-9A-F]{24}$/));
  });

  it('normalizes the exact code format and rejects untrusted strings', () => {
    const code = 'cut-abcdef0123456789abcdef01';
    expect(normalizeReferralCustomerCode('  ' + code + ' ')).toBe('CUT-ABCDEF0123456789ABCDEF01');
    for (const bad of ['', 'CUT-123', 'CUT-ABCDEF0123456789ABCDEFGHIJ', 'CUT-123 OR 1=1', 123, null]) {
      expect(normalizeReferralCustomerCode(bad)).toBeNull();
    }
  });

  it('does not parse phone-sized, fractional, negative or truncated IDs into SQL int', () => {
    expect(parseSqlClientId('42')).toBe(42);
    for (const value of ['01012345678', '2147483648', '2.5', '2abc', '-1', '0', ' 2', null, '']) {
      expect(parseSqlClientId(value)).toBeNull();
    }
  });

  it('returns 50% for eligible new customer preview, not a financial approval', () => {
    expect(decideReferralPreview(valid)).toEqual({
      eligible: true, discountPercent: 50, reason: null,
    });
  });

  it.each([
    [{ referredClientId: 12 }, 'SELF_REFERRAL'],
    [{ activated: false }, 'CODE_NOT_ACTIVE'],
    [{ referrerHasPaidVisit: false }, 'REFERRER_NOT_ELIGIBLE'],
    [{ referredHasPaidVisit: true }, 'REFERRED_ALREADY_VISITED'],
    [{ referredHasClaim: true }, 'ALREADY_CLAIMED'],
  ] as const)('denies %s', (patch, reason) => {
    expect(decideReferralPreview({ ...valid, ...patch })).toMatchObject({
      eligible: false, discountPercent: 0, reason,
    });
  });
});
