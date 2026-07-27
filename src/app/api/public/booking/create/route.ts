import { NextRequest } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingCreateError,
  createPublicBooking,
} from '@/lib/booking/publicBookingCreate';
import { PublicBookingSelectionError } from '@/lib/booking/publicBookingSelectionEvaluator';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['create'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * POST /api/public/booking/create
 * Phase 6 — transactional create via createPublicBooking.
 */
export async function POST(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'create');
  if (blocked) return blocked;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { searchParams } = new URL(req.url);

    // Ignored / forbidden client drivers
    void body.BranchID;
    void body.price;
    void body.duration;
    void body.durationMinutes;
    void body.total;
    void body.status;
    void body.bookingCode;
    void body.endTime;
    void body.timezone;

    const branchCode = extractPublicBranchCode(searchParams, body);
    const customer = (body.customer ?? {}) as { name?: string; phone?: string | null };
    const idempotencyKeyHeader =
      req.headers.get('Idempotency-Key') ?? req.headers.get('idempotency-key');

    const result = await createPublicBooking({
      branchCode,
      date: typeof body.date === 'string' ? body.date : null,
      time: typeof body.time === 'string' ? body.time : null,
      dayOffset: body.dayOffset,
      serviceIds: body.serviceIds,
      empId: body.empId,
      mode: body.mode,
      planToken: typeof body.planToken === 'string' ? body.planToken : null,
      customer,
      notes: typeof body.notes === 'string' ? body.notes : null,
      clientRequestId:
        typeof body.clientRequestId === 'string'
          ? body.clientRequestId
          : typeof body.idempotencyKey === 'string'
            ? body.idempotencyKey
            : null,
      idempotencyKeyHeader,
      previewQueryParam:
        searchParams.get('preview') ??
        (typeof body.preview === 'string' ? body.preview : null),
      suppressNotification: body.suppressNotification === true,
    });

    return finalizePublicBookingJson(req, gate, result.body, {
      status: result.httpStatus,
      compatibility: result.body?.compatibility ?? null,
    });
  } catch (err) {
    if (err instanceof PublicBookingCreateError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    if (err instanceof PublicBookingSelectionError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    console.error('[public/booking/create]', err);
    return finalizePublicBookingError(req, gate, 'BOOKING_CREATE_FAILED');
  }
}
