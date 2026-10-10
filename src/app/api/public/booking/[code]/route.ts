import { NextRequest, NextResponse } from 'next/server';
import {
  PublicBookingReadError,
  getPublicBookingByCode,
} from '@/lib/booking/publicBookingReader';
import {
  digestPublicBookingRateSubject,
} from '@/lib/booking/publicBookingRateLimitPolicy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  publicBookingTenantOptionsResponse,
  requirePublicBookingCodeTenancy,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ code: string }> };

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'lookup');
}

/**
 * GET /api/public/booking/:code
 * Phase 7A — canonical lookup via publicBookingReader.
 * Ownership: ?phone=… and/or ?accessToken=… (or Authorization: Bearer).
 * Code-only returns temporary minimal summary (no customer PII).
 * DRVO-019: scoped to the tenant that owns the booking's branch.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const { code } = await context.params;
  const subjectDigest = digestPublicBookingRateSubject('code', code);
  const { gate, blocked } = gatePublicBookingRoute(req, 'lookup', subjectDigest);
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const tokenParam = searchParams.get('accessToken') || searchParams.get('token');
    const auth = req.headers.get('authorization');
    const bearer =
      auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
    const accessToken = tokenParam || bearer;

    const tenancy = await requirePublicBookingCodeTenancy(req, gate, code, {
      invalid: 'INVALID_BOOKING_CODE',
      notFound: phone || accessToken ? 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED' : 'BOOKING_NOT_FOUND',
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const result = await getPublicBookingByCode({
      tenantId: tenancy.tenantId,
      code,
      phone,
      accessToken,
    });

    return finalizePublicBookingJson(
      req,
      gate,
      {
        ok: true,
        booking: result.booking,
        ...(result.bookingAccessToken
          ? { bookingAccessToken: result.bookingAccessToken }
          : {}),
        meta: {
          ownership: result.ownership,
          dateSource: result.booking.dateSource,
        },
      }
    );
  } catch (err) {
    if (err instanceof PublicBookingReadError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    console.error('[public/booking/:code GET]', err);
    return finalizePublicBookingError(req, gate, 'BOOKING_LOOKUP_UNAVAILABLE');
  }
}
