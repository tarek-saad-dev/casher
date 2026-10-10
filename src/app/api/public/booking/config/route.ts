import { NextRequest, NextResponse } from 'next/server';
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
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  publicBookingTenantOptionsResponse,
  requirePublicBookingRouteTenancy,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'config');
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
    const tenancy = await requirePublicBookingRouteTenancy(req, gate, { branchCode });
    if (tenancy instanceof NextResponse) return tenancy;

    let ctx;
    try {
      ctx = await resolvePublicBookingBranchContext({
        branchCode,
        purpose: 'public_booking',
        previewQueryParam: preview,
        expectedTenantId: tenancy.tenantId,
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
