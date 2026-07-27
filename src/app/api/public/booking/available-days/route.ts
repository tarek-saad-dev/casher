import { NextRequest } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingAvailabilityError,
  getPublicAvailableDays,
} from '@/lib/booking/publicBookingAvailability';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['available-days'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/available-days
 * Required: branchCode, serviceIds
 * Optional: empId, from, to
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'available-days');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    void searchParams.get('BranchID');
    void searchParams.get('includeTest');
    void searchParams.get('duration');
    void searchParams.get('slotInterval');
    const preview = searchParams.get('preview');
    const branchCode = extractPublicBranchCode(searchParams);
    const serviceIds = searchParams.get('serviceIds');
    const empIdRaw = searchParams.get('empId');
    const from = searchParams.get('from') ?? searchParams.get('fromDate');
    const to = searchParams.get('to') ?? searchParams.get('toDate');

    if (!serviceIds?.trim()) {
      return finalizePublicBookingError(req, gate, 'SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }

    const empId = empIdRaw ? Number(empIdRaw) : null;
    if (empIdRaw && (!Number.isFinite(empId) || (empId ?? 0) <= 0)) {
      return finalizePublicBookingError(req, gate, 'BARBER_NOT_FOUND');
    }

    const result = await getPublicAvailableDays({
      branchCode,
      serviceIds,
      empId,
      from,
      to,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(req, gate, result);
  } catch (err) {
    if (err instanceof PublicBookingAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error('[public/booking/available-days]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
