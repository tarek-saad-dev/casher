/**
 * POST /api/public/booking/upcoming
 * Phase 7A — canonical upcoming list via publicBookingReader.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  normalizePublicBookingPhone,
} from '@/lib/publicBookingHelpers';
import {
  PublicBookingReadError,
  listPublicUpcomingBookings,
} from '@/lib/booking/publicBookingReader';
import { digestPublicBookingRateSubject } from '@/lib/booking/publicBookingRateLimitPolicy';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  publicBookingTenantOptionsResponse,
  requirePublicBookingRouteTenancy,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'upcoming');
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const normalizedPhone =
    typeof body.phone === 'string' ? normalizePublicBookingPhone(body.phone) : null;
  const subjectDigest = normalizedPhone
    ? digestPublicBookingRateSubject('phone', normalizedPhone)
    : null;
  const { gate, blocked } = gatePublicBookingRoute(req, 'upcoming', subjectDigest);
  if (blocked) return blocked;

  try {
    const tenancy = await requirePublicBookingRouteTenancy(req, gate, {
      branchCode: extractPublicBranchCode(new URL(req.url).searchParams, body),
      allowCutCompat: true,
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const result = await listPublicUpcomingBookings({
      tenantId: tenancy.tenantId,
      phone: body.phone,
      fromDate: body.fromDate,
      limit: body.limit,
    });

    return finalizePublicBookingJson(
      req,
      gate,
      {
        ok: true,
        bookings: result.bookings,
        meta: result.meta,
      },
    );
  } catch (err) {
    if (err instanceof PublicBookingReadError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    console.error('[upcoming]', err);
    return finalizePublicBookingError(req, gate, 'UPCOMING_BOOKINGS_UNAVAILABLE');
  }
}
