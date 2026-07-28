import { NextRequest } from 'next/server';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicCrossBranchAvailabilityError,
  getPublicCrossBranchBarberAvailability,
} from '@/lib/booking/publicBookingCrossBranchAvailability';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['cross-branch-availability'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * POST /api/public/booking/barbers/[empId]/cross-branch-availability
 * Phase 10C — barber availability across all public bookable branches.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'cross-branch-availability');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Reject internal identifiers if sent
    void body.BranchID;
    void body.branchId;

    const result = await getPublicCrossBranchBarberAvailability({
      empId,
      serviceIds: body.serviceIds,
      dateFrom: body.dateFrom,
      days: body.days,
    });

    return finalizePublicBookingJson(req, gate, result);
  } catch (err) {
    if (err instanceof PublicCrossBranchAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error(
      '[public/booking/barbers/cross-branch-availability]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
