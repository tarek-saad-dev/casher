import { NextRequest } from 'next/server';
import {
  isValidDate,
} from '@/lib/publicBookingHelpers';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingBarberError,
  listPublicBookingBarbers,
} from '@/lib/booking/publicBookingBarbers';
import { parsePublicServiceIdsParam } from '@/lib/booking/publicBookingBarberPolicy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['barbers'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/barbers
 * mode=global (default) | mode=branch&branchCode=GLEEM
 * Optional: date, serviceIds
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'barbers');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    // Security: ignore unlockers
    void searchParams.get('BranchID');
    void searchParams.get('branchId');
    void searchParams.get('includeTest');
    void searchParams.get('internal');
    const preview = searchParams.get('preview');

    const branchCode = extractPublicBranchCode(searchParams);
    const modeRaw = (searchParams.get('mode') || '').toLowerCase();
    const mode: 'global' | 'branch' =
      modeRaw === 'branch' ? 'branch' : modeRaw === 'global' ? 'global' : branchCode ? 'branch' : 'global';

    const dateParam = searchParams.get('date');
    if (dateParam && !isValidDate(dateParam)) {
      return finalizePublicBookingError(req, gate, 'INVALID_DATE');
    }

    const parsedServices = parsePublicServiceIdsParam(searchParams.get('serviceIds'));
    if (!parsedServices.ok) {
      return finalizePublicBookingError(req, gate, 'SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }

    const result = await listPublicBookingBarbers({
      mode,
      branchCode,
      date: dateParam,
      serviceIds: parsedServices.ids,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(req, gate, result);
  } catch (err) {
    if (err instanceof PublicBookingBarberError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error('[public/booking/barbers]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'BARBER_CATALOG_UNAVAILABLE');
  }
}
