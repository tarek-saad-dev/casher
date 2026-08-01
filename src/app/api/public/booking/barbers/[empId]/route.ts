import { NextRequest } from 'next/server';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingBarberError,
  getPublicBarberProfileById,
} from '@/lib/booking/publicBookingBarbers';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['barbers'] ?? PUBLIC_BOOKING_ROUTE_CORS['location'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/barbers/[empId]
 * Single public barber profile (branches + serviceIds) — no full roster.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'barbers');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const { searchParams } = new URL(req.url);
    const preview = searchParams.get('preview');

    const result = await getPublicBarberProfileById({
      empId,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(req, gate, result, {
      cacheControl: 'private, max-age=60, stale-while-revalidate=30',
    });
  } catch (err) {
    if (err instanceof PublicBookingBarberError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error('[public/booking/barbers/:empId]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'BARBER_CATALOG_UNAVAILABLE');
  }
}
