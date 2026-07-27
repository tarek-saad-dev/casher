import { NextRequest } from 'next/server';
import {
  getPublicSettings,
  PUBLIC_BOOKING_DISABLED_CLIENT_MESSAGE,
} from '@/lib/publicBookingHelpers';
import {
  PublicBookingBranchContextError,
  resolvePublicBookingBranchContext,
} from '@/lib/booking/publicBookingBranchContext';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['status'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/status?branchCode=XXX
 * Branch-scoped gate — Camp Caesar → BRANCH_NOT_PUBLIC.
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'status');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    const branchCode = extractPublicBranchCode(searchParams);
    const preview = searchParams.get('preview');

    let ctx;
    try {
      ctx = await resolvePublicBookingBranchContext({
        branchCode,
        purpose: 'public_booking',
        previewQueryParam: preview,
      });
    } catch (err) {
      if (err instanceof PublicBookingBranchContextError) {
        return finalizePublicBookingError(req, gate, err.code);
      }
      throw err;
    }

    const settings = await getPublicSettings(ctx.branchId);
    const bookingEnabled = !!settings.bookingEnabled && ctx.bookingEnabled;

    return finalizePublicBookingJson(
      req,
      gate,
      {
        ok: true,
        bookingEnabled,
        ...(bookingEnabled ? {} : { message: PUBLIC_BOOKING_DISABLED_CLIENT_MESSAGE }),
      },
    );
  } catch (err) {
    console.error('[public/booking/status]', err);
    return finalizePublicBookingJson(req, gate, { ok: false, error: 'فشل تحميل حالة الحجز' }, {
      status: 500,
    });
  }
}
