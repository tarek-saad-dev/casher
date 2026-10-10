import { NextRequest, NextResponse } from 'next/server';
import {
  PublicBookingBarberError,
  getPublicBarberProfileById,
} from '@/lib/booking/publicBookingBarbers';
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
  return publicBookingTenantOptionsResponse(req, 'barbers');
}

/**
 * GET /api/public/booking/barbers/[empId][?branchCode=]
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
    const branchCode = extractPublicBranchCode(searchParams);

    const tenancy = await requirePublicBookingRouteTenancy(req, gate, {
      branchCode,
      allowCutCompat: true,
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const result = await getPublicBarberProfileById({
      tenantId: tenancy.tenantId,
      branchCode,
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
