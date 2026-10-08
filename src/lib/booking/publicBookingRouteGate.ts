/**
 * Booking Phase 7C2 — shared route gate (rate limit + request ID).
 * Phase 8D — anonymized request logging + health samples.
 */
import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getPublicBookingAllowedOrigins,
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
  withPublicBookingCors,
  type PublicBookingCorsMethod,
} from '@/lib/booking/publicBookingCors';
import {
  loadAnyTenantPublicBookingOrigins,
  loadPublicBookingTenantOrigins,
  resolvePublicBookingTenancy,
  resolvePublicBookingTenancyForCode,
  type PublicBookingTenancy,
} from '@/lib/booking/publicBookingTenancy';
import {
  PUBLIC_BOOKING_ROUTE_RATE_FAMILY,
  resolveRateLimitFromRequest,
  type RateLimitCheckResult,
} from '@/lib/booking/publicBookingRateLimitPolicy';
import { publicBookingErrorBody, PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import {
  applyPublicBookingResponseHeaders,
  getOrCreateRequestId,
  logPublicBookingRequest,
  mergeCompatibilityIntoBody,
} from '@/lib/booking/publicBookingResponse';
import type { ContractCompatibilityFlags } from '@/lib/booking/publicBookingContractMode';
import {
  recordPublicBookingHealthSample,
  type PublicBookingHealthOutcome,
} from '@/lib/booking/publicBookingHealthMetrics';
import { getPublicBookingReadTelemetry } from '@/lib/booking/publicBookingReadTelemetry';
import type { PublicBookingReadTelemetryStore } from '@/lib/booking/publicBookingReadTelemetry';

export type PublicBookingRouteGate = {
  requestId: string;
  rateLimit: RateLimitCheckResult;
  routeKey: string;
  cors: { methods: PublicBookingCorsMethod[]; headers: readonly string[] };
  startedAtMs: number;
  /** Optional B2.5 read timings — set by critical-read wrappers; log-only. */
  readTelemetry?: PublicBookingReadTelemetryStore | null;
  /**
   * DRVO-019: browser origins of the resolved tenant. Unset until the route binds a tenant;
   * unbound responses keep the legacy env allowlist.
   */
  tenantOrigins?: string[] | null;
};

export type PublicBookingTelemetry = {
  outcome?: PublicBookingHealthOutcome;
  errorCode?: string | null;
};

/** Attach critical-read telemetry snapshot before finalize (ALS may already have exited). */
export function attachPublicBookingReadTelemetry(
  gate: PublicBookingRouteGate,
  telemetry: PublicBookingReadTelemetryStore,
): void {
  gate.readTelemetry = telemetry;
}

function emitTelemetry(
  req: NextRequest,
  gate: PublicBookingRouteGate,
  args: {
    status: number;
    errorCode?: string | null;
    outcome: PublicBookingHealthOutcome;
  },
): void {
  const durationMs = Math.max(0, Date.now() - gate.startedAtMs);
  const readTelemetry = gate.readTelemetry ?? getPublicBookingReadTelemetry();
  logPublicBookingRequest({
    requestId: gate.requestId,
    routeFamily: gate.routeKey,
    method: req.method,
    status: args.status,
    errorCode: args.errorCode ?? null,
    durationMs,
    ...(readTelemetry
      ? {
          queryCount: readTelemetry.queryCount,
          dbMs: readTelemetry.dbMs,
          availabilityMs: readTelemetry.availabilityMs,
        }
      : {}),
  });
  void recordPublicBookingHealthSample({
    routeKey: gate.routeKey,
    outcome: args.outcome,
    errorCode: args.errorCode ?? null,
    durationMs,
    httpStatus: args.status,
  });
}

export function gatePublicBookingRoute(
  req: NextRequest,
  routeKey: string,
  subjectDigest?: string | null,
): { gate: PublicBookingRouteGate; blocked: NextResponse | null } {
  const startedAtMs = Date.now();
  const family = PUBLIC_BOOKING_ROUTE_RATE_FAMILY[routeKey] ?? 'discovery';
  const rateLimit = resolveRateLimitFromRequest(req, family, subjectDigest);
  const requestId = getOrCreateRequestId(req);
  const cors =
    PUBLIC_BOOKING_ROUTE_CORS[routeKey] ?? PUBLIC_BOOKING_ROUTE_CORS.branches;

  const gate: PublicBookingRouteGate = {
    requestId,
    rateLimit,
    routeKey,
    cors,
    startedAtMs,
  };

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
    emitTelemetry(req, gate, {
      status: 429,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      outcome: 'rate_limited',
    });
    return { gate, blocked: res };
  }

  return { gate, blocked: null };
}

