import { NextRequest, NextResponse } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  PublicBookingBarberError,
  getPublicBarberCalendar,
} from '@/lib/booking/publicBookingBarbers';
import { parsePublicServiceIdsParam } from '@/lib/booking/publicBookingBarberPolicy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  publicBookingTenantOptionsResponse,
  requirePublicBookingRouteTenancy,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'calendar');
}

/**
 * GET /api/public/booking/barbers/[empId]/calendar?from=&to=&branchCode=&serviceIds=
 * Presence-only calendar (no exact slot counts in Phase 3).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'calendar');
  if (blocked) return blocked;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const { searchParams } = new URL(req.url);
    void searchParams.get('includeTest');
    void searchParams.get('BranchID');
    const preview = searchParams.get('preview');
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
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

    const calendar = await getPublicBarberCalendar({
      tenantId: tenancy.tenantId,
      empId,
      from,
      to,
      branchCode,
      serviceIds: parsedServices.ids,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(req, gate, calendar);
  } catch (err) {
    if (err instanceof PublicBookingBarberError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error('[public/booking/barbers/calendar]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'BARBER_CATALOG_UNAVAILABLE');
  }
}
