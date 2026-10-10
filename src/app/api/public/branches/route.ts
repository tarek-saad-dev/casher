import { NextRequest, NextResponse } from 'next/server';
import { listPublicDiscoverableBranchesForTenant } from '@/lib/booking/publicBookingTenancy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingJson,
  publicBookingTenantOptionsResponse,
  requirePublicBookingRouteTenancy,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'branches');
}

/**
 * GET /api/public/branches[?branchCode=XXX]
 * Public discovery list — PUBLIC_LIVE + PublicBookingEnabled + QBS.BookingEnabled only.
 * Never includes Camp Caesar while public booking is disabled.
 * DRVO-019: only the request tenant's branches (branchCode names the tenant; CUT may omit it).
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'branches');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    const tenancy = await requirePublicBookingRouteTenancy(req, gate, {
      branchCode: searchParams.get('branchCode'),
      allowCutCompat: true,
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const branches = await listPublicDiscoverableBranchesForTenant(tenancy.tenantId);
    return finalizePublicBookingJson(req, gate, { ok: true, branches });
  } catch (err) {
    console.error('[public/branches]', err);
    return finalizePublicBookingJson(req, gate, { error: 'فشل تحميل الفروع' }, {
      status: 500,
    });
  }
}