export function finalizePublicBookingJson(
  req: NextRequest,
  gate: PublicBookingRouteGate,
  body: unknown,
  options?: {
    status?: number;
    cacheControl?: string | null;
    compatibility?: ContractCompatibilityFlags | null;
    telemetry?: PublicBookingTelemetry;
  },
): NextResponse {
  const responseBody =
    options?.compatibility && body && typeof body === 'object' && !Array.isArray(body)
      ? mergeCompatibilityIntoBody(body as Record<string, unknown>, options.compatibility)
      : body;
  const status = options?.status ?? 200;
  let res: NextResponse = NextResponse.json(responseBody, { status });
  res = withPublicBookingCors(res, req, {
    allowedMethods: [...gate.cors.methods],
    allowedHeaders: gate.cors.headers,
    cacheControl: options?.cacheControl === undefined ? 'no-store' : options.cacheControl,
    allowedOrigins: gate.tenantOrigins ?? null,
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

  const outcome: PublicBookingHealthOutcome =
    options?.telemetry?.outcome ??
    (status >= 200 && status < 400 ? 'success' : 'failure');
  emitTelemetry(req, gate, {
    status,
    errorCode: options?.telemetry?.errorCode ?? null,
    outcome,
  });
  return res;
}

export function finalizePublicBookingError(
  req: NextRequest,
  gate: PublicBookingRouteGate,
  code: keyof typeof PUBLIC_BOOKING_ERROR_CATALOG,
  metadata?: Record<string, unknown>,
  telemetry?: PublicBookingTelemetry,
): NextResponse {
  const def = PUBLIC_BOOKING_ERROR_CATALOG[code];
  let res: NextResponse = NextResponse.json(publicBookingErrorBody(code, metadata), {
    status: def.httpStatus,
  });
  res = withPublicBookingCors(res, req, {
    allowedMethods: [...gate.cors.methods],
    allowedHeaders: gate.cors.headers,
    cacheControl: 'no-store',
    allowedOrigins: gate.tenantOrigins ?? null,
  });
  applyPublicBookingResponseHeaders(res, {
    requestId: gate.requestId,
    rateLimit: {
      limit: gate.rateLimit.limit,
      remaining: gate.rateLimit.remaining,
      resetAt: gate.rateLimit.resetAt,
    },
  });
  emitTelemetry(req, gate, {
    status: def.httpStatus,
    errorCode: code,
    outcome: telemetry?.outcome ?? 'failure',
  });
  return res;
}

/** Bind a resolved tenant to the gate so every later response uses that tenant's origins. */
export async function bindPublicBookingTenant(gate: PublicBookingRouteGate, tenantId: string): Promise<void> {
  gate.tenantOrigins = await loadPublicBookingTenantOrigins(tenantId);
}

/**
 * DRVO-019 route entry: resolve the request tenant (branchCode, or the CUT compatibility fallback
 * where `allowCutCompat`), bind its CORS origins, or answer the non-disclosing error response
 * (unknown branch / booking app not installed → 404 BRANCH_NOT_FOUND).
 */
export async function requirePublicBookingRouteTenancy(
  req: NextRequest,
  gate: PublicBookingRouteGate,
  args: { branchCode: string | null | undefined; allowCutCompat?: boolean },
): Promise<PublicBookingTenancy | NextResponse> {
  const result = await resolvePublicBookingTenancy(req, {
    branchCode: args.branchCode,
    route: `public/booking/${gate.routeKey}`,
    allowCutCompat: args.allowCutCompat,
  });
  if (!result.ok) return finalizePublicBookingError(req, gate, result.code);
  await bindPublicBookingTenant(gate, result.tenancy.tenantId);
  return result.tenancy;
}

/**
 * Code-addressed routes (lookup / cancel): the tenant is the one owning the booking's branch.
 * Unknown codes and bookings of tenants without the booking app answer `notFoundCode`.
 */
export async function requirePublicBookingCodeTenancy(
  req: NextRequest,
  gate: PublicBookingRouteGate,
  code: string,
  codes: {
    invalid: keyof typeof PUBLIC_BOOKING_ERROR_CATALOG;
    notFound: keyof typeof PUBLIC_BOOKING_ERROR_CATALOG;
  },
): Promise<{ tenantId: string } | NextResponse> {
  const result = await resolvePublicBookingTenancyForCode(code, `public/booking/${gate.routeKey}`);
  if (!result.ok) {
    return finalizePublicBookingError(
      req,
      gate,
      result.reason === 'invalid_code' ? codes.invalid : codes.notFound,
    );
  }
  await bindPublicBookingTenant(gate, result.tenantId);
  return { tenantId: result.tenantId };
}

/**
 * Tenant-aware preflight. Preflight carries no tenant data, so it admits CUT's legacy origins and
 * any active tenant's configured origins; the actual response is gated by its own tenant.
 */
export async function publicBookingTenantOptionsResponse(
  req: NextRequest,
  routeKey: string,
): Promise<NextResponse> {
  const cors = PUBLIC_BOOKING_ROUTE_CORS[routeKey] ?? PUBLIC_BOOKING_ROUTE_CORS.branches;
  const origins = new Set<string>(getPublicBookingAllowedOrigins().origins);
  for (const o of await loadAnyTenantPublicBookingOrigins()) origins.add(o);
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
    allowedOrigins: [...origins],
  });
}
