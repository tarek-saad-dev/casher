import { NextRequest } from 'next/server';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBarberMultiBranchAvailabilityError,
  getBarberAvailabilitySlots,
} from '@/lib/booking/publicBarberMultiBranchAvailability';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['barber-availability-slots'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * POST /api/public/booking/barbers/[empId]/availability/slots
 * Phase 1C — aggregate available slots across public branches for one barber + date.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'barber-availability-slots');
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

    const result = await getBarberAvailabilitySlots({
      empId,
      serviceIds: body.serviceIds,
      date: body.date,
      scope: body.scope,
      branchCode: body.branchCode,
    });

    return finalizePublicBookingJson(req, gate, result, {
      cacheControl: 'private, max-age=30, stale-while-revalidate=20',
    });
  } catch (err) {
    if (err instanceof PublicBarberMultiBranchAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error(
      '[public/booking/barbers/availability/slots]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
