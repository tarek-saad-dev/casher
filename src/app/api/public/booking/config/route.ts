import { NextRequest } from 'next/server';
import {
  getPublicSettings,
  PUBLIC_BOOKING_PAUSED_MESSAGE,
  PUBLIC_BOOKING_PAUSED_CODE,
} from '@/lib/publicBookingHelpers';
import {
  PublicBookingBranchContextError,
  resolvePublicBookingBranchContext,
  toPublicBranchSafeWire,
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
  const cors = PUBLIC_BOOKING_ROUTE_CORS['config'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/config?branchCode=XXX
 * Branch-scoped — missing branchCode → BRANCH_REQUIRED (no GLEEM fallback).
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'config');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    const branchCode = extractPublicBranchCode(searchParams);
    // preview=true must never escalate to internal_preview
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
        branch: toPublicBranchSafeWire(ctx),
        salon: {
          name: settings.salonName,
          logoUrl: null,
          timezone: settings.timezone || ctx.timezone,
          currency: settings.currency,
          bookingEnabled,
        },
        settings: {
          allowSpecificBarber: settings.allowSpecificBarber,
          allowNearestBarber: settings.allowNearestBarber,
          defaultMode: settings.defaultMode,
          slotIntervalMinutes: settings.slotIntervalMinutes,
          maxBookingDaysAhead: settings.maxBookingDaysAhead,
          minNoticeMinutes: settings.minNoticeMinutes,
        },
        operatingHours: ctx.operatingHours,
        ...(bookingEnabled
          ? {}
          : {
              bookingPaused: true,
              message: PUBLIC_BOOKING_PAUSED_MESSAGE,
              code: PUBLIC_BOOKING_PAUSED_CODE,
            }),
      }
    );
  } catch (err) {
    console.error('[public/booking/config]', err);
    return finalizePublicBookingJson(req, gate, { error: 'فشل تحميل الإعدادات' }, {
      status: 500,
    });
  }
}
