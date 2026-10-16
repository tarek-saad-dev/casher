import { NextResponse } from 'next/server';
import { authorizeDrvoPosRead } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Access preflight only. Never returns invoices, customer data, or legacy POS records. */
export async function GET() {
  const access = await authorizeDrvoPosRead();
  if (!access.ok) {
    return NextResponse.json({ ok: false, code: access.code }, {
      status: access.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.json({
    ok: true,
    module: 'pos',
    access: 'read_preflight_only',
    tenantId: access.context.tenantId,
    locationId: access.context.activeLocation.locationId,
    legacyBranchId: access.context.activeLocation.legacyBranchId,
    writesEnabled: false,
    legacyReadsEnabled: false,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
