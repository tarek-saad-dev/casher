/**
 * Browser-only, read-only adapter for staff referral-code lookup.
 * It intentionally has no sale/discount/reward mutation API.
 * Backend contract supplied by #223 / PR #224 (not merged when this was authored).
 */
const CODE_PATTERN = /^CUT-[0-9A-F]{24}$/;

export type ReferralPreviewReason =
  | 'SELF_REFERRAL'
  | 'CODE_NOT_ACTIVE'
  | 'REFERRER_NOT_ELIGIBLE'
  | 'REFERRED_ALREADY_VISITED'
  | 'ALREADY_CLAIMED';

export type PosReferralPreviewOutcome =
  | { state: 'eligible'; reason: null; discountPercent: 50 }
  | { state: 'ineligible'; reason: ReferralPreviewReason; discountPercent: 0 }
  | { state: 'not_found' | 'not_ready' | 'unauthorized' | 'error' };

export const REFERRAL_PREVIEW_ENABLED =
  process.env.NEXT_PUBLIC_POS_REFERRAL_PREVIEW_ENABLED === 'true';

export function normalizePosReferralCode(raw: string): string | null {
  const candidate = raw.trim().toUpperCase();
  return CODE_PATTERN.test(candidate) ? candidate : null;
}

function isReason(value: unknown): value is ReferralPreviewReason {
  return (
    value === 'SELF_REFERRAL' ||
    value === 'CODE_NOT_ACTIVE' ||
    value === 'REFERRER_NOT_ELIGIBLE' ||
    value === 'REFERRED_ALREADY_VISITED' ||
    value === 'ALREADY_CLAIMED'
  );
}

export async function fetchPosReferralPreview(
  clientId: number,
  code: string,
  signal: AbortSignal,
): Promise<PosReferralPreviewOutcome> {
  const normalized = normalizePosReferralCode(code);
  if (!Number.isSafeInteger(clientId) || clientId <= 0 || clientId > 2_147_483_647 || !normalized) {
    return { state: 'error' };
  }

  const query = new URLSearchParams({
    code: normalized,
    referredClientId: String(clientId),
  });
  // Never trust or send a user-supplied tenantId.
  const response = await fetch(`/api/pos/referrals/preview?${query.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (response.status === 401 || response.status === 403) return { state: 'unauthorized' };
  if (response.status === 404) return { state: 'not_found' };
  if (response.status === 503) return { state: 'not_ready' };
  if (!response.ok) return { state: 'error' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: 'error' };
  }
  if (!body || typeof body !== 'object' || !('ok' in body) ||
    !('previewOnly' in body) || !('eligible' in body) ||
    !('discountPercent' in body) || !('reason' in body)) {
    return { state: 'error' };
  }
  const result = body as Record<string, unknown>;
  // Fail closed when response was not explicitly designated read-only.
  if (result.ok !== true || result.previewOnly !== true) return { state: 'error' };
  if (result.eligible === true && result.discountPercent === 50 && result.reason === null) {
    return { state: 'eligible', reason: null, discountPercent: 50 };
  }
  if (result.eligible === false && result.discountPercent === 0 && isReason(result.reason)) {
    return { state: 'ineligible', reason: result.reason, discountPercent: 0 };
  }
  return { state: 'error' };
}
