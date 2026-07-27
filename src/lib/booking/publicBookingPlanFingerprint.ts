/**
 * Booking Phase 5 — deterministic plan fingerprint + short-lived signed plan token.
 *
 * Fingerprint/token is NOT a reservation and NOT authorization.
 * Create (Phase 6) must revalidate under lock.
 */
import 'server-only';
import crypto from 'crypto';
import { getSessionSecretForTests } from '@/lib/session';

export const BOOKING_PLAN_CONTRACT_VERSION = 'booking-plan-v1';
/** Soft hint for clients; create must still revalidate. */
export const PLAN_TOKEN_TTL_SECONDS = 5 * 60;

export type PlanFingerprintInput = {
  contractVersion: string;
  branchCode: string;
  serviceIds: number[];
  mode: 'specific_barber' | 'any_barber';
  empId: number | null;
  workDate: string;
  time: string;
  dayOffset: 0 | 1;
  totalDurationMinutes: number;
  subtotal: number;
};

function canonicalPayload(input: PlanFingerprintInput): string {
  return JSON.stringify({
    v: input.contractVersion,
    branchCode: input.branchCode,
    serviceIds: [...input.serviceIds],
    mode: input.mode,
    empId: input.empId,
    workDate: input.workDate,
    time: input.time,
    dayOffset: input.dayOffset,
    totalDurationMinutes: input.totalDurationMinutes,
    subtotal: input.subtotal,
  });
}

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Deterministic content attestation (HMAC of canonical fields, no wall-clock).
 * Signed with SESSION_SECRET so clients cannot forge an equivalent digest without the secret.
 * Still NOT proof the slot remains free.
 */
export function buildPlanContentDigest(
  input: PlanFingerprintInput,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = getSessionSecretForTests(env);
  return hmac(canonicalPayload(input), secret);
}

export type SignedPlanToken = {
  /** Deterministic HMAC digest of canonical plan fields. */
  planFingerprint: string;
  /** Short-lived signed token embedding fingerprint + expiry (Phase 6 create). */
  planToken: string;
  expiresAt: string;
};

/**
 * Mint fingerprint + short-lived signed token using existing SESSION_SECRET.
 * Does not introduce a new secret.
 */
export function mintPlanFingerprint(
  input: PlanFingerprintInput,
  evaluatedAt: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): SignedPlanToken {
  const secret = getSessionSecretForTests(env);
  const planFingerprint = buildPlanContentDigest(input, env);
  const exp = Math.floor(nowMs / 1000) + PLAN_TOKEN_TTL_SECONDS;
  const body = {
    fingerprint: planFingerprint,
    contractVersion: input.contractVersion,
    branchCode: input.branchCode,
    serviceIds: [...input.serviceIds],
    mode: input.mode,
    empId: input.empId,
    workDate: input.workDate,
    time: input.time,
    dayOffset: input.dayOffset,
    totalDurationMinutes: input.totalDurationMinutes,
    subtotal: input.subtotal,
    evaluatedAt,
    exp,
  };
  const json = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = hmac(json, secret);
  return {
    planFingerprint,
    planToken: `${json}.${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type VerifyPlanTokenResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'invalid' | 'tampered' | 'expired' };

/** Verify signed plan token — for Phase 6 create; still must revalidate availability. */
export function verifyPlanToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyPlanTokenResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'invalid' };
  const [json, sig] = parts;
  const secret = getSessionSecretForTests(env);
  if (hmac(json, secret) !== sig) return { ok: false, reason: 'tampered' };
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp) || exp < nowSec) return { ok: false, reason: 'expired' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
