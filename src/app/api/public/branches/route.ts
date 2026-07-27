import { NextRequest } from 'next/server';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import { listPublicDiscoverableBranches } from '@/lib/booking/publicBookingBranchContext';
import {
  gatePublicBookingRoute,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['branches'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/branches
 * Public discovery list — PUBLIC_LIVE + PublicBookingEnabled + QBS.BookingEnabled only.
 * Never includes Camp Caesar while public booking is disabled.
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'branches');
  if (blocked) return blocked;

  try {
    const branches = await listPublicDiscoverableBranches();
    return finalizePublicBookingJson(req, gate, { ok: true, branches });
  } catch (err) {
    console.error('[public/branches]', err);
    return finalizePublicBookingJson(req, gate, { error: 'فشل تحميل الفروع' }, {
      status: 500,
    });
  }
}
