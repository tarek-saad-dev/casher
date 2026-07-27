/**
 * Booking Phase 7C2 — shared route gate (rate limit + request ID).
 */
import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  PUBLIC_BOOKING_ROUTE_CORS,
  withPublicBookingCors,
  type PublicBookingCorsMethod,
} from '@/lib/booking/publicBookingCors';
import {
  PUBLIC_BOOKING_ROUTE_RATE_FAMILY,
  resolveRateLimitFromRequest,
  type RateLimitCheckResult,
} from '@/lib/booking/publicBookingRateLimitPolicy';
import { publicBookingErrorBody, PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import {
  applyPublicBookingResponseHeaders,
  getOrCreateRequestId,
  mergeCompatibilityIntoBody,
} from '@/lib/booking/publicBookingResponse';
import type { ContractCompatibilityFlags } from '@/lib/booking/publicBookingContractMode';

export type PublicBookingRouteGate = {
  requestId: string;
  rateLimit: RateLimitCheckResult;
  routeKey: string;
  cors: { methods: PublicBookingCorsMethod[]; headers: readonly string[] };
};

export function gatePublicBookingRoute(
  req: NextRequest,
  routeKey: string,
  subjectDigest?: string | null,
): { gate: PublicBookingRouteGate; blocked: NextResponse | null } {
  const family = PUBLIC_BOOKING_ROUTE_RATE_FAMILY[routeKey] ?? 'discovery';
  const rateLimit = resolveRateLimitFromRequest(req, family, subjectDigest);
  const requestId = getOrCreateRequestId(req);
  const cors =
    PUBLIC_BOOKING_ROUTE_CORS[routeKey] ?? PUBLIC_BOOKING_ROUTE_CORS.branches;

  if (!rateLimit.allowed) {
    const body = publicBookingErrorBody('RATE_LIMIT_EXCEEDED', {
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
    let res: NextResponse = NextResponse.json(body, { status: 429 });
    res = withPublicBookingCors(res, req, {
      allowedMethods: [...cors.methods],
      allowedHeaders: cors.headers,
      cacheControl: 'no-store',
    });
    applyPublicBookingResponseHeaders(res, {
      requestId,
      rateLimit: {
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        resetAt: rateLimit.resetAt,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
    });
    return {
      gate: { requestId, rateLimit, routeKey, cors },
      blocked: res,
    };
  }

  return {
    gate: { requestId, rateLimit, routeKey, cors },
    blocked: null,
  };
}

export function finalizePublicBookingJson(
  req: NextRequest,
  gate: PublicBookingRouteGate,
  body: unknown,
  options?: {
    status?: number;
    cacheControl?: string | null;
    compatibility?: ContractCompatibilityFlags | null;
  },
): NextResponse {
  const responseBody =
    options?.compatibility && body && typeof body === 'object' && !Array.isArray(body)
      ? mergeCompatibilityIntoBody(body as Record<string, unknown>, options.compatibility)
      : body;
  let res: NextResponse = NextResponse.json(responseBody, { status: options?.status ?? 200 });
  res = withPublicBookingCors(res, req, {
    allowedMethods: [...gate.cors.methods],
    allowedHeaders: gate.cors.headers,
    cacheControl: options?.cacheControl === undefined ? 'no-store' : options.cacheControl,
  });
  applyPublicBookingResponseHeaders(res, {
    requestId: gate.requestId,
    compatibility: options?.compatibility ?? null,
    rateLimit: {
      limit: gate.rateLimit.limit,
      remaining: gate.rateLimit.remaining,
      resetAt: gate.rateLimit.resetAt,
    },
  });
  return res;
}

export function finalizePublicBookingError(
  req: NextRequest,
  gate: PublicBookingRouteGate,
  code: keyof typeof PUBLIC_BOOKING_ERROR_CATALOG,
  metadata?: Record<string, unknown>,
): NextResponse {
  const def = PUBLIC_BOOKING_ERROR_CATALOG[code];
  let res: NextResponse = NextResponse.json(publicBookingErrorBody(code, metadata), {
    status: def.httpStatus,
  });
  res = withPublicBookingCors(res, req, {
    allowedMethods: [...gate.cors.methods],
    allowedHeaders: gate.cors.headers,
    cacheControl: 'no-store',
  });
  applyPublicBookingResponseHeaders(res, {
    requestId: gate.requestId,
    rateLimit: {
      limit: gate.rateLimit.limit,
      remaining: gate.rateLimit.remaining,
      resetAt: gate.rateLimit.resetAt,
    },
  });
  return res;
}
