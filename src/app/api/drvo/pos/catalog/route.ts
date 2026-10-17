import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { authorizeDrvoPosOperationalRead } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tenant-scoped service catalog preview. This is NOT an authorization to sell:
 * branch-level service availability and pricing policy remain to be verified.
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

    const result = await db.request()
      .input('tenantId', sql.UniqueIdentifier, access.context.tenantId)
      .input('locationId', sql.UniqueIdentifier, access.context.activeLocation.locationId)
      .input('branchId', sql.Int, access.context.activeLocation.legacyBranchId)
      .query<{
        proId: number;
        name: string | null;
        nameAr: string | null;
        price: number | null;
        durationMinutes: number | null;
      }>(`
        SELECT TOP (100)
          p.ProID AS proId,
          p.ProName AS name,
          p.ProNameAr AS nameAr,
          p.SPrice1 AS price,
          p.DurationMinutes AS durationMinutes
        FROM dbo.TblPro AS p
        WHERE p.TenantId = @tenantId
          AND ISNULL(p.isDeleted, 0) = 0
          AND EXISTS (
            SELECT 1 FROM dbo.Location AS l
            JOIN dbo.Tenant AS t ON t.TenantId = l.TenantId AND t.Status = N'active'
            WHERE l.TenantId = p.TenantId
              AND l.LocationId = @locationId
              AND l.LegacyBranchId = @branchId
              AND l.Status = N'active'
          )
        ORDER BY p.ProName, p.ProID
      `);

    return NextResponse.json({
      ok: true,
      tenantId: access.context.tenantId,
      locationId: access.context.activeLocation.locationId,
      services: result.recordset.map(row => ({
        proId: row.proId,
        name: row.name,
        nameAr: row.nameAr,
        indicativePrice: row.price,
        durationMinutes: row.durationMinutes,
        sellable: false,
      })),
      catalogReady: true,
      branchAvailabilityVerified: false,
      pricingVerifiedForSale: false,
      writesEnabled: false,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[drvo/pos/catalog] unavailable', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ ok: false, code: 'POS_CATALOG_UNAVAILABLE' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
