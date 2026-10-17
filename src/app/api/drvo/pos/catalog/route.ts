import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { authorizeDrvoPosOperationalRead } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only, tenant-scoped catalog preview.
 * Legacy TblPro is global: NEVER return its rows without a verified branch
 * service-assignment relation. Fail closed until that mapping is validated.
 */
export async function GET() {
  const access = await authorizeDrvoPosOperationalRead();
  if (!access.ok) return NextResponse.json({ ok: false, code: access.code }, {
    status: access.status, headers: { 'Cache-Control': 'no-store' },
  });

  try {
    const db = await getPool();
    const identity = await db.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (identity.recordset[0]?.name !== 'last132_agent') {
      return NextResponse.json({ ok: false, code: 'WRONG_DATABASE' }, { status: 503 });
    }

    // Deliberately no query to dbo.TblPro: its historical schema does not
    // provide a tenant-scoped price catalog by itself.
    return NextResponse.json({
      ok: true,
      tenantId: access.context.tenantId,
      locationId: access.context.activeLocation.locationId,
      services: [],
      catalogReady: false,
      code: 'BRANCH_CATALOG_MAPPING_PENDING',
      writesEnabled: false,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, code: 'POS_CATALOG_UNAVAILABLE' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
