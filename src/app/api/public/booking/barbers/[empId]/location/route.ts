import { NextRequest } from 'next/server';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingBarberError,
  getPublicBarberLocation,
} from '@/lib/booking/publicBookingBarbers';
import { parsePublicServiceIdsParam } from '@/lib/booking/publicBookingBarberPolicy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['location'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/barbers/[empId]/location?date=&serviceIds=
 * One public operational branch per WorkDate (or safe off / not_available_publicly).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'location');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const { searchParams } = new URL(req.url);
    void searchParams.get('includeTest');
    void searchParams.get('BranchID');
    const preview = searchParams.get('preview');
    const date = searchParams.get('date') || '';

    const parsedServices = parsePublicServiceIdsParam(searchParams.get('serviceIds'));
    if (!parsedServices.ok) {
      return finalizePublicBookingError(req, gate, 'SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }

    const loc = await getPublicBarberLocation({
      empId,
      date,
      serviceIds: parsedServices.ids,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(req, gate, loc);
  } catch (err) {
    if (err instanceof PublicBookingBarberError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error('[public/booking/barbers/location]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'BARBER_CATALOG_UNAVAILABLE');
  }
}
