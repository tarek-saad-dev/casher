import { NextRequest, NextResponse } from 'next/server';
import {
  PublicBarberMultiBranchAvailabilityError,
  getBarberAvailabilityDays,
} from '@/lib/booking/publicBarberMultiBranchAvailability';
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
  return publicBookingTenantOptionsResponse(req, 'barber-availability-days');
}

/**
 * POST /api/public/booking/barbers/[empId]/availability/days
 * Phase 1C — aggregate available days across the request tenant's public branches for one barber.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'barber-availability-days');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    void body.BranchID;
    void body.branchId;
    void body.branchName;
    void body.duration;
    void body.price;

    const tenancy = await requirePublicBookingRouteTenancy(req, gate, {
      branchCode: extractPublicBranchCode(new URL(req.url).searchParams, body),
      allowCutCompat: true,
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const result = await getBarberAvailabilityDays({
      tenantId: tenancy.tenantId,
      empId,
      serviceIds: body.serviceIds,
      dateFrom: body.dateFrom,
      days: body.days,
      scope: body.scope,
      branchCode: body.branchCode,
    });

    return finalizePublicBookingJson(req, gate, result, {
      cacheControl: 'private, max-age=45, stale-while-revalidate=30',
    });
  } catch (err) {
    if (err instanceof PublicBarberMultiBranchAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error(
      '[public/booking/barbers/availability/days]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
