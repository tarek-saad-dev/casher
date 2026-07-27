/**
 * POST /api/public/booking/upcoming
 * Phase 7A — canonical upcoming list via publicBookingReader.
 */

import { NextRequest } from 'next/server';
import {
  normalizePublicBookingPhone,
} from '@/lib/publicBookingHelpers';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingReadError,
  listPublicUpcomingBookings,
} from '@/lib/booking/publicBookingReader';
import { digestPublicBookingRateSubject } from '@/lib/booking/publicBookingRateLimitPolicy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['upcoming'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
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
    const result = await listPublicUpcomingBookings({
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
