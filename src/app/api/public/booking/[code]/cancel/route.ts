/**
 * POST /api/public/booking/:code/cancel
 * Phase 7B — preferred code-route cancel via canonical cancelPublicBooking.
 */
import { NextRequest } from 'next/server';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  cancelPublicBooking,
  PublicBookingCancelError,
} from '@/lib/booking/publicBookingCancellation';
import { resolvePublicBookingClientIp } from '@/lib/booking/publicBookingClientIp';
import { digestPublicBookingRateSubject } from '@/lib/booking/publicBookingRateLimitPolicy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ code: string }> };

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['cancel-by-code'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { code } = await context.params;
  const subjectDigest = digestPublicBookingRateSubject('code', code);
  const { gate, blocked } = gatePublicBookingRoute(req, 'cancel-by-code', subjectDigest);
  if (blocked) return blocked;
  const clientIp = resolvePublicBookingClientIp(req);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.bookingId != null || body.BookingID != null) {
      return finalizePublicBookingError(req, gate, 'INVALID_BOOKING_CODE', {
        reason: 'numeric_booking_id_rejected',
      });
    }

    const idempotencyKey =
      (typeof body.clientRequestId === 'string' && body.clientRequestId) ||
      (typeof body.idempotencyKey === 'string' && body.idempotencyKey) ||
      req.headers.get('idempotency-key') ||
      null;

    const result = await cancelPublicBooking({
      code,
      phone: body.phone != null ? String(body.phone) : null,
      accessToken:
        body.bookingAccessToken != null
          ? String(body.bookingAccessToken)
          : body.accessToken != null
            ? String(body.accessToken)
            : null,
      reasonCode: body.reasonCode != null ? String(body.reasonCode) : null,
      reasonText: body.reasonText != null ? String(body.reasonText) : null,
      clientRequestId: idempotencyKey,
      idempotencyKey,
      requestContext: {
        ip: clientIp,
        userAgent: req.headers.get('user-agent') || undefined,
      },
    });

    const replay =
      (result.body as { cancellation?: { idempotentReplay?: boolean } } | null)
        ?.cancellation?.idempotentReplay === true;
    return finalizePublicBookingJson(req, gate, result.body, {
      status: result.httpStatus,
      telemetry: {
        outcome: replay ? 'idempotent_replay' : 'success',
      },
    });
  } catch (err) {
    if (err instanceof PublicBookingCancelError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    console.error('[public/booking/:code/cancel]', err);
    return finalizePublicBookingError(req, gate, 'BOOKING_CANCELLATION_FAILED', undefined, {
      outcome: 'mutation_outcome_unknown',
    });
  }
}
