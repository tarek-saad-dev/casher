/**
 * Booking Phase 7C2 — centralized public booking rate-limit policy.
 * Storage: in-memory Map (best-effort per instance; not distributed).
 */
import 'server-only';
import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { resolvePublicBookingClientIp } from '@/lib/booking/publicBookingClientIp';

export type PublicBookingRateLimitFamily =
  | 'discovery'
  | 'catalog'
  | 'barbers'
  | 'availability'
  | 'available-days'
  | 'validation'
  | 'plan'
  | 'create'
  | 'lookup'
  | 'upcoming'
  | 'cancel';

export type RateLimitPolicy = {
  family: PublicBookingRateLimitFamily;
  limit: number;
  windowMs: number;
  /** When true, combine IP + optional subject digest. */
  subjectAware: boolean;
};

const WINDOW_MS = 60_000;

/** Audited baseline matrix (Phase 7C2). */
const BASE_POLICIES: Record<PublicBookingRateLimitFamily, RateLimitPolicy> = {
  discovery: { family: 'discovery', limit: 60, windowMs: WINDOW_MS, subjectAware: false },
  catalog: { family: 'catalog', limit: 45, windowMs: WINDOW_MS, subjectAware: false },
  barbers: { family: 'barbers', limit: 45, windowMs: WINDOW_MS, subjectAware: false },
  availability: { family: 'availability', limit: 30, windowMs: WINDOW_MS, subjectAware: false },
  'available-days': { family: 'available-days', limit: 20, windowMs: WINDOW_MS, subjectAware: false },
  validation: { family: 'validation', limit: 20, windowMs: WINDOW_MS, subjectAware: false },
  plan: { family: 'plan', limit: 15, windowMs: WINDOW_MS, subjectAware: false },
  create: { family: 'create', limit: 8, windowMs: WINDOW_MS, subjectAware: false },
  lookup: { family: 'lookup', limit: 30, windowMs: WINDOW_MS, subjectAware: true },
  upcoming: { family: 'upcoming', limit: 15, windowMs: WINDOW_MS, subjectAware: true },
  cancel: { family: 'cancel', limit: 10, windowMs: WINDOW_MS, subjectAware: true },
};

/** Route family → rate-limit family mapping. */
export const PUBLIC_BOOKING_ROUTE_RATE_FAMILY: Record<string, PublicBookingRateLimitFamily> = {
  branches: 'discovery',
  config: 'discovery',
  status: 'discovery',
  services: 'catalog',
  barbers: 'barbers',
  calendar: 'availability',
  location: 'barbers',
  'barber-available-slots': 'availability',
  'cross-branch-availability': 'availability',
  'barber-availability-days': 'available-days',
  'barber-availability-slots': 'availability',
  'available-days': 'available-days',
  'available-slots': 'availability',
  'check-slot': 'validation',
  plan: 'plan',
  create: 'create',
  lookup: 'lookup',
  upcoming: 'upcoming',
  cancel: 'cancel',
  'cancel-by-code': 'cancel',
};

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function parseEnvOverride(
  family: PublicBookingRateLimitFamily,
  env: NodeJS.ProcessEnv,
): number | null {
  const key = `PUBLIC_BOOKING_RL_${family.toUpperCase().replace(/-/g, '_')}`;
  const raw = env[key];
  if (raw == null || !String(raw).trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 500) return null;
  return Math.floor(n);
}

export function getPublicBookingRateLimitPolicy(
  family: PublicBookingRateLimitFamily,
  env: NodeJS.ProcessEnv = process.env,
): RateLimitPolicy {
  const base = BASE_POLICIES[family];
  const override = parseEnvOverride(family, env);
  if (override != null) return { ...base, limit: override };
  // available-days uses stricter sub-limit when env not set
  if (family === 'availability' && env.PUBLIC_BOOKING_RL_AVAILABLE_DAYS) {
    const n = Number(env.PUBLIC_BOOKING_RL_AVAILABLE_DAYS);
    if (Number.isFinite(n) && n >= 1 && n <= 500) {
      return { ...base, limit: Math.floor(n) };
    }
  }
  return base;
}

/** One-way subject digest — never store raw phone/code in keys. */
export function digestPublicBookingRateSubject(kind: string, raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized || normalized.length > 256) return null;
  return crypto
    .createHash('sha256')
    .update(`p7c2-rl:${kind}:${normalized.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
}

export function buildPublicBookingRateLimitKey(args: {
  family: PublicBookingRateLimitFamily;
  clientIp: string;
  subjectDigest?: string | null;
  policy?: RateLimitPolicy;
}): string {
  const policy = args.policy ?? getPublicBookingRateLimitPolicy(args.family);
  const ip = args.clientIp || 'anonymous';
  if (policy.subjectAware && args.subjectDigest) {
    return `pb:${args.family}:${ip}:${args.subjectDigest}`;
  }
  return `pb:${args.family}:${ip}`;
}

export type RateLimitCheckResult =
  | {
      allowed: true;
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfterSeconds: 0;
    }
  | {
      allowed: false;
      limit: number;
      remaining: 0;
      resetAt: number;
      retryAfterSeconds: number;
    };

export function checkPublicBookingRateLimit(args: {
  family: PublicBookingRateLimitFamily;
  clientIp: string;
  subjectDigest?: string | null;
  env?: NodeJS.ProcessEnv;
}): RateLimitCheckResult {
  const policy = getPublicBookingRateLimitPolicy(args.family, args.env);
  const key = buildPublicBookingRateLimitKey({
    family: args.family,
    clientIp: args.clientIp,
    subjectDigest: args.subjectDigest,
    policy,
  });
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + policy.windowMs };
    buckets.set(key, entry);
    return {
      allowed: true,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - 1),
      resetAt: entry.resetAt,
      retryAfterSeconds: 0,
    };
  }
  entry.count++;
  if (entry.count > policy.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterSeconds,
    };
  }
  return {
    allowed: true,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - entry.count),
    resetAt: entry.resetAt,
    retryAfterSeconds: 0,
  };
}

export function resolveRateLimitFromRequest(
  request: NextRequest | Request,
  family: PublicBookingRateLimitFamily,
  subjectDigest?: string | null,
): RateLimitCheckResult {
  const ip = resolvePublicBookingClientIp(request);
  return checkPublicBookingRateLimit({ family, clientIp: ip, subjectDigest });
}

/** Test helper — clear in-memory buckets. */
export function resetPublicBookingRateLimitsForTests(): void {
  buckets.clear();
}

export function getRateLimitStorageKind(): 'in-memory' {
  return 'in-memory';
}
