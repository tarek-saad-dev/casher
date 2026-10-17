import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { authorizeDrvoPosOperationalRead } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staging-only DRVO sales read. The branch comes exclusively from the verified
 * tenant membership/location context, never from query params or headers.
 * No legacy POS API or write operation is exposed.
 */
export async function GET() {
  const access = await authorizeDrvoPosOperationalRead();
  if (!access.ok) {
    return NextResponse.json({ ok: false, code: access.code }, {
      status: access.status, headers: { 'Cache-Control': 'no-store' },
    });
  }
  try {
    const db = await getPool();
    const branchId = access.context.activeLocation.legacyBranchId;
    const result = await db.request()
      .input('branchId', sql.Int, branchId)
      .input('tenantId', sql.UniqueIdentifier, access.context.tenantId)
      .input('locationId', sql.UniqueIdentifier, access.context.activeLocation.locationId)
      .query<{
        invID: number;
        invDate: Date;
        grandTotal: number;
        paidAmount: number;
      }>(`
        SELECT TOP (10)
          h.invID,
          h.invDate,
          ISNULL(h.GrandTotal, 0) AS grandTotal,
          ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0) AS paidAmount
        FROM dbo.TblinvServHead AS h
        INNER JOIN dbo.Location AS l
          ON l.LegacyBranchId = h.BranchID
          AND l.LocationId = @locationId
          AND l.TenantId = @tenantId
          AND l.Status = N'active'
        WHERE h.BranchID = @branchId
          AND h.invType = N'مبيعات'
        ORDER BY h.invDate DESC, h.invID DESC;
      `);
    return NextResponse.json({
      ok: true,
      tenantId: access.context.tenantId,
      locationId: access.context.activeLocation.locationId,
      sales: result.recordset.map(row => ({
        invoiceId: row.invID,
        date: row.invDate,
        total: row.grandTotal,
        paid: row.paidAmount,
      })),
      writesEnabled: false,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[drvo/pos/sales/recent] failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ ok: false, code: 'POS_SALES_UNAVAILABLE' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
