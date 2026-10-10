import { NextRequest, NextResponse } from 'next/server';
import {
  PublicBookingBarberError,
  getPublicBarberLocation,
} from '@/lib/booking/publicBookingBarbers';
import { parsePublicServiceIdsParam } from '@/lib/booking/publicBookingBarberPolicy';
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
  return publicBookingTenantOptionsResponse(req, 'location');
}

/**
 * GET /api/public/booking/barbers/[empId]/location?date=&serviceIds=[&branchCode=]
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
    const branchCode = extractPublicBranchCode(searchParams);

    const parsedServices = parsePublicServiceIdsParam(searchParams.get('serviceIds'));
    if (!parsedServices.ok) {
      return finalizePublicBookingError(req, gate, 'SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }

    const tenancy = await requirePublicBookingRouteTenancy(req, gate, {
      branchCode,
      allowCutCompat: true,
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const loc = await getPublicBarberLocation({
      tenantId: tenancy.tenantId,
      branchCode,
      empId,
      date,
      serviceIds: parsedServices.ids,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(req, gate, loc, {
      cacheControl: 'private, max-age=60, stale-while-revalidate=30',
    });
  } catch (err) {
    if (err instanceof PublicBookingBarberError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error('[public/booking/barbers/location]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'BARBER_CATALOG_UNAVAILABLE');
  }
}
