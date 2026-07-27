/**
 * Booking Phase 7A — signed bookingAccessToken (SESSION_SECRET HMAC).
 * Not a reservation; lookup/cancel authorization only.
 */
import 'server-only';
import crypto from 'crypto';
import { getSessionSecretForTests } from '@/lib/session';

export const BOOKING_ACCESS_CONTRACT_VERSION = 'booking-access-v1';
/** Default TTL: 30 days. Renewal = re-issue on successful lookup/create. */
export const BOOKING_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type BookingAccessTokenClaims = {
  contractVersion: string;
  bookingCode: string;
  /** SHA-256 hex of normalized phone — never raw phone. */
  phoneDigest: string;
  issuedAt: number;
  exp: number;
};

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function digestNormalizedPhone(normalizedPhone: string): string {
  return crypto.createHash('sha256').update(`p7a:${normalizedPhone}`).digest('hex');
}

export function mintBookingAccessToken(args: {
  bookingCode: string;
  normalizedPhone: string;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  ttlSeconds?: number;
}): { token: string; expiresAt: string } {
  const nowMs = args.nowMs ?? Date.now();
  const ttl = args.ttlSeconds ?? BOOKING_ACCESS_TOKEN_TTL_SECONDS;
  const secret = getSessionSecretForTests(args.env ?? process.env);
  const issuedAt = Math.floor(nowMs / 1000);
  const exp = issuedAt + ttl;
  const body: BookingAccessTokenClaims = {
    contractVersion: BOOKING_ACCESS_CONTRACT_VERSION,
    bookingCode: args.bookingCode.trim().toUpperCase(),
    phoneDigest: digestNormalizedPhone(args.normalizedPhone),
    issuedAt,
    exp,
  };
  const json = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = hmac(json, secret);
  return {
    token: `${json}.${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type VerifyBookingAccessTokenResult =
  | { ok: true; claims: BookingAccessTokenClaims }
  | { ok: false; reason: 'invalid' | 'tampered' | 'expired' | 'code_mismatch' | 'phone_mismatch' };

export function verifyBookingAccessToken(args: {
  token: string;
  bookingCode: string;
  normalizedPhone?: string | null;
  nowSec?: number;
  env?: NodeJS.ProcessEnv;
}): VerifyBookingAccessTokenResult {
  const parts = String(args.token ?? '').split('.');
  if (parts.length !== 2) return { ok: false, reason: 'invalid' };
  const [json, sig] = parts;
  const secret = getSessionSecretForTests(args.env ?? process.env);
  if (hmac(json, secret) !== sig) return { ok: false, reason: 'tampered' };
  try {
    const claims = JSON.parse(
      Buffer.from(json, 'base64url').toString('utf8'),
    ) as BookingAccessTokenClaims;
    if (claims.contractVersion !== BOOKING_ACCESS_CONTRACT_VERSION) {
      return { ok: false, reason: 'invalid' };
    }
    const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp < nowSec) {
      return { ok: false, reason: 'expired' };
    }
    const code = args.bookingCode.trim().toUpperCase();
    if (String(claims.bookingCode).toUpperCase() !== code) {
      return { ok: false, reason: 'code_mismatch' };
    }
    if (args.normalizedPhone != null && args.normalizedPhone !== '') {
      const dig = digestNormalizedPhone(args.normalizedPhone);
      if (dig !== claims.phoneDigest) return { ok: false, reason: 'phone_mismatch' };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
