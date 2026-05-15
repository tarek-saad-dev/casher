import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { LoyaltyClientListItem } from '@/lib/types';

export const runtime = 'nodejs';

// GET /api/loyalty/clients
// Query params:
//   - search: search by name, phone, or ClientID
//   - tierCode: filter by tier (BRONZE, SILVER, GOLD, VIP)
//   - hasPoints: 'true' to filter only clients with loyalty accounts
//   - page: page number (default 1)
//   - limit: items per page (default 20)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const tierCode = searchParams.get('tierCode') || '';
    const hasPoints = searchParams.get('hasPoints') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const db = await getPool();

    // Build WHERE clause
    const whereConditions: string[] = [];
    
    if (search.trim()) {
      const searchNum = parseInt(search, 10);
      if (!isNaN(searchNum)) {
        whereConditions.push(`(c.ClientID = ${searchNum} OR c.[Name] LIKE N'%${search}%' OR c.Mobile LIKE N'%${search}%')`);
      } else {
        whereConditions.push(`(c.[Name] LIKE N'%${search}%' OR c.Mobile LIKE N'%${search}%')`);
      }
    }
    
    if (tierCode) {
      whereConditions.push(`lt.TierCode = N'${tierCode}'`);
    }
    
    if (hasPoints) {
      whereConditions.push(`cl.ClientLoyaltyID IS NOT NULL`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM [dbo].[TblClient] c
      LEFT JOIN [dbo].[TblClientLoyalty] cl ON cl.ClientID = c.ClientID
      LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
      ${whereClause}
    `;
    
    const countResult = await db.request().query(countQuery);
    const totalCount = countResult.recordset[0]?.total || 0;

    // Get clients with loyalty data
    const query = `
      SELECT 
        c.ClientID,
        c.[Name] as ClientName,
        c.Mobile as Phone,
        cl.ClientLoyaltyID,
        ISNULL(cl.PointsBalance, 0) as PointsBalance,
        ISNULL(cl.LifetimeEarnedPoints, 0) as LifetimeEarnedPoints,
        ISNULL(cl.LifetimeRedeemedPoints, 0) as LifetimeRedeemedPoints,
        ISNULL(cl.LifetimeAdjustedPoints, 0) as LifetimeAdjustedPoints,
        cl.TierID,
        lt.TierNameAr,
        lt.TierNameEn,
        lt.TierCode,
        ISNULL(cl.TotalVisits, 0) as TotalVisits,
        ISNULL(cl.TotalSpend, 0) as TotalSpend,
        cl.LastVisitDate,
        cl.LastEarnAt,
        CASE WHEN cl.ClientLoyaltyID IS NOT NULL THEN 1 ELSE 0 END as IsActive
      FROM [dbo].[TblClient] c
      LEFT JOIN [dbo].[TblClientLoyalty] cl ON cl.ClientID = c.ClientID
      LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
      ${whereClause}
      ORDER BY 
        CASE WHEN cl.ClientLoyaltyID IS NOT NULL THEN 0 ELSE 1 END,
        cl.PointsBalance DESC,
        c.[Name]
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const result = await db.request().query(query);
    
    const clients: LoyaltyClientListItem[] = result.recordset.map(row => ({
      ClientID: row.ClientID,
      ClientName: row.ClientName,
      Phone: row.Phone,
      ClientLoyaltyID: row.ClientLoyaltyID,
      PointsBalance: row.PointsBalance,
      LifetimeEarnedPoints: row.LifetimeEarnedPoints,
      LifetimeRedeemedPoints: row.LifetimeRedeemedPoints,
      LifetimeAdjustedPoints: row.LifetimeAdjustedPoints,
      TierID: row.TierID,
      TierNameAr: row.TierNameAr,
      TierNameEn: row.TierNameEn,
      TierCode: row.TierCode,
      TotalVisits: row.TotalVisits,
      TotalSpend: row.TotalSpend,
      LastVisitDate: row.LastVisitDate ? new Date(row.LastVisitDate).toISOString() : null,
      LastEarnAt: row.LastEarnAt ? new Date(row.LastEarnAt).toISOString() : null,
      IsActive: row.IsActive === 1
    }));

    return NextResponse.json({
      clients,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/loyalty/clients] GET error:', message);
    return NextResponse.json(
      { error: 'فشل في جلب قائمة العملاء', details: message },
      { status: 500 }
    );
  }
}
