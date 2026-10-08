import { NextRequest, NextResponse } from 'next/server';
import {
  PublicBookingBranchContextError,
  resolvePublicBookingBranchContext,
} from '@/lib/booking/publicBookingBranchContext';
import { getPublicBookingServicesCatalog } from '@/lib/booking/publicBookingServices';
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
  return publicBookingTenantOptionsResponse(req, 'services');
}

/**
 * GET /api/public/booking/services?branchCode=XXX
 * Public bookable salon services catalog (Booking Phase 2).
 * Branch required — no GLEEM fallback. Camp Caesar → BRANCH_NOT_PUBLIC.
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'services');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    // Security: BranchID / includeDeleted / type / preview must not unlock catalog
    void searchParams.get('BranchID');
    void searchParams.get('branchId');
    void searchParams.get('includeDeleted');
    void searchParams.get('type');
    const preview = searchParams.get('preview');

    const branchCode = extractPublicBranchCode(searchParams);
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

    if (!ctx.bookingEnabled || !ctx.publicBookingEnabled) {
      return finalizePublicBookingError(req, gate, 'BRANCH_BOOKING_DISABLED');
    }

    const catalog = await getPublicBookingServicesCatalog(ctx);

    if (catalog.meta.serviceCount === 0) {
      return finalizePublicBookingError(req, gate, 'SERVICES_NOT_CONFIGURED');
    }

    return finalizePublicBookingJson(req, gate, catalog);
  } catch (err) {
    console.error('[public/booking/services]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'SERVICE_CATALOG_UNAVAILABLE');
  }
}
