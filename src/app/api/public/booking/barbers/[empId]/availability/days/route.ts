import { NextRequest } from 'next/server';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBarberMultiBranchAvailabilityError,
  getBarberAvailabilityDays,
} from '@/lib/booking/publicBarberMultiBranchAvailability';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['barber-availability-days'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * POST /api/public/booking/barbers/[empId]/availability/days
 * Phase 1C — aggregate available days across public branches for one barber.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'barber-availability-days');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    void body.BranchID;
    void body.branchId;
    void body.branchName;
    void body.duration;
    void body.price;

    const result = await getBarberAvailabilityDays({
      empId,
      serviceIds: body.serviceIds,
      dateFrom: body.dateFrom,
      days: body.days,
      scope: body.scope,
      branchCode: body.branchCode,
    });

    return finalizePublicBookingJson(req, gate, result, {
      cacheControl: 'private, max-age=45, stale-while-revalidate=30',
    });
  } catch (err) {
    if (err instanceof PublicBarberMultiBranchAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error(
      '[public/booking/barbers/availability/days]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
