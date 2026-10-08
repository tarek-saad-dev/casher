import { NextRequest, NextResponse } from 'next/server';
import {
  PublicCrossBranchAvailabilityError,
  getPublicCrossBranchBarberAvailability,
} from '@/lib/booking/publicBookingCrossBranchAvailability';
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
  return publicBookingTenantOptionsResponse(req, 'cross-branch-availability');
}

/**
 * POST /api/public/booking/barbers/[empId]/cross-branch-availability
 * Phase 10C — barber availability across all public bookable branches of the request tenant.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'cross-branch-availability');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Reject internal identifiers if sent
    void body.BranchID;
    void body.branchId;

    const tenancy = await requirePublicBookingRouteTenancy(req, gate, {
      branchCode: extractPublicBranchCode(new URL(req.url).searchParams, body),
      allowCutCompat: true,
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const result = await getPublicCrossBranchBarberAvailability({
      tenantId: tenancy.tenantId,
      empId,
      serviceIds: body.serviceIds,
      dateFrom: body.dateFrom,
      days: body.days,
    });

    return finalizePublicBookingJson(req, gate, result);
  } catch (err) {
    if (err instanceof PublicCrossBranchAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error(
      '[public/booking/barbers/cross-branch-availability]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
