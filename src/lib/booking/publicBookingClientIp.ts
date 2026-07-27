/**
 * Booking Phase 7C2 — trusted client IP resolution for public booking rate limits.
 */
import 'server-only';
import type { NextRequest } from 'next/server';

const IP_V4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
const IP_V6_RE = /^[0-9a-f:]+$/i;

function normalizeIp(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length > 64) return null;
  if (IP_V4_RE.test(t) || IP_V6_RE.test(t)) return t;
  return null;
}

function isTrustedProxyContext(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.VERCEL === '1' ||
    env.VERCEL_ENV != null ||
    env.NODE_ENV === 'production'
  );
}

/**
 * Resolve client IP for rate limiting.
 * On Vercel/production: prefer x-real-ip, then first x-forwarded-for hop.
 * Otherwise: x-real-ip only; do not trust long XFF chains.
 */
export function resolvePublicBookingClientIp(
  request: Request | NextRequest,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    const n = normalizeIp(realIp);
    if (n) return n;
  }

  const xff = request.headers.get('x-forwarded-for');
  if (xff && isTrustedProxyContext(env)) {
    const first = xff.split(',')[0]?.trim();
    const n = first ? normalizeIp(first) : null;
    if (n) return n;
  } else if (xff && !isTrustedProxyContext(env)) {
    // Dev/local: only trust if single hop looks valid
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length === 1) {
      const n = normalizeIp(hops[0]!);
      if (n) return n;
    }
  }

  return 'anonymous';
}
