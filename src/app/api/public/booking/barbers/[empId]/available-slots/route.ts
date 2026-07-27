import { NextRequest } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingAvailabilityError,
  getPublicAvailableSlots,
} from '@/lib/booking/publicBookingAvailability';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['barber-available-slots'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/barbers/[empId]/available-slots
 * Same central availability as /available-slots?empId=
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'barber-available-slots');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const { searchParams } = new URL(req.url);
    void searchParams.get('includeTest');
    void searchParams.get('BranchID');
    const preview = searchParams.get('preview');
    const branchCode = extractPublicBranchCode(searchParams);
    const date = searchParams.get('date') || '';
    const serviceIds = searchParams.get('serviceIds');

    if (!Number.isFinite(empId) || empId <= 0) {
      return finalizePublicBookingError(req, gate, 'BARBER_NOT_FOUND');
    }
    if (!serviceIds?.trim()) {
      return finalizePublicBookingError(req, gate, 'SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }

    const result = await getPublicAvailableSlots({
      branchCode,
      date,
      serviceIds,
      empId,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(
      req,
      gate,
      {
        ...result,
        empId,
        branchCode: result.branch.branchCode,
      },
    );
  } catch (err) {
    if (err instanceof PublicBookingAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error(
      '[public/booking/barbers/available-slots]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
