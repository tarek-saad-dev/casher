import { randomBytes } from 'node:crypto';

/**
 * Issuance helper for the future paid-sale transaction.
 * 96 random bits; do not derive public codes from sequential ClientID/phone.
 * Unique (TenantId, Code) in SQL remains the final collision guard.
 */
export function generateReferralCustomerCode(): string {
  return `CUT-${randomBytes(12).toString('hex').toUpperCase()}`;
}

export function normalizeReferralCustomerCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^CUT-[0-9A-F]{24}$/.test(code) ? code : null;
}

export function parseSqlClientId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}

export type ReferralPreviewReason =
  | 'SELF_REFERRAL'
  | 'CODE_NOT_ACTIVE'
  | 'REFERRER_NOT_ELIGIBLE'
  | 'REFERRED_ALREADY_VISITED'
  | 'ALREADY_CLAIMED';

export type ReferralPreviewFacts = {
  referrerClientId: number;
  referredClientId: number;
  activated: boolean;
  referrerHasPaidVisit: boolean;
  referredHasPaidVisit: boolean;
  referredHasClaim: boolean;
};

export function decideReferralPreview(facts: ReferralPreviewFacts): {
  eligible: boolean;
  discountPercent: 0 | 50;
  reason: ReferralPreviewReason | null;
} {
  if (facts.referrerClientId === facts.referredClientId) {
    return { eligible: false, discountPercent: 0, reason: 'SELF_REFERRAL' };
  }
  if (!facts.activated) {
    return { eligible: false, discountPercent: 0, reason: 'CODE_NOT_ACTIVE' };
  }
  if (!facts.referrerHasPaidVisit) {
    return { eligible: false, discountPercent: 0, reason: 'REFERRER_NOT_ELIGIBLE' };
  }
  if (facts.referredHasPaidVisit) {
    return { eligible: false, discountPercent: 0, reason: 'REFERRED_ALREADY_VISITED' };
  }
  if (facts.referredHasClaim) {
    return { eligible: false, discountPercent: 0, reason: 'ALREADY_CLAIMED' };
  }
  return { eligible: true, discountPercent: 50, reason: null };
}
