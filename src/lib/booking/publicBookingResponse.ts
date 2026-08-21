/**
 * Booking Phase 7C2 — public booking response helpers (request ID, contract headers).
 */
import 'server-only';
import crypto from 'crypto';
import type { NextResponse } from 'next/server';
import {
  PUBLIC_BOOKING_API_CONTRACT_VERSION,
  PUBLIC_BOOKING_CONTRACT_VERSION_HEADER,
  DEPRECATION_HEADERS,
  type ContractCompatibilityFlags,
} from '@/lib/booking/publicBookingContractMode';

export const PUBLIC_BOOKING_REQUEST_ID_HEADER = 'X-Request-Id';

export function mintPublicBookingRequestId(): string {
  return `pb-${crypto.randomUUID()}`;
}

export function getOrCreateRequestId(request: Request): string {
  const existing = request.headers.get(PUBLIC_BOOKING_REQUEST_ID_HEADER);
  if (existing && /^pb-[0-9a-f-]{36}$/i.test(existing.trim())) {
    return existing.trim();
  }
  return mintPublicBookingRequestId();
}

export function applyPublicBookingResponseHeaders(
  response: NextResponse,
  args: {
    requestId?: string;
    compatibility?: ContractCompatibilityFlags | null;
    rateLimit?: {
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfterSeconds?: number;
    };
    extra?: Record<string, string>;
  },
): NextResponse {
  response.headers.set(PUBLIC_BOOKING_CONTRACT_VERSION_HEADER, PUBLIC_BOOKING_API_CONTRACT_VERSION);
  if (args.requestId) {
    response.headers.set(PUBLIC_BOOKING_REQUEST_ID_HEADER, args.requestId);
  }
  if (args.compatibility?.legacyRequestAccepted) {
    response.headers.set('Deprecation', DEPRECATION_HEADERS.Deprecation);
    response.headers.set('Warning', DEPRECATION_HEADERS.Warning);
  }
  if (args.rateLimit) {
    response.headers.set('X-RateLimit-Limit', String(args.rateLimit.limit));
    response.headers.set('X-RateLimit-Remaining', String(args.rateLimit.remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.floor(args.rateLimit.resetAt / 1000)));
    if (args.rateLimit.retryAfterSeconds && args.rateLimit.retryAfterSeconds > 0) {
      response.headers.set('Retry-After', String(args.rateLimit.retryAfterSeconds));
    }
  }
  if (args.extra) {
    for (const [k, v] of Object.entries(args.extra)) {
      response.headers.set(k, v);
    }
  }
  return response;
}

export function mergeCompatibilityIntoBody<T extends Record<string, unknown>>(
  body: T,
  compatibility: ContractCompatibilityFlags | null,
): T & { compatibility?: ContractCompatibilityFlags } {
  if (!compatibility) return body;
  return { ...body, compatibility };
}

export function logPublicBookingRequest(args: {
  requestId: string;
  routeFamily: string;
  method: string;
  status: number;
  errorCode?: string | null;
  durationMs: number;
  /** Optional B2.5 read telemetry — logs only, never required on response body. */
  queryCount?: number;
  dbMs?: number;
  availabilityMs?: number;
}): void {
  console.info(
    JSON.stringify({
      event: 'public_booking.request',
      requestId: args.requestId,
      routeFamily: args.routeFamily,
      method: args.method,
      status: args.status,
      errorCode: args.errorCode ?? null,
      durationMs: args.durationMs,
      ...(args.queryCount != null ? { queryCount: args.queryCount } : {}),
      ...(args.dbMs != null ? { dbMs: args.dbMs } : {}),
      ...(args.availabilityMs != null ? { availabilityMs: args.availabilityMs } : {}),
      ...(args.durationMs != null ? { totalMs: args.durationMs } : {}),
      environment: process.env.NODE_ENV ?? null,
      timestamp: new Date().toISOString(),
    }),
  );
}
